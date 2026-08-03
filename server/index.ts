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

app.use(cors({origin:process.env.PUBLIC_ORIGIN?.split(',')||true}));
app.use(express.json({limit:'100kb'}));

interface StaffRequest extends Request { userId?:string; }
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
function nextFiveMinutes(){return new Date((Math.floor(Date.now()/300_000)+1)*300_000).toISOString();}
const escHtml=(value:unknown)=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]!));
const escXml=(value:unknown)=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[char]!));
function publicOrigin(req:Request){return (process.env.PUBLIC_ORIGIN?.split(',')[0]||`${req.protocol}://${req.get('host')}`).replace(/\/$/,'');}
function plainText(value:unknown){return String(value??'').replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim();}
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

app.get('/v1/news',async(req,res)=>{
  // Offset pagination keeps every section useful as the newsroom grows beyond its first stories.
  const limit=Math.min(Math.max(Number(req.query.limit)||30,1),48);
  const offset=Math.min(Math.max(Number(req.query.offset)||0,0),4_800);
  const view=typeof req.query.view==='string'?req.query.view:'latest';
  const sortByViews=view==='trending'||view==='most-read';
  let query=db.from('articles').select(publicArticleFields,{count:'exact'}).eq('status','published').eq('is_aggregated',true).is('duplicate_of',null).order(sortByViews?'view_count':'published_at',{ascending:false}).order('published_at',{ascending:false});
  if(typeof req.query.category==='string')query=query.eq('categories.slug',req.query.category);
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
  try{const userId=(req as StaffRequest).userId!;if(!await editorialRole(userId))return res.status(403).json({error:'Editorial role required'});const {data:article,error}=await db.from('articles').select('id,slug,title,excerpt,ai_summary,featured_image_url,published_at,breaking,categories(name,slug)').eq('id',req.params.articleId).maybeSingle();if(error)throw error;if(!article)return res.status(404).json({error:'Article not found'});const assets=await ensureSocialGraphics(db,article);if(!assets)return res.status(409).json({error:'Run social-graphics-upgrade.sql first.'});res.json({assets});}
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
