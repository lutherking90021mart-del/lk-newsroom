import 'dotenv/config';
import express,{type NextFunction,type Request,type Response} from 'express';
import cors from 'cors';
import cron from 'node-cron';
import {readFile} from 'node:fs/promises';
import {createClient} from '@supabase/supabase-js';
import {NewsWorker} from '../worker/newsWorker.js';
import {findImageCandidates} from '../services/googleImageSearch.js';
import {brandedSocialCardSvg,socialPlatforms} from '../worker/socialPublisher.js';
import {beginSocialOAuth,completeSocialOAuth} from '../services/socialOAuth.js';
import {defaultSocialTemplates,ensureSocialGraphics,listSocialTemplates,previewArticleForTemplate,renderSocialGraphicSvg,type SocialTemplate} from '../services/socialGraphics.js';

const url=process.env.SUPABASE_URL;
const serviceKey=process.env.SUPABASE_SERVICE_ROLE_KEY;
if(!url||!serviceKey)throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required on the server.');
const db=createClient(url,serviceKey,{auth:{persistSession:false}});
const worker=new NewsWorker(db);
const app=express();
app.set('trust proxy',1);
const publicArticleFields='id,slug,title,excerpt,ai_summary,featured_image_url,original_url,published_at,created_at,country,auto_tags,view_count,categories(name,slug),news_sources(name,slug),authors(name)';
const detailArticleFields='*,categories(name,slug),news_sources(name,slug),authors(name),article_tags(tags(name,slug))';
const isUuid=(value:string)=>/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const normaliseCategorySlug=(value:unknown)=>String(value??'').trim().toLowerCase().replace(/[^a-z0-9-]/g,'').slice(0,60);

app.use(cors({origin:process.env.PUBLIC_ORIGIN?.split(',')||true}));
app.use(express.json({limit:'100kb'}));

interface StaffRequest extends Request { userId?:string; }
function errorMessage(error:unknown,fallback:string){
  if(error instanceof Error)return error.message;
  if(error&&typeof error==='object'&&'message' in error&&typeof (error as {message?:unknown}).message==='string')return (error as {message:string}).message;
  return fallback;
}
async function requireStaff(req:StaffRequest,res:Response,next:NextFunction){
  const token=req.headers.authorization?.replace(/^Bearer\s+/i,'');
  if(!token)return res.status(401).json({error:'Authentication required'});
  const {data:{user},error}=await db.auth.getUser(token);
  if(error||!user)return res.status(401).json({error:'Invalid session'});
  const {data:role}=await db.from('users_roles').select('role').eq('user_id',user.id).maybeSingle();
  if(!role)return res.status(403).json({error:'Newsroom role required'});
  req.userId=user.id; next();
}
function isCronRequest(req:Request){
  const secret=process.env.CRON_SECRET;
  const token=req.headers.authorization?.replace(/^Bearer\s+/i,'');
  return Boolean(secret&&token===secret);
}
function requireCronOrStaff(req:StaffRequest,res:Response,next:NextFunction){
  if(isCronRequest(req))return next();
  // A local developer without a CRON_SECRET can test the endpoint. Production must use a secret or a staff session.
  if(process.env.NODE_ENV!=='production'&&!process.env.CRON_SECRET)return next();
  return requireStaff(req,res,next);
}
async function editorialRole(userId:string){
  const {data}=await db.from('users_roles').select('role').eq('user_id',userId).maybeSingle();
  return Boolean(data&&['super_admin','admin','editor'].includes(data.role));
}
async function articleByIdentifier(identifier:string){
  let query=db.from('articles').select(detailArticleFields).eq('status','published').is('duplicate_of',null);
  query=isUuid(identifier)?query.eq('id',identifier):query.eq('slug',identifier);
  const {data,error}=await query.maybeSingle();
  if(error)throw error;
  return data;
}
async function categoryBySlug(slug:string){
  const {data,error}=await db.from('categories').select('id,name,slug,description,colour').eq('slug',slug).maybeSingle();
  if(error)throw error;
  return data;
}
function scopeCategoryArticles(query:any,slug:string,category:{id:string}|null){
  // Ghana is a geographic desk. It deliberately includes every Ghana story, regardless of whether
  // its editorial category is politics, sport, business, and so on.
  if(slug==='ghana')return category?query.or(`category_id.eq.${category.id},country.eq.Ghana`):query.eq('country','Ghana');
  return category?query.eq('category_id',category.id):null;
}
function nextFiveMinutes(){return new Date((Math.floor(Date.now()/300_000)+1)*300_000).toISOString();}
const escHtml=(value:unknown)=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]!));
const escXml=(value:unknown)=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[char]!));
function publicOrigin(req:Request){return (process.env.PUBLIC_ORIGIN?.split(',')[0]||`${req.protocol}://${req.get('host')}`).replace(/\/$/,'');}
function plainText(value:unknown){return String(value??'').replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim();}
const analyticsRateLimit=new Map<string,{count:number;resetAt:number}>();
const analyticsEventNames=new Set(['page_view','article_open','scroll_depth','page_exit','social_share','ad_impression','ad_click']);
const revenueSources=new Set(['adsense','direct_advertisements','sponsored_articles','affiliate_marketing','subscriptions','other']);
const revenueTypes=new Set(['estimated','received','adjustment','refund']);
const revenueStatuses=new Set(['pending','confirmed','paid','void']);
function analyticsRateAllowed(req:Request){
  const key=req.ip||req.headers['x-forwarded-for']?.toString().split(',')[0]?.trim()||'unknown';const now=Date.now();const item=analyticsRateLimit.get(key);
  if(!item||item.resetAt<now){analyticsRateLimit.set(key,{count:1,resetAt:now+60_000});return true;}
  if(item.count>=90)return false;item.count++;return true;
}
function cleanAnalyticsText(value:unknown,max=180){return typeof value==='string'?value.replace(/[\u0000-\u001f]/g,' ').trim().slice(0,max):null;}
function analyticsPath(value:unknown){
  const raw=cleanAnalyticsText(value,600)||'/';
  try{const parsed=new URL(raw,'http://lk.local');return `${parsed.pathname}${parsed.search}`.slice(0,500)||'/';}catch{return '/';}
}
function firstHeader(value:string|string[]|undefined){return Array.isArray(value)?value[0]:value?.split(',')[0]?.trim()||null;}
function requestCountry(req:Request){return cleanAnalyticsText(firstHeader(req.headers['cf-ipcountry'])||firstHeader(req.headers['x-vercel-ip-country'])||firstHeader(req.headers['x-geo-country']),80);}
function requestCity(req:Request){return cleanAnalyticsText(firstHeader(req.headers['cf-ipcity'])||firstHeader(req.headers['x-vercel-ip-city'])||firstHeader(req.headers['x-geo-city']),100);}
function dayStart(input=new Date()){const copy=new Date(input);copy.setUTCHours(0,0,0,0);return copy;}
function dateKey(value:Date|string){return new Date(value).toISOString().slice(0,10);}
function bucket<T extends Record<string,any>>(rows:T[],field:keyof T,unknown='Unknown'){
  return Object.entries(rows.reduce((result:Record<string,number>,row)=>{const key=String(row[field]||unknown).trim()||unknown;result[key]=(result[key]||0)+1;return result;},{})).sort((a,b)=>b[1]-a[1]).slice(0,10).map(([label,value])=>({label,value}));
}
function sumAmounts(rows:any[]){return rows.reduce((sum,row)=>sum+Number(row.amount||0),0);}
function currencySummary(rows:any[]){
  const values=rows.reduce((result:Record<string,number>,row)=>{const currency=String(row.currency||'USD').toUpperCase();result[currency]=(result[currency]||0)+Number(row.amount||0);return result;},{});
  return Object.entries(values).map(([currency,amount])=>({currency,amount:Number(amount.toFixed(2))}));
}
async function optionalAnalyticsUser(req:Request){
  const token=req.headers.authorization?.replace(/^Bearer\s+/i,'');if(!token)return null;
  const {data:{user}}=await db.auth.getUser(token);return user?.id||null;
}
async function articleDocument(req:Request,article:Record<string,any>){
  const origin=publicOrigin(req);const canonical=`${origin}/news/${encodeURIComponent(article.slug||article.id)}`;
  const title=article.meta_title||article.title||'LK Newsroom';const description=(article.meta_description||article.ai_summary||article.excerpt||plainText(article.content)||'LK Newsroom reporting.').slice(0,300);
  const image=article.featured_image_url||`${origin}/assets/default-news.svg`;const category=article.categories?.name||'News';const source=article.news_sources?.name||'LK Newsroom';
  const structured={ '@context':'https://schema.org','@type':'NewsArticle',headline:title,description,datePublished:article.published_at,dateModified:article.updated_at||article.published_at,mainEntityOfPage:canonical,image:[image],articleSection:category,author:{'@type':'Organization',name:article.authors?.name||source},publisher:{'@type':'Organization',name:'LK Newsroom',logo:{'@type':'ImageObject',url:`${origin}/assets/lk-newsroom-logo.png`}} };
  const seo=`<link rel="canonical" href="${escHtml(canonical)}"><meta property="og:type" content="article"><meta property="og:title" content="${escHtml(title)}"><meta property="og:description" content="${escHtml(description)}"><meta property="og:image" content="${escHtml(image)}"><meta property="og:url" content="${escHtml(canonical)}"><meta property="article:section" content="${escHtml(category)}"><meta property="article:published_time" content="${escHtml(article.published_at||'')}"><meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${escHtml(title)}"><meta name="twitter:description" content="${escHtml(description)}"><meta name="twitter:image" content="${escHtml(image)}"><script type="application/ld+json">${JSON.stringify(structured).replace(/</g,'\\u003c')}</script>`;
  const template=await readFile(`${process.cwd()}/pages/article.html`,'utf8');
  return template.replace(/<title>[^<]*<\/title>/i,`<title>${escHtml(title)} | LK Newsroom</title>`).replace(/<meta name="description"[^>]*>/i,`<meta name="description" content="${escHtml(description)}">`).replace('</head>',`${seo}</head>`);
}

app.get('/health',async(_req,res)=>{
  const {data}=await db.from('worker_runs').select('status,completed_at,started_at').order('started_at',{ascending:false}).limit(1).maybeSingle();
  res.json({status:'ok',service:'lk-news-aggregator',updatedAt:new Date().toISOString(),worker:data||null});
});

// First-party browser telemetry. This endpoint intentionally stores an anonymous browser ID,
// never an IP address, email address, or advertising fingerprint. Railway/Cloudflare geo headers
// are used only when the host already provides them.
app.post('/v1/analytics/events',async(req,res)=>{
  try{
    if(!analyticsRateAllowed(req))return res.status(429).json({error:'Too many analytics events. Please try again shortly.'});
    const eventName=cleanAnalyticsText(req.body?.eventName,40)||'';
    const sessionId=cleanAnalyticsText(req.body?.sessionId,120)||'';
    const visitorId=cleanAnalyticsText(req.body?.visitorId,120);
    if(!analyticsEventNames.has(eventName)||!sessionId)return res.status(400).json({error:'A valid analytics event and session are required.'});
    const articleId=typeof req.body?.articleId==='string'&&isUuid(req.body.articleId)?req.body.articleId:null;
    const categoryId=typeof req.body?.categoryId==='string'&&isUuid(req.body.categoryId)?req.body.categoryId:null;
    const scrollDepth=Number(req.body?.scrollDepth);const durationSeconds=Number(req.body?.durationSeconds);
    const source=cleanAnalyticsText(req.body?.source,160)||'direct';
    const metadata=typeof req.body?.metadata==='object'&&req.body.metadata&&!Array.isArray(req.body.metadata)?req.body.metadata:{};
    const userId=await optionalAnalyticsUser(req);
    const {error}=await db.from('analytics_events').insert({
      user_id:userId,visitor_id:visitorId,session_id:sessionId,event_name:eventName,page_url:analyticsPath(req.body?.pageUrl),
      page_title:cleanAnalyticsText(req.body?.pageTitle,180),article_id:articleId,category_id:categoryId,
      country:requestCountry(req),city:requestCity(req),device:cleanAnalyticsText(req.body?.device,40),browser:cleanAnalyticsText(req.body?.browser,50),
      operating_system:cleanAnalyticsText(req.body?.operatingSystem,60),source,search_keyword:cleanAnalyticsText(req.body?.searchKeyword,140),
      scroll_depth:Number.isFinite(scrollDepth)?Math.min(100,Math.max(0,Math.round(scrollDepth))):null,
      duration_seconds:Number.isFinite(durationSeconds)?Math.min(86_400,Math.max(0,Math.round(durationSeconds))):null,
      metadata
    });
    if(error)throw error;
    res.status(202).json({ok:true});
  }catch(error){res.status(503).json({error:error instanceof Error?error.message:'Analytics is temporarily unavailable. Run analytics-business-upgrade.sql in Supabase first.'});}
});

app.post('/v1/analytics/advertisements/:id/:event',async(req,res)=>{
  try{
    if(!analyticsRateAllowed(req))return res.status(429).json({error:'Too many advertising events.'});
    if(!isUuid(req.params.id)||!['impression','click'].includes(req.params.event))return res.status(400).json({error:'Invalid advertising event.'});
    const {error}=await db.from('advertisement_events').insert({advertisement_id:req.params.id,event_type:req.params.event,session_id:cleanAnalyticsText(req.body?.sessionId,120),page_url:analyticsPath(req.body?.pageUrl),source:cleanAnalyticsText(req.body?.source,160)||'direct'});
    if(error)throw error;res.status(202).json({ok:true});
  }catch(error){res.status(503).json({error:error instanceof Error?error.message:'Advertising analytics is temporarily unavailable.'});}
});

app.get('/v1/admin/analytics/overview',requireStaff,async(req,res)=>{
  try{
    const requested=Number(req.query.days);const days=Number.isFinite(requested)?Math.min(90,Math.max(1,Math.round(requested))):30;
    const now=new Date();const from=new Date(now.getTime()-(days-1)*86_400_000);from.setUTCHours(0,0,0,0);
    const today=dayStart(now);const week=new Date(today.getTime()-6*86_400_000);const month=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),1));const year=new Date(Date.UTC(now.getUTCFullYear(),0,1));
    const [eventsResult,articlesResult,commentsResult,likesResult,socialPostsResult,socialAccountsResult,revenueResult,adEventsResult,adsResult,subscribersResult,categoriesResult]=await Promise.all([
      db.from('analytics_events').select('visitor_id,session_id,event_name,page_url,page_title,article_id,category_id,country,city,device,browser,operating_system,source,search_keyword,scroll_depth,duration_seconds,created_at').gte('created_at',from.toISOString()).order('created_at',{ascending:false}).limit(50_000),
      db.from('articles').select('id,slug,title,featured_image_url,view_count,published_at,created_at,categories(name,slug),authors(name)').eq('status','published').is('duplicate_of',null).order('published_at',{ascending:false}).limit(500),
      db.from('comments').select('article_id,created_at').eq('status','approved').gte('created_at',from.toISOString()).limit(20_000),
      db.from('article_likes').select('article_id,created_at').gte('created_at',from.toISOString()).limit(20_000),
      db.from('social_posts').select('id,article_id,platform,status,posted_at,scheduled_for,click_count,created_at,platform_post_url,social_accounts(display_name)').gte('created_at',from.toISOString()).order('created_at',{ascending:false}).limit(10_000),
      db.from('social_accounts').select('id,platform,display_name,enabled,auto_post,last_success_at,last_error,token_expires_at').order('created_at',{ascending:false}),
      db.from('revenue').select('id,source,amount,currency,type,status,date,advertisement_id,article_id,notes,created_at').gte('date',year.toISOString().slice(0,10)).order('date',{ascending:false}).limit(10_000),
      db.from('advertisement_events').select('advertisement_id,event_type,created_at').gte('created_at',from.toISOString()).limit(50_000),
      db.from('advertisements').select('id,title,name,ad_type,impressions,clicks,status,active,advertisers(company_name)').order('created_at',{ascending:false}).limit(500),
      db.from('newsletter').select('id,created_at',{count:'exact',head:true}),
      db.from('categories').select('id,name,slug')
    ]);
    const required=[eventsResult,revenueResult,adEventsResult];const failed=required.find(item=>item.error);
    if(failed?.error)throw failed.error;
    // Supporting modules (social, ads and historic article metadata) should never
    // take the whole newsroom dashboard offline. Their data is optional here and
    // each affected card simply starts empty until that module is configured.
    const events=(eventsResult.data||[]) as any[];const articles=(articlesResult.data||[]) as any[];const comments=(commentsResult.data||[]) as any[];const likes=(likesResult.data||[]) as any[];const socialPosts=(socialPostsResult.data||[]) as any[];const socialAccounts=(socialAccountsResult.data||[]) as any[];const revenueRows=(revenueResult.data||[]) as any[];const adEvents=(adEventsResult.data||[]) as any[];const ads=(adsResult.data||[]) as any[];
    const pageEvents=events.filter(row=>row.event_name==='page_view');const articleEvents=events.filter(row=>row.event_name==='article_open');const visitors=new Set(pageEvents.map(row=>row.visitor_id).filter(Boolean));const sessions=new Set(events.map(row=>row.session_id).filter(Boolean));const online=new Set(events.filter(row=>new Date(row.created_at).getTime()>now.getTime()-300_000).map(row=>row.session_id).filter(Boolean));
    const sessionRows=new Map<string,any[]>();for(const event of events){if(!event.session_id)continue;const list=sessionRows.get(event.session_id)||[];list.push(event);sessionRows.set(event.session_id,list);}
    const returnVisitors=[...sessionRows.values()].filter(rows=>new Set(rows.map(row=>row.page_url)).size>1||rows.length>2).length;
    const sessionDurations=[...sessionRows.values()].map(rows=>{const timestamps=rows.map(row=>new Date(row.created_at).getTime()).filter(Number.isFinite);const observed=Math.max(0,((Math.max(...timestamps)-Math.min(...timestamps))/1000)||0);const reported=Math.max(0,...rows.map(row=>Number(row.duration_seconds)||0));return Math.max(observed,reported);}).filter(value=>value>0);
    const averageSessionDuration=sessionDurations.length?Math.round(sessionDurations.reduce((sum,value)=>sum+value,0)/sessionDurations.length):0;
    const dayBuckets=new Map<string,{visitors:Set<string>;views:number;sessions:Set<string>}>();for(let index=days-1;index>=0;index--){const day=new Date(today.getTime()-index*86_400_000);dayBuckets.set(dateKey(day),{visitors:new Set(),views:0,sessions:new Set()});}
    for(const event of pageEvents){const group=dayBuckets.get(dateKey(event.created_at));if(group){group.views++;if(event.visitor_id)group.visitors.add(event.visitor_id);if(event.session_id)group.sessions.add(event.session_id);}}
    const articleCounts=new Map<string,{opens:number;shares:number;readings:number[];scrolls:number[]}>();for(const event of events){if(!event.article_id)continue;const metrics=articleCounts.get(event.article_id)||{opens:0,shares:0,readings:[],scrolls:[]};if(event.event_name==='article_open')metrics.opens++;if(event.event_name==='social_share')metrics.shares++;if(event.event_name==='page_exit'&&Number(event.duration_seconds)>0)metrics.readings.push(Number(event.duration_seconds));if(event.event_name==='scroll_depth'&&Number(event.scroll_depth)>0)metrics.scrolls.push(Number(event.scroll_depth));articleCounts.set(event.article_id,metrics);}
    const commentCounts=new Map<string,number>();comments.forEach(row=>commentCounts.set(row.article_id,(commentCounts.get(row.article_id)||0)+1));const likeCounts=new Map<string,number>();likes.forEach(row=>likeCounts.set(row.article_id,(likeCounts.get(row.article_id)||0)+1));
    const performances=articles.map(article=>{const tracked=articleCounts.get(article.id)||{opens:0,shares:0,readings:[],scrolls:[]};const views=Math.max(Number(article.view_count||0),tracked.opens);const commentsForArticle=commentCounts.get(article.id)||0;const likesForArticle=likeCounts.get(article.id)||0;const averageReadingTime=tracked.readings.length?Math.round(tracked.readings.reduce((sum,value)=>sum+value,0)/tracked.readings.length):0;const engagementRate=views?Number((((tracked.shares+commentsForArticle+likesForArticle)/views)*100).toFixed(1)):0;const scrollAverage=tracked.scrolls.length?tracked.scrolls.reduce((sum,value)=>sum+value,0)/tracked.scrolls.length:0;const score=Math.min(100,Math.round(Math.min(35,views/4)+Math.min(30,tracked.shares*5)+Math.min(20,commentsForArticle*4)+Math.min(10,likesForArticle*2)+Math.min(5,scrollAverage/20)));return {id:article.id,slug:article.slug,title:article.title,image:article.featured_image_url,category:article.categories?.name||'News',author:article.authors?.name||'LK Newsroom',publishedAt:article.published_at||article.created_at,views,shares:tracked.shares,comments:commentsForArticle,likes:likesForArticle,averageReadingTime,engagementRate,score};}).sort((a,b)=>b.score-a.score||b.views-a.views).slice(0,25);
    const paidRevenue=revenueRows.filter(row=>row.status!=='void');const byPeriod=(start:Date)=>paidRevenue.filter(row=>new Date(`${row.date}T00:00:00Z`)>=start);const monthlyRevenue=new Map<string,number>();for(const row of paidRevenue){const key=String(row.date).slice(0,7);monthlyRevenue.set(key,(monthlyRevenue.get(key)||0)+Number(row.amount||0));}
    const socialToday=socialPosts.filter(row=>row.posted_at&&new Date(row.posted_at)>=today);const publishedPosts=socialPosts.filter(row=>row.status==='published');const socialPlatform=bucket(publishedPosts,'platform');const adImpressions=adEvents.filter(row=>row.event_type==='impression').length;const adClicks=adEvents.filter(row=>row.event_type==='click').length;
    const topCategories=performances.reduce((result:Record<string,number>,article)=>{result[article.category]=(result[article.category]||0)+article.views;return result;},{});
    res.json({
      period:{days,from:from.toISOString(),to:now.toISOString()},
      visitors:{today:[...new Set(pageEvents.filter(row=>new Date(row.created_at)>=today).map(row=>row.visitor_id).filter(Boolean))].length,week:[...new Set(pageEvents.filter(row=>new Date(row.created_at)>=week).map(row=>row.visitor_id).filter(Boolean))].length,month:[...new Set(pageEvents.filter(row=>new Date(row.created_at)>=month).map(row=>row.visitor_id).filter(Boolean))].length,total:visitors.size,live:online.size,pageViews:pageEvents.length,sessions:sessions.size,returningRate:visitors.size?Number(((returnVisitors/visitors.size)*100).toFixed(1)):0,averageSessionDuration,growth:[...dayBuckets.entries()].map(([date,value])=>({date,visitors:value.visitors.size,pageViews:value.views,sessions:value.sessions.size})),countries:bucket(pageEvents,'country'),cities:bucket(pageEvents,'city'),devices:bucket(pageEvents,'device'),browsers:bucket(pageEvents,'browser'),operatingSystems:bucket(pageEvents,'operating_system'),sources:bucket(pageEvents,'source'),keywords:bucket(pageEvents.filter(row=>row.search_keyword),'search_keyword'),pages:bucket(pageEvents,'page_url')},
      articles:{published:articles.length,performance:performances,mostViewed:[...performances].sort((a,b)=>b.views-a.views).slice(0,10),mostShared:[...performances].sort((a,b)=>b.shares-a.shares).slice(0,10),mostCommented:[...performances].sort((a,b)=>b.comments-a.comments).slice(0,10),trendingToday:performances.filter(row=>new Date(row.publishedAt)>=today).slice(0,10),categories:Object.entries(topCategories).sort((a:any,b:any)=>b[1]-a[1]).slice(0,8).map(([label,value])=>({label,value}))},
      revenue:{today:sumAmounts(byPeriod(today)),week:sumAmounts(byPeriod(week)),month:sumAmounts(byPeriod(month)),year:sumAmounts(byPeriod(year)),currencyTotals:currencySummary(paidRevenue),sources:bucket(paidRevenue,'source'),monthly:[...monthlyRevenue.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([monthName,amount])=>({month:monthName,amount:Number(amount.toFixed(2))})),records:paidRevenue.slice(0,50),advertising:{impressions:adImpressions||ads.reduce((sum,row)=>sum+Number(row.impressions||0),0),clicks:adClicks||ads.reduce((sum,row)=>sum+Number(row.clicks||0),0),ctr:Number(((((adClicks||ads.reduce((sum,row)=>sum+Number(row.clicks||0),0))/Math.max(1,adImpressions||ads.reduce((sum,row)=>sum+Number(row.impressions||0),0)))*100)).toFixed(2)),campaigns:ads.slice(0,10)}},
      social:{accounts:socialAccounts,connected:socialAccounts.filter(row=>row.enabled).length,postsToday:socialToday.length,published:publishedPosts.length,failed:socialPosts.filter(row=>row.status==='failed').length,queue:socialPosts.filter(row=>['pending','scheduled','retry','processing'].includes(row.status)).length,clicks:socialPosts.reduce((sum,row)=>sum+Number(row.click_count||0),0),topPlatform:socialPlatform[0]?.label||null,platforms:socialPlatform,lastPost:publishedPosts[0]||null,recent:socialPosts.slice(0,20)},
      overview:{articlesPublishedToday:articles.filter(row=>new Date(row.published_at||row.created_at)>=today).length,subscribers:subscribersResult.count||0,articleViews:performances.reduce((sum,row)=>sum+row.views,0),socialFollowers:null,revenueToday:sumAmounts(byPeriod(today))}
    });
  }catch(error){res.status(503).json({error:errorMessage(error,'Analytics dashboard unavailable. Run analytics-business-upgrade.sql in Supabase first.')});}
});

function revenuePayload(body:any,userId:string){
  const source=String(body?.source||'').trim();const amount=Number(body?.amount);const currency=String(body?.currency||'USD').trim().toUpperCase();const type=String(body?.type||'estimated').trim();const status=String(body?.status||'pending').trim();const date=String(body?.date||new Date().toISOString().slice(0,10)).slice(0,10);
  if(!revenueSources.has(source)||!Number.isFinite(amount)||Math.abs(amount)>10_000_000||!/^\d{4}-\d{2}-\d{2}$/.test(date)||!revenueTypes.has(type)||!revenueStatuses.has(status)||!/^[A-Z]{3}$/.test(currency))throw new Error('Enter a valid revenue source, amount, currency, date, type, and status.');
  return {source,amount,currency,type,status,date,advertisement_id:typeof body?.advertisementId==='string'&&isUuid(body.advertisementId)?body.advertisementId:null,article_id:typeof body?.articleId==='string'&&isUuid(body.articleId)?body.articleId:null,notes:cleanAnalyticsText(body?.notes,1000),created_by:userId};
}
app.get('/v1/admin/revenue',requireStaff,async(_req,res)=>{
  try{const {data,error}=await db.from('revenue').select('*,advertisements(title,name),articles(title,slug)').order('date',{ascending:false}).limit(200);if(error)throw error;res.json({data:data||[]});}
  catch(error){res.status(503).json({error:error instanceof Error?error.message:'Run analytics-business-upgrade.sql in Supabase first.'});}
});
app.post('/v1/admin/revenue',requireStaff,async(req,res)=>{
  try{const userId=(req as StaffRequest).userId!;if(!await editorialRole(userId))return res.status(403).json({error:'Editorial role required'});const {data,error}=await db.from('revenue').insert(revenuePayload(req.body,userId)).select().single();if(error)throw error;res.status(201).json({data});}
  catch(error){res.status(400).json({error:error instanceof Error?error.message:'Unable to create revenue record.'});}
});
app.patch('/v1/admin/revenue/:id',requireStaff,async(req,res)=>{
  try{const userId=(req as StaffRequest).userId!;const recordId=String(req.params.id);if(!await editorialRole(userId))return res.status(403).json({error:'Editorial role required'});if(!isUuid(recordId))return res.status(400).json({error:'Invalid revenue record.'});const {created_by,...payload}=revenuePayload(req.body,userId);const {data,error}=await db.from('revenue').update(payload).eq('id',recordId).select().single();if(error)throw error;res.json({data});}
  catch(error){res.status(400).json({error:error instanceof Error?error.message:'Unable to update revenue record.'});}
});
app.delete('/v1/admin/revenue/:id',requireStaff,async(req,res)=>{
  try{const userId=(req as StaffRequest).userId!;const recordId=String(req.params.id);if(!await editorialRole(userId))return res.status(403).json({error:'Editorial role required'});if(!isUuid(recordId))return res.status(400).json({error:'Invalid revenue record.'});const {error}=await db.from('revenue').delete().eq('id',recordId);if(error)throw error;res.status(204).end();}
  catch(error){res.status(400).json({error:error instanceof Error?error.message:'Unable to remove revenue record.'});}
});

app.get('/v1/categories/:slug',async(req,res)=>{
  try{
    const slug=normaliseCategorySlug(req.params.slug);
    if(!slug)return res.status(400).json({error:'A valid category is required.'});
    const category=await categoryBySlug(slug);
    if(!category)return res.status(404).json({error:'Category not found.'});
    const base=db.from('articles').select('id',{count:'exact',head:true}).eq('status','published').is('duplicate_of',null);
    const query=scopeCategoryArticles(base,slug,category);
    if(!query)return res.json({data:category,liveStories:0,updatedAt:new Date().toISOString()});
    const {count,error}=await query;
    if(error)throw error;
    res.json({data:category,liveStories:count||0,updatedAt:new Date().toISOString()});
  }catch(error){res.status(500).json({error:error instanceof Error?error.message:'Unable to load category.'});}
});

app.get('/v1/news',async(req,res)=>{
  // Offset pagination keeps every section useful as the newsroom grows beyond its first stories.
  const limit=Math.min(Math.max(Number(req.query.limit)||30,1),48);
  const offset=Math.min(Math.max(Number(req.query.offset)||0,0),4_800);
  const view=typeof req.query.view==='string'?req.query.view:'latest';
  const sortByViews=view==='trending'||view==='most-read';
  let query=db.from('articles').select(publicArticleFields,{count:'exact'}).eq('status','published').is('duplicate_of',null).order(sortByViews?'view_count':'published_at',{ascending:false}).order('published_at',{ascending:false});
  if(typeof req.query.category==='string'){
    const slug=normaliseCategorySlug(req.query.category);
    if(!slug)return res.status(400).json({error:'A valid category is required.'});
    const category=await categoryBySlug(slug);
    const scoped=scopeCategoryArticles(query,slug,category);
    if(!scoped)return res.json({data:[],total:0,offset,limit,updatedAt:new Date().toISOString()});
    query=scoped;
  }
  if(typeof req.query.country==='string')query=query.eq('country',req.query.country);
  if(typeof req.query.author==='string')query=query.ilike('authors.name',`%${req.query.author.slice(0,80)}%`);
  if(typeof req.query.q==='string')query=query.ilike('title',`%${req.query.q.slice(0,80)}%`);
  if(typeof req.query.from==='string')query=query.gte('published_at',req.query.from);
  if(typeof req.query.to==='string')query=query.lte('published_at',req.query.to);
  if(view==='today'||view==='week'){
    const start=new Date();
    start.setHours(0,0,0,0);
    if(view==='week')start.setDate(start.getDate()-6);
    query=query.gte('published_at',start.toISOString());
  }
  if(typeof req.query.source==='string'){
    const {data:source}=await db.from('news_sources').select('id').eq('slug',req.query.source).maybeSingle();
    if(source)query=query.eq('source_id',source.id);
  }
  const {data,error,count}=await query.range(offset,offset+limit-1);
  if(error)return res.status(500).json({error:error.message});
  res.json({data,total:count||0,offset,limit,updatedAt:new Date().toISOString()});
});

app.get('/v1/videos',async(req,res)=>{
  const limit=Math.min(Math.max(Number(req.query.limit)||12,1),48);
  const {data,error}=await db.from('videos').select('id,title,description,video_url,youtube_url,thumbnail_url,duration_seconds,published_at,created_at,articles(news_sources(name,slug))').eq('status','published').order('published_at',{ascending:false}).limit(limit);
  if(error)return res.status(500).json({error:error.message});
  res.json({data:data||[],updatedAt:new Date().toISOString()});
});

app.get('/v1/news/:identifier',async(req,res)=>{
  try{
    const article=await articleByIdentifier(req.params.identifier);
    if(!article)return res.status(404).json({error:'Article not found'});
    const sourceId=article.source_id;
    const [related,sourceMore,previous,next,gallery,videos,comments]=await Promise.all([
      db.from('articles').select(publicArticleFields).eq('status','published').eq('category_id',article.category_id).neq('id',article.id).is('duplicate_of',null).order('published_at',{ascending:false}).limit(6),
      sourceId?db.from('articles').select(publicArticleFields).eq('status','published').eq('source_id',sourceId).neq('id',article.id).is('duplicate_of',null).order('published_at',{ascending:false}).limit(5):Promise.resolve({data:[]}),
      db.from('articles').select(publicArticleFields).eq('status','published').lt('published_at',article.published_at).is('duplicate_of',null).order('published_at',{ascending:false}).limit(1),
      db.from('articles').select(publicArticleFields).eq('status','published').gt('published_at',article.published_at).is('duplicate_of',null).order('published_at',{ascending:true}).limit(1),
      db.from('gallery').select('id,title,caption,image_url,alt_text').eq('article_id',article.id).eq('status','published').order('sort_order').limit(12),
      db.from('videos').select('id,title,description,video_url,youtube_url,thumbnail_url,duration_seconds').eq('article_id',article.id).eq('status','published').order('published_at',{ascending:false}).limit(6),
      db.from('comments').select('id,display_name,body,created_at').eq('article_id',article.id).eq('status','approved').order('created_at',{ascending:false}).limit(50)
    ]);
    res.json({data:article,related:related.data||[],moreFromSource:sourceMore.data||[],previous:previous.data?.[0]||null,next:next.data?.[0]||null,gallery:gallery.data||[],videos:videos.data||[],comments:comments.data||[]});
  }catch(error){res.status(500).json({error:error instanceof Error?error.message:'Unable to load article'});}
});

app.post('/v1/news/:identifier/comments',async(req,res)=>{
  try{
    const article=await articleByIdentifier(req.params.identifier);
    const displayName=typeof req.body?.displayName==='string'?req.body.displayName.trim():'';
    const body=typeof req.body?.body==='string'?req.body.body.trim():'';
    if(!article)return res.status(404).json({error:'Article not found'});
    if(displayName.length<2||displayName.length>80||body.length<1||body.length>5000)return res.status(400).json({error:'Enter a name and a comment between 1 and 5,000 characters.'});
    const {error}=await db.from('comments').insert({article_id:article.id,display_name:displayName,body,status:'pending'});
    if(error)throw error;
    res.status(201).json({message:'Comment submitted for moderation.'});
  }catch(error){res.status(500).json({error:error instanceof Error?error.message:'Unable to submit comment'});}
});

app.get('/v1/breaking',async(_req,res)=>{
  const {data,error}=await db.from('breaking_news').select('headline,link_url,starts_at,articles(id,original_url)').eq('active',true).order('starts_at',{ascending:false}).limit(8);
  if(error)return res.status(500).json({error:error.message});
  res.json({data,updatedAt:new Date().toISOString()});
});

app.get('/v1/admin/sources',requireStaff,async(_req,res)=>{
  const {data,error}=await db.from('news_sources').select('*').order('name');
  if(error)return res.status(500).json({error:error.message}); res.json({data});
});
app.patch('/v1/admin/sources/:slug',requireStaff,async(req,res)=>{
  if(typeof req.body?.enabled!=='boolean')return res.status(400).json({error:'enabled must be a boolean'});
  if(!await editorialRole((req as StaffRequest).userId!))return res.status(403).json({error:'Editorial role required'});
  const {data,error}=await db.from('news_sources').update({enabled:req.body.enabled}).eq('slug',req.params.slug).select().single();
  if(error)return res.status(500).json({error:error.message}); res.json({data});
});
app.get('/v1/admin/logs',requireStaff,async(_req,res)=>{
  const {data,error}=await db.from('feed_logs').select('*,news_sources(name,slug)').order('created_at',{ascending:false}).limit(100);
  if(error)return res.status(500).json({error:error.message}); res.json({data});
});
app.get('/v1/admin/worker-status',requireStaff,async(_req,res)=>{
  const today=new Date(); today.setUTCHours(0,0,0,0);
  const [latest,runRows,sources]=await Promise.all([
    db.from('worker_runs').select('*').order('started_at',{ascending:false}).limit(1).maybeSingle(),
    db.from('worker_runs').select('fetched,added,updated,skipped,errors').gte('started_at',today.toISOString()),
    db.from('news_sources').select('name,slug,enabled,last_status,last_synced_at,last_error,consecutive_failures').order('name')
  ]);
  const totals=(runRows.data||[]).reduce((sum,row)=>({fetched:sum.fetched+row.fetched,added:sum.added+row.added,updated:sum.updated+row.updated,skipped:sum.skipped+row.skipped,errors:sum.errors+row.errors}),{fetched:0,added:0,updated:0,skipped:0,errors:0});
  res.json({worker:latest.data||null,today:totals,nextScheduledAt:nextFiveMinutes(),apiStatus:'ok',sources:sources.data||[]});
});
async function runManualWorker(req:Request,res:Response,trigger:'manual'|'cron'|'vercel'|'railway'|'render'|'vps'){
  try{
    const source=typeof req.body?.source==='string'?req.body.source:typeof req.query.source==='string'?req.query.source:undefined;
    const result=await worker.run(trigger,source);
    res.status(result.status==='skipped'?202:result.status==='failed'?500:200).json({data:result.results,worker:result});
  }catch(error){res.status(500).json({error:error instanceof Error?error.message:'Worker failed'});}
}
app.post('/v1/admin/sync',requireStaff,async(req,res)=>{
  if(!await editorialRole((req as StaffRequest).userId!))return res.status(403).json({error:'Editorial role required'});
  return runManualWorker(req,res,'manual');
});

// Image research uses Google's official API and returns choices for an editor to approve.
// It never scrapes Google result pages and does not automatically copy a result into an article.
app.post('/v1/admin/image-search',requireStaff,async(req,res)=>{
  const title=typeof req.body?.title==='string'?req.body.title.trim():'';
  const originalUrl=typeof req.body?.originalUrl==='string'?req.body.originalUrl.trim():undefined;
  if(!title)return res.status(400).json({error:'Article title is required for image search.'});
  try{res.json({data:await findImageCandidates(title,originalUrl,5)});}
  catch(error){res.status(500).json({error:error instanceof Error?error.message:'Image search failed.'});}
});

const socialColour=(value:unknown,fallback:string)=>/^#[0-9a-f]{3}(?:[0-9a-f]{3})?$/i.test(String(value||''))?String(value):fallback;
function socialTemplatePayload(body:any){
  const slug=String(body?.slug||'').trim().toLowerCase().replace(/[^a-z0-9-]/g,'-').replace(/-+/g,'-').replace(/^-|-$/g,'');
  const name=String(body?.name||'').trim().slice(0,80);const categorySlug=String(body?.categorySlug||body?.category_slug||'latest').trim().toLowerCase().replace(/[^a-z0-9-]/g,'').slice(0,50)||'latest';
  const fontFamily=String(body?.fontFamily||body?.font_family||'Arial, Helvetica, sans-serif').replace(/[<>]/g,'').slice(0,120)||'Arial, Helvetica, sans-serif';
  const backgroundUrl=String(body?.backgroundUrl||body?.background_url||'').trim();
  if(!slug||!name)throw new Error('Template name and slug are required.');
  if(backgroundUrl&&!/^https:\/\//i.test(backgroundUrl))throw new Error('Template background must use a public HTTPS image URL.');
  return {slug,name,category_slug:categorySlug,accent_color:socialColour(body?.accentColor||body?.accent_color,'#E31E24'),background_color:socialColour(body?.backgroundColor||body?.background_color,'#003366'),font_family:fontFamily,background_url:backgroundUrl||null,text_position:typeof body?.textPosition==='object'&&body.textPosition?body.textPosition:{},enabled:body?.enabled!==false,is_default:body?.isDefault!==false};
}

app.get('/v1/admin/social/templates',requireStaff,async(_req,res)=>{
  try{res.json({data:await listSocialTemplates(db)});}catch(error){res.status(500).json({error:error instanceof Error?error.message:'Run the social graphics migration first.'});}
});
app.post('/v1/admin/social/templates',requireStaff,async(req,res)=>{
  try{const userId=(req as StaffRequest).userId!;if(!await editorialRole(userId))return res.status(403).json({error:'Editorial role required'});const payload=socialTemplatePayload(req.body);const {data,error}=await db.from('social_templates').upsert(payload,{onConflict:'slug'}).select('*').single();if(error)throw error;res.status(201).json({data});}
  catch(error){res.status(400).json({error:error instanceof Error?error.message:'Unable to save social template.'});}
});
app.patch('/v1/admin/social/templates/:id',requireStaff,async(req,res)=>{
  try{const userId=(req as StaffRequest).userId!;if(!await editorialRole(userId))return res.status(403).json({error:'Editorial role required'});const payload=socialTemplatePayload(req.body);const {data,error}=await db.from('social_templates').update(payload).eq('id',req.params.id).select('*').single();if(error)throw error;res.json({data});}
  catch(error){res.status(400).json({error:error instanceof Error?error.message:'Unable to update social template.'});}
});
app.post('/v1/admin/social/graphics/:articleId/regenerate',requireStaff,async(req,res)=>{
  try{const userId=(req as StaffRequest).userId!;if(!await editorialRole(userId))return res.status(403).json({error:'Editorial role required'});const {data:article,error}=await db.from('articles').select('id,slug,title,excerpt,ai_summary,featured_image_url,published_at,breaking,categories(name,slug)').eq('id',req.params.articleId).maybeSingle();if(error)throw error;if(!article)return res.status(404).json({error:'Article not found'});const graphicsArticle={...article,categories:Array.isArray(article.categories)?article.categories[0]||null:article.categories};const assets=await ensureSocialGraphics(db,graphicsArticle);if(!assets)return res.status(409).json({error:'Run social-graphics-upgrade.sql first.'});res.json({assets});}
  catch(error){res.status(500).json({error:error instanceof Error?error.message:'Unable to generate social graphics.'});}
});
app.get('/v1/social/templates/:slug/preview.svg',async(req,res)=>{
  try{const slug=String(req.params.slug||'');const templates=await listSocialTemplates(db).catch(()=>defaultSocialTemplates());const template=(templates as SocialTemplate[]).find(item=>item.slug===slug)||defaultSocialTemplates()[1];res.set('Cache-Control','public, max-age=300').type('image/svg+xml').send(renderSocialGraphicSvg(previewArticleForTemplate(template),template,'instagram_feed'));}
  catch{res.status(404).end();}
});

// Social credentials stay server-side. The admin stores a Railway variable name or uses an OAuth connection,
// never a raw token in the browser database.
app.get('/v1/admin/social',requireStaff,async(_req,res)=>{
  try{
    const [accounts,posts,logs]=await Promise.all([
      db.from('social_accounts').select('id,platform,display_name,account_id,credential_key,enabled,auto_post,category_slugs,posting_delay_minutes,post_template,auto_post_from,metadata,token_expires_at,last_success_at,last_error,created_at,updated_at').order('created_at',{ascending:false}),
      db.from('social_posts').select('id,account_id,article_id,platform,status,scheduled_for,attempts,max_attempts,platform_post_id,platform_post_url,last_error,posted_at,click_count,created_at,social_accounts(display_name),articles(title,slug)').order('created_at',{ascending:false}).limit(100),
      db.from('social_logs').select('id,platform,level,event,message,created_at,social_accounts(display_name)').order('created_at',{ascending:false}).limit(60)
    ]);
    if(accounts.error)throw accounts.error;if(posts.error)throw posts.error;if(logs.error)throw logs.error;
    const totals=(posts.data||[]).reduce((sum:any,row:any)=>{sum[row.platform]=(sum[row.platform]||0)+1;if(row.status==='published')sum.published++;if(row.status==='failed')sum.failed++;sum.clicks+=Number(row.click_count||0);return sum;},{published:0,failed:0,clicks:0});
    res.json({accounts:accounts.data||[],posts:posts.data||[],logs:logs.data||[],totals,platforms:socialPlatforms});
  }catch(error){res.status(500).json({error:error instanceof Error?error.message:'Unable to load social media data.'});}
});
app.post('/v1/admin/social/accounts',requireStaff,async(req,res)=>{
  try{
    const userId=(req as StaffRequest).userId!;if(!await editorialRole(userId))return res.status(403).json({error:'Editorial role required'});
    const platform=String(req.body?.platform||'').toLowerCase();const displayName=String(req.body?.displayName||'').trim();const accountId=String(req.body?.accountId||'').trim();const credentialKey=String(req.body?.credentialKey||'').trim();
    if(!socialPlatforms.includes(platform as any))return res.status(400).json({error:'Choose a supported social platform.'});
    if(!displayName||!accountId)return res.status(400).json({error:'Account name and account/page/channel ID are required.'});
    if(!/^[A-Z][A-Z0-9_]{2,128}$/.test(credentialKey))return res.status(400).json({error:'Enter the Railway environment-variable name that holds this account token, for example TELEGRAM_BOT_TOKEN.'});
    const categorySlugs=Array.isArray(req.body?.categorySlugs)?req.body.categorySlugs.map((value:any)=>String(value).trim().toLowerCase()).filter(Boolean).slice(0,20):[];
    const delay=[0,5,15,60].includes(Number(req.body?.postingDelayMinutes))?Number(req.body.postingDelayMinutes):0;
    const template=String(req.body?.postTemplate||'{breaking}{headline}\n\n{summary}\n\nRead more:\n{url}\n\n{hashtags}').slice(0,2000);
    const {data,error}=await db.from('social_accounts').upsert({platform,display_name:displayName,account_id:accountId,credential_key:credentialKey,enabled:Boolean(req.body?.enabled),auto_post:req.body?.autoPost!==false,category_slugs:categorySlugs,posting_delay_minutes:delay,post_template:template,auto_post_from:new Date().toISOString(),metadata:{connection:'environment-variable'},created_by:userId},{onConflict:'platform,account_id'}).select('id,platform,display_name,account_id,enabled').single();
    if(error)throw error;res.status(201).json({data});
  }catch(error){res.status(500).json({error:error instanceof Error?error.message:'Unable to save social account.'});}
});
app.patch('/v1/admin/social/accounts/:id',requireStaff,async(req,res)=>{
  try{
    const userId=(req as StaffRequest).userId!;if(!await editorialRole(userId))return res.status(403).json({error:'Editorial role required'});
    const update:any={};if(typeof req.body?.enabled==='boolean')update.enabled=req.body.enabled;if(typeof req.body?.autoPost==='boolean')update.auto_post=req.body.autoPost;
    if(Array.isArray(req.body?.categorySlugs))update.category_slugs=req.body.categorySlugs.map((value:any)=>String(value).trim().toLowerCase()).filter(Boolean).slice(0,20);
    if([0,5,15,60].includes(Number(req.body?.postingDelayMinutes)))update.posting_delay_minutes=Number(req.body.postingDelayMinutes);
    if(typeof req.body?.postTemplate==='string')update.post_template=req.body.postTemplate.slice(0,2000);
    if(typeof req.body?.credentialKey==='string'&&req.body.credentialKey.trim()){
      if(!/^[A-Z][A-Z0-9_]{2,128}$/.test(req.body.credentialKey.trim()))return res.status(400).json({error:'Credential key must be an environment-variable name.'});update.credential_key=req.body.credentialKey.trim();
    }
    const {data,error}=await db.from('social_accounts').update(update).eq('id',req.params.id).select('id,platform,display_name,enabled,auto_post').single();if(error)throw error;res.json({data});
  }catch(error){res.status(500).json({error:error instanceof Error?error.message:'Unable to update social account.'});}
});
app.post('/v1/admin/social/posts/:id/retry',requireStaff,async(req,res)=>{
  try{const userId=(req as StaffRequest).userId!;if(!await editorialRole(userId))return res.status(403).json({error:'Editorial role required'});const {data,error}=await db.from('social_posts').update({status:'pending',attempts:0,next_attempt_at:new Date().toISOString(),last_error:null,locked_at:null}).eq('id',req.params.id).select('id,status').single();if(error)throw error;res.json({data});}
  catch(error){res.status(500).json({error:error instanceof Error?error.message:'Unable to retry social post.'});}
});
app.post('/v1/admin/social/oauth/:platform',requireStaff,async(req,res)=>{
  try{const userId=(req as StaffRequest).userId!;const platform=String(req.params.platform);if(!await editorialRole(userId))return res.status(403).json({error:'Editorial role required'});res.json(await beginSocialOAuth(db,platform,userId));}
  catch(error){res.status(400).json({error:error instanceof Error?error.message:'Unable to start social connection.'});}
});
app.get('/v1/social/oauth/:platform/callback',async(req,res)=>{
  try{const platform=String(req.params.platform);const state=typeof req.query.state==='string'?req.query.state:'';const code=typeof req.query.code==='string'?req.query.code:'';if(!state||!code)throw new Error('The platform did not return an authorization code.');const connection=await completeSocialOAuth(db,platform,state,code);res.type('html').send(`<!doctype html><title>LK Newsroom connection complete</title><body style="font-family:system-ui;margin:48px;background:#f5f8fb;color:#071b2d"><h1>Connected to ${escHtml(connection.displayName)}</h1><p>${escHtml(connection.platform)} is ready for LK Newsroom auto-posting. You may close this window and return to the Social Media screen.</p></body>`);}
  catch(error){res.status(400).type('html').send(`<!doctype html><title>Connection failed</title><body style="font-family:system-ui;margin:48px;background:#f5f8fb;color:#071b2d"><h1>Social connection failed</h1><p>${escHtml(error instanceof Error?error.message:'Try again from Admin → Social Media.')}</p></body>`);}
});
app.get('/go/social/:postId',async(req,res)=>{
  const {data,error}=await db.from('social_posts').select('id,article_url').eq('id',req.params.postId).maybeSingle();if(error||!data)return res.redirect(302,'/');
  const {error:rpcError}=await db.rpc('increment_social_click',{social_post_uuid:data.id});if(rpcError)console.warn('Social click tracking failed:',rpcError.message);
  res.redirect(302,data.article_url);
});
app.get('/v1/social/cards/:identifier.svg',async(req,res)=>{
  try{const identifier=req.params.identifier.replace(/\.svg$/i,'');const article=await articleByIdentifier(identifier);if(!article)return res.status(404).end();res.set('Cache-Control','public, max-age=3600').type('image/svg+xml').send(brandedSocialCardSvg(article));}
  catch{res.status(404).end();}
});
app.all('/api/news/update',requireCronOrStaff,async(req,res)=>runManualWorker(req,res,'cron'));

app.get('/robots.txt',(req,res)=>res.type('text/plain').send(`User-agent: *\nAllow: /\nDisallow: /admin/\nSitemap: ${publicOrigin(req)}/sitemap.xml\n`));
app.get('/sitemap.xml',async(req,res)=>{
  try{
    const origin=publicOrigin(req);const {data,error}=await db.from('articles').select('slug,id,updated_at,published_at').eq('status','published').is('duplicate_of',null).order('published_at',{ascending:false}).limit(5000);
    if(error)throw error;
    const staticPaths=['/','/category/ghana','/category/politics','/category/business','/category/technology','/category/entertainment','/category/sports','/category/health','/category/education','/category/africa','/category/world','/category/opinion','/pages/about.html','/pages/contact.html','/pages/privacy.html','/pages/terms.html'];
    const urls=[...staticPaths.map(path=>`<url><loc>${escXml(`${origin}${path}`)}</loc></url>`),...(data||[]).map(article=>`<url><loc>${escXml(`${origin}/news/${encodeURIComponent(article.slug||article.id)}`)}</loc><lastmod>${new Date(article.updated_at||article.published_at).toISOString()}</lastmod></url>`)].join('');
    res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`);
  }catch(error){res.status(500).type('text/plain').send(error instanceof Error?error.message:'Unable to build sitemap');}
});

// A canonical article route with crawlable metadata. The browser still loads the live article data from Supabase.
app.get('/news/:identifier',async(req,res)=>{
  try{const article=await articleByIdentifier(req.params.identifier);if(!article)return res.status(404).sendFile(`${process.cwd()}/404.html`);res.type('html').send(await articleDocument(req,article));}
  catch{res.status(500).sendFile(`${process.cwd()}/pages/article.html`);}
});
// Each desk has its own stable URL, while a single reusable page loads the selected category.
app.get('/category/:slug',(_req,res)=>res.sendFile(`${process.cwd()}/pages/category.html`));
const port=Number(process.env.PORT||5173);
app.use(express.static(process.cwd()));
app.use((_req,res)=>res.status(404).sendFile(`${process.cwd()}/404.html`));

if(process.env.ENABLE_NODE_CRON!=='false')cron.schedule('*/5 * * * *',()=>{void worker.run('cron').catch(error=>console.error('Scheduled worker failed:',error));},{timezone:process.env.TZ||'Africa/Accra'});
if(process.env.SYNC_ON_BOOT==='true')void worker.run('startup').catch(error=>console.error('Initial worker failed:',error));
app.listen(port,()=>console.log(`LK News Aggregator listening on http://localhost:${port}`));
