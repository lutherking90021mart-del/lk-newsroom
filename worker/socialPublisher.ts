import type { SupabaseClient } from '@supabase/supabase-js';
import { decryptSocialToken } from '../services/socialCrypto.js';
import { defaultSocialTemplates, ensureSocialGraphics, graphicUrlForPlatform, hasCompleteSocialGraphicAssets, renderSocialGraphicSvg, type SocialGraphicArticle, type SocialGraphicAssets } from '../services/socialGraphics.js';

export const socialPlatforms=['facebook','instagram','threads','x','linkedin','telegram'] as const;
export type SocialPlatform=typeof socialPlatforms[number];
type Account={id:string;platform:SocialPlatform;display_name:string;account_id:string;credential_key?:string|null;credentials_encrypted?:string|null;enabled:boolean;auto_post:boolean;category_slugs?:string[];posting_delay_minutes:number;post_template:string;auto_post_from:string;created_at?:string;metadata?:Record<string,unknown>;last_success_at?:string|null;};
type Article=SocialGraphicArticle & {created_at?:string|null;country?:string|null;auto_tags?:string[]|null;};
type SocialPost={id:string;account_id:string;article_id:string;platform:SocialPlatform;post_text:string;article_url:string;image_url?:string|null;attempts:number;max_attempts:number;next_attempt_at?:string|null;social_accounts:Account;articles:Article;};
export type SocialRunResult={status:'completed'|'skipped'|'unavailable';queued:number;published:number;retried:number;failed:number;activatedScheduled:number;graphicsGenerated:number;errors:number;};

const text=(value:unknown)=>String(value??'').replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim();
const cleanTag=(value:string)=>value.replace(/[^\p{L}\p{N}]/gu,'');
const escXml=(value:unknown)=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[char]!));
const origin=()=>String(process.env.PUBLIC_ORIGIN||'http://localhost:5173').split(',')[0].replace(/\/$/,'');
const isRasterImage=(url:string)=>/^https:\/\//i.test(url)&&/\.(?:jpe?g|png|webp)(?:[?#]|$)/i.test(url);
const graphVersion=()=>process.env.META_GRAPH_VERSION||'v23.0';

function lineWrap(value:string,max=28,limit=4){
  const words=value.split(/\s+/);const lines:string[]=[];let line='';
  for(const word of words){const next=line?`${line} ${word}`:word;if(next.length>max&&line){lines.push(line);line=word;if(lines.length===limit)break;}else line=next;}
  if(line&&lines.length<limit)lines.push(line);return lines;
}

/** A title-specific fallback graphic for social cards when a source supplied no usable photo. */
export function brandedSocialCardSvg(article:Pick<Article,'title'|'categories'>){
  const articleForGraphic={id:'fallback',title:article.title,categories:article.categories};const category=(article.categories?.slug||'latest').toLowerCase();const template=defaultSocialTemplates().find(item=>item.category_slug===category)||defaultSocialTemplates()[1];
  return renderSocialGraphicSvg(articleForGraphic,template,'facebook_post');
}

function articleUrl(article:Article){return `${origin()}/news/${encodeURIComponent(article.slug||article.id)}`;}
function imageUrl(article:Article){return article.featured_image_url?.startsWith('https://')?article.featured_image_url:`${origin()}/v1/social/cards/${encodeURIComponent(article.slug||article.id)}.svg`;}
function hashtags(article:Article){
  const values=['LKNewsroom',article.categories?.name||'',article.country||'',...(article.auto_tags||[]).slice(0,3)].map(cleanTag).filter(Boolean);
  return [...new Set(values)].map(value=>`#${value}`).join(' ');
}
function postText(article:Article,account:Account){
  const summary=text(article.ai_summary||article.excerpt||'Read the latest verified reporting from LK Newsroom.').slice(0,320);
  const values:Record<string,string>={headline:article.title,summary,url:articleUrl(article),hashtags:hashtags(article),breaking:article.breaking?'🚨 BREAKING NEWS\n\n':''};
  return (account.post_template||'{breaking}{headline}\n\n{summary}\n\nRead more:\n{url}\n\n{hashtags}').replace(/\{(headline|summary|url|hashtags|breaking)\}/g,(_match,key)=>values[key]||'').replace(/\n{3,}/g,'\n\n').trim();
}
function tokenFor(account:Account){
  if(account.credentials_encrypted)return decryptSocialToken(account.credentials_encrypted);
  const key=account.credential_key?.trim();if(key&&process.env[key])return process.env[key]!;
  throw new Error(`No server credential is available for ${account.display_name}. Add the token in Railway and set its variable name on the account.`);
}
async function apiRequest(url:string,init:RequestInit){
  const response=await fetch(url,{...init,signal:AbortSignal.timeout(25_000)});const payload=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(payload?.error?.message||payload?.description||payload?.detail||`Platform returned ${response.status}`);
  return payload as Record<string,any>;
}
const form=(values:Record<string,string>)=>new URLSearchParams(Object.entries(values).filter(([,value])=>value!==undefined&&value!==null) as [string,string][]).toString();

async function publishFacebook(account:Account,post:SocialPost,token:string){
  const image=post.image_url||'';const message=post.post_text;
  if(isRasterImage(image)){
    const payload=await apiRequest(`https://graph.facebook.com/${graphVersion()}/${encodeURIComponent(account.account_id)}/photos`,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:form({url:image,caption:message,access_token:token})});
    return {id:String(payload.id||payload.post_id||''),url:''};
  }
  const payload=await apiRequest(`https://graph.facebook.com/${graphVersion()}/${encodeURIComponent(account.account_id)}/feed`,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:form({message,link:post.article_url,access_token:token})});
  return {id:String(payload.id||''),url:''};
}
async function publishInstagram(account:Account,post:SocialPost,token:string){
  if(!isRasterImage(post.image_url||''))throw new Error('Instagram needs a public JPG, PNG, or WebP featured image. Add one in the article editor before retrying.');
  const container=await apiRequest(`https://graph.facebook.com/${graphVersion()}/${encodeURIComponent(account.account_id)}/media`,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:form({image_url:post.image_url!,caption:post.post_text,access_token:token})});
  const payload=await apiRequest(`https://graph.facebook.com/${graphVersion()}/${encodeURIComponent(account.account_id)}/media_publish`,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:form({creation_id:String(container.id),access_token:token})});
  return {id:String(payload.id||''),url:''};
}
async function publishThreads(account:Account,post:SocialPost,token:string){
  const values:isRecord={media_type:isRasterImage(post.image_url||'')?'IMAGE':'TEXT',text:post.post_text,access_token:token};
  if(values.media_type==='IMAGE')values.image_url=post.image_url||'';
  const container=await apiRequest(`https://graph.threads.net/v1.0/${encodeURIComponent(account.account_id)}/threads`,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:form(values)});
  const payload=await apiRequest(`https://graph.threads.net/v1.0/${encodeURIComponent(account.account_id)}/threads_publish`,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:form({creation_id:String(container.id),access_token:token})});
  return {id:String(payload.id||''),url:''};
}
type isRecord=Record<string,string>;
async function publishX(_account:Account,post:SocialPost,token:string){
  const textValue=post.post_text.length>280?`${post.post_text.slice(0,276).trimEnd()}…`:post.post_text;
  const payload=await apiRequest('https://api.x.com/2/tweets',{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({text:textValue})});
  return {id:String(payload.data?.id||''),url:payload.data?.id?`https://x.com/i/web/status/${payload.data.id}`:''};
}
async function publishLinkedIn(account:Account,post:SocialPost,token:string){
  const payload=await apiRequest('https://api.linkedin.com/rest/posts',{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json','X-Restli-Protocol-Version':'2.0.0','Linkedin-Version':process.env.LINKEDIN_API_VERSION||'202601'},body:JSON.stringify({author:account.account_id.startsWith('urn:')?account.account_id:`urn:li:organization:${account.account_id}`,commentary:post.post_text,visibility:'PUBLIC',distribution:{feedDistribution:'MAIN_FEED',targetEntities:[],thirdPartyDistributionChannels:[]},lifecycleState:'PUBLISHED',isReshareDisabledByAuthor:false})});
  return {id:String(payload.id||''),url:''};
}
async function publishTelegram(account:Account,post:SocialPost,token:string){
  const base=`https://api.telegram.org/bot${token}`;const values={chat_id:account.account_id,caption:post.post_text,parse_mode:'HTML'};
  const payload=isRasterImage(post.image_url||'')?await apiRequest(`${base}/sendPhoto`,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:form({...values,photo:post.image_url||''})}):await apiRequest(`${base}/sendMessage`,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:form({chat_id:account.account_id,text:post.post_text,disable_web_page_preview:'false'})});
  return {id:String(payload.result?.message_id||''),url:''};
}

async function publish(account:Account,post:SocialPost){
  const token=tokenFor(account);
  const trackingUrl=`${origin()}/go/social/${encodeURIComponent(post.id)}`;
  const outgoing={...post,article_url:trackingUrl,post_text:post.post_text.replace(post.article_url,trackingUrl)};
  if(account.platform==='facebook')return publishFacebook(account,outgoing,token);
  if(account.platform==='instagram')return publishInstagram(account,outgoing,token);
  if(account.platform==='threads')return publishThreads(account,outgoing,token);
  if(account.platform==='x')return publishX(account,outgoing,token);
  if(account.platform==='linkedin')return publishLinkedIn(account,outgoing,token);
  return publishTelegram(account,outgoing,token);
}

export class SocialPublisher {
  constructor(private db:SupabaseClient){}
  async run():Promise<SocialRunResult>{
    const empty={status:'completed' as const,queued:0,published:0,retried:0,failed:0,activatedScheduled:0,graphicsGenerated:0,errors:0};
    const {data:locked,error:lockError}=await this.db.rpc('acquire_news_worker_lock',{p_lock_name:'social-publishing',lease_seconds:270});
    if(lockError){if(/social_(accounts|posts)|relation.*does not exist/i.test(lockError.message||''))return {...empty,status:'unavailable' as const};throw lockError;}
    if(!locked)return {...empty,status:'skipped' as const};
    try{
      empty.activatedScheduled=await this.activateScheduledArticles();
      empty.graphicsGenerated=await this.generateRecentGraphics();
      empty.queued=await this.queueEligibleArticles();
      const outcome=await this.publishDuePosts();Object.assign(empty,outcome);
      return empty;
    }catch(error){
      if(/social_(accounts|posts)|relation.*does not exist/i.test(error instanceof Error?error.message:''))return {...empty,status:'unavailable' as const};
      throw error;
    }finally{await this.db.rpc('release_news_worker_lock',{p_lock_name:'social-publishing'});}
  }
  private async activateScheduledArticles(){
    const now=new Date().toISOString();const {data,error}=await this.db.from('articles').update({status:'published',published_at:now}).eq('status','scheduled').lte('scheduled_at',now).select('id');if(error)throw error;return data?.length||0;
  }
  private async generateRecentGraphics(){
    const {data:articles,error:articleError}=await this.db.from('articles').select('id,slug,title,excerpt,ai_summary,featured_image_url,breaking,published_at,created_at,categories(name,slug)').eq('status','published').order('updated_at',{ascending:false}).limit(80);if(articleError)throw articleError;
    const ids=(articles||[]).map((article:any)=>article.id);if(!ids.length)return 0;
    const {data:stored,error:storedError}=await this.db.from('social_graphics').select('article_id,source_image_url,assets').in('article_id',ids);if(storedError){if(/social_graphics|relation.*does not exist|PGRST205/i.test(storedError.message||''))return 0;throw storedError;}
    const storedByArticle=new Map((stored||[]).map((row:any)=>[row.article_id,row]));let generated=0;
    for(const article of articles as Article[]){const current=storedByArticle.get(article.id);if(current&&hasCompleteSocialGraphicAssets(current.assets)&&String(current.source_image_url||'')===String(article.featured_image_url||''))continue;const assets=await ensureSocialGraphics(this.db,article);if(assets)generated++;}
    return generated;
  }
  private async queueEligibleArticles(){
    const [{data:accounts,error:accountError},{data:articles,error:articleError}]=await Promise.all([
      this.db.from('social_accounts').select('*').eq('enabled',true).eq('auto_post',true),
      this.db.from('articles').select('id,slug,title,excerpt,ai_summary,featured_image_url,breaking,published_at,created_at,country,auto_tags,categories(name,slug)').eq('status','published').order('updated_at',{ascending:false}).limit(600)
    ]);if(accountError)throw accountError;if(articleError)throw articleError;
    let queued=0;const now=Date.now();const graphicCache=new Map<string,Promise<SocialGraphicAssets|null>>();
    const graphicsFor=(article:Article)=>{let graphic=graphicCache.get(article.id);if(!graphic){graphic=ensureSocialGraphics(this.db,article).catch(error=>{console.warn(`Social graphic generation failed for ${article.id}:`,error instanceof Error?error.message:error);return null;});graphicCache.set(article.id,graphic);}return graphic;};
    for(const account of (accounts||[]) as Account[])for(const article of (articles||[]) as Article[]){
      const started=new Date(account.auto_post_from||account.created_at||0).getTime();const published=new Date(article.published_at||0).getTime();const created=new Date(article.created_at||0).getTime();
      if(Math.max(published,created)<started)continue;
      const allowed=account.category_slugs||[];if(allowed.length&&(!article.categories?.slug||!allowed.includes(article.categories.slug)))continue;
      const scheduledFor=new Date(Math.max(now,published||now)+Number(account.posting_delay_minutes||0)*60_000).toISOString();const graphics=await graphicsFor(article);const generatedGraphic=graphicUrlForPlatform(graphics||undefined,account.platform);
      const {error}=await this.db.from('social_posts').upsert({account_id:account.id,article_id:article.id,platform:account.platform,status:account.posting_delay_minutes?'scheduled':'pending',post_text:postText(article,account),article_url:articleUrl(article),image_url:generatedGraphic||imageUrl(article),scheduled_for:scheduledFor},{onConflict:'account_id,article_id',ignoreDuplicates:true});
      if(error)throw error;queued++;
    }
    return queued;
  }
  private async publishDuePosts(){
    const now=new Date();const stale=new Date(now.getTime()-15*60_000).toISOString();
    await this.db.from('social_posts').update({status:'retry',locked_at:null,next_attempt_at:now.toISOString(),last_error:'Recovered after an interrupted worker run.'}).eq('status','processing').lt('locked_at',stale);
    const {data,error}=await this.db.from('social_posts').select('*,social_accounts(*),articles(id,slug,title,excerpt,ai_summary,featured_image_url,breaking,published_at,created_at,country,auto_tags,categories(name,slug))').in('status',['pending','scheduled','retry']).lte('scheduled_for',now.toISOString()).order('scheduled_for').limit(24);
    if(error)throw error;let published=0,retried=0,failed=0,errors=0;
    for(const post of (data||[]) as SocialPost[]){
      if(post.next_attempt_at&&new Date(post.next_attempt_at)>now)continue;
      const account=post.social_accounts;if(!account?.enabled){await this.db.from('social_posts').update({status:'cancelled',last_error:'Social account disabled.'}).eq('id',post.id);continue;}
      const attempts=Number(post.attempts||0)+1;await this.db.from('social_posts').update({status:'processing',attempts,locked_at:now.toISOString()}).eq('id',post.id);
      try{
        const result=await publish(account,post);const postedAt=new Date().toISOString();
        await this.db.from('social_posts').update({status:'published',posted_at:postedAt,platform_post_id:result.id||null,platform_post_url:result.url||null,locked_at:null,next_attempt_at:null,last_error:null}).eq('id',post.id);
        await this.db.from('social_accounts').update({last_success_at:postedAt,last_error:null}).eq('id',account.id);
        await this.log(post,'info','published','Post published successfully.',{platformPostId:result.id});published++;
      }catch(error){
        errors++;const message=error instanceof Error?error.message:String(error);const isFinal=attempts>=Number(post.max_attempts||5);const retryAt=new Date(Date.now()+Math.min(60,2**attempts)*60_000).toISOString();
        await this.db.from('social_posts').update({status:isFinal?'failed':'retry',last_error:message,locked_at:null,next_attempt_at:isFinal?null:retryAt}).eq('id',post.id);
        await this.db.from('social_accounts').update({last_error:message}).eq('id',account.id);
        await this.log(post,isFinal?'error':'warning',isFinal?'failed':'retry_scheduled',message,{attempts,nextAttemptAt:isFinal?null:retryAt});if(isFinal)failed++;else retried++;
      }
    }
    return {published,retried,failed,errors};
  }
  private async log(post:SocialPost,level:'info'|'warning'|'error',event:string,message:string,details:Record<string,unknown>={}){await this.db.from('social_logs').insert({social_post_id:post.id,account_id:post.account_id,platform:post.platform,level,event,message,details});}
}
