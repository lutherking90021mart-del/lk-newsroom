import 'dotenv/config';
import express,{type NextFunction,type Request,type Response} from 'express';
import cors from 'cors';
import cron from 'node-cron';
import {createClient} from '@supabase/supabase-js';
import {NewsWorker} from '../worker/newsWorker.js';
import {findImageCandidates} from '../services/googleImageSearch.js';

const url=process.env.SUPABASE_URL;
const serviceKey=process.env.SUPABASE_SERVICE_ROLE_KEY;
if(!url||!serviceKey)throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required on the server.');
const db=createClient(url,serviceKey,{auth:{persistSession:false}});
const worker=new NewsWorker(db);
const app=express();
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

app.get('/health',async(_req,res)=>{
  const {data}=await db.from('worker_runs').select('status,completed_at,started_at').order('started_at',{ascending:false}).limit(1).maybeSingle();
  res.json({status:'ok',service:'lk-news-aggregator',updatedAt:new Date().toISOString(),worker:data||null});
});

app.get('/v1/news',async(req,res)=>{
  // Offset pagination keeps every section useful as the newsroom grows beyond its first stories.
  const limit=Math.min(Math.max(Number(req.query.limit)||30,1),48);
  const offset=Math.min(Math.max(Number(req.query.offset)||0,0),4_800);
  let query=db.from('articles').select(publicArticleFields,{count:'exact'}).eq('status','published').eq('is_aggregated',true).is('duplicate_of',null).order('published_at',{ascending:false});
  if(typeof req.query.category==='string')query=query.eq('categories.slug',req.query.category);
  if(typeof req.query.country==='string')query=query.eq('country',req.query.country);
  if(typeof req.query.author==='string')query=query.ilike('authors.name',`%${req.query.author.slice(0,80)}%`);
  if(typeof req.query.q==='string')query=query.ilike('title',`%${req.query.q.slice(0,80)}%`);
  if(typeof req.query.from==='string')query=query.gte('published_at',req.query.from);
  if(typeof req.query.to==='string')query=query.lte('published_at',req.query.to);
  if(typeof req.query.source==='string'){
    const {data:source}=await db.from('news_sources').select('id').eq('slug',req.query.source).maybeSingle();
    if(source)query=query.eq('source_id',source.id);
  }
  const {data,error,count}=await query.range(offset,offset+limit-1);
  if(error)return res.status(500).json({error:error.message});
  res.json({data,total:count||0,offset,limit,updatedAt:new Date().toISOString()});
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
app.all('/api/news/update',requireCronOrStaff,async(req,res)=>runManualWorker(req,res,'cron'));

// A human-readable canonical route for every article. The browser then requests only that article's data.
app.get('/news/:identifier',(_req,res)=>res.sendFile(`${process.cwd()}/pages/article.html`));
const port=Number(process.env.PORT||5173);
app.use(express.static(process.cwd()));
app.use((_req,res)=>res.status(404).sendFile(`${process.cwd()}/404.html`));

if(process.env.ENABLE_NODE_CRON!=='false')cron.schedule('*/5 * * * *',()=>{void worker.run('cron').catch(error=>console.error('Scheduled worker failed:',error));},{timezone:process.env.TZ||'Africa/Accra'});
if(process.env.SYNC_ON_BOOT==='true')void worker.run('startup').catch(error=>console.error('Initial worker failed:',error));
app.listen(port,()=>console.log(`LK News Aggregator listening on http://localhost:${port}`));
