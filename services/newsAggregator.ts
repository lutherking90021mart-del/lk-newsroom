import crypto from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { providers } from '../providers/catalog.js';
import type { NewsProvider, NormalizedNewsArticle } from '../providers/types.js';
import { TimedCache } from './cache.js';
import { fetchPublisherFeed } from '../worker/rssFetcher.js';
import { createSeoMetadata } from '../worker/seoGenerator.js';
import { findDuplicate } from '../worker/duplicateChecker.js';
import { classifyCategory } from '../worker/categoryClassifier.js';
import { cacheFeedImage } from '../worker/imageDownloader.js';
import { notifyAdminOfSourceFailure } from './notifier.js';

type SyncResult={source:string;fetched:number;inserted:number;updated:number;duplicates:number;status:'success'|'error';error?:string};
const slugify=(value:string)=>value.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g,'-').replace(/(^-|-$)/g,'').slice(0,120);
const breakingTerms=/\b(breaking|just in|developing|urgent|emergency|alert|dies|dead|resigns?)\b/i;

/**
 * Server-side RSS/API ingestion. It stores feed metadata and canonical links only;
 * no article page is requested or scraped.
 */
export class NewsAggregator {
  private cache=new TimedCache<NormalizedNewsArticle[]>();
  constructor(private db:SupabaseClient,private sourceProviders:NewsProvider[]=providers) {}

  async registerSources(){
    const rows=this.sourceProviders.map(({source})=>({slug:source.slug,name:source.name,source_type:source.sourceType,feed_url:source.feedUrl||null,api_endpoint:source.apiEndpoint||null,api_secret_name:source.apiSecretName||null,country:source.country,default_category:source.category,enabled:source.enabled}));
    await this.db.from('news_sources').upsert(rows,{onConflict:'slug',ignoreDuplicates:true});
    const {data,error}=await this.db.from('news_sources').select('id,slug,enabled'); if(error)throw error;
    return new Map((data||[]).map(row=>[row.slug,row]));
  }
  async syncAll(sourceSlug?:string){
    const sourceRows=await this.registerSources();
    const choices=sourceSlug?this.sourceProviders.filter(provider=>provider.source.slug===sourceSlug):this.sourceProviders;
    const results:SyncResult[]=[];
    for(const provider of choices){ const row=sourceRows.get(provider.source.slug); if(!row?.enabled){continue;} results.push(await this.syncProvider(provider,row.id)); }
    await this.rebuildTrending(); await this.rebuildFeatured(); return results;
  }
  private async fetchWithRetry(provider:NewsProvider){
    const cached=this.cache.get(provider.source.slug); if(cached)return cached;
    const articles=await fetchPublisherFeed(provider);
    return this.cache.set(provider.source.slug,articles,120_000);
  }
  private async syncProvider(provider:NewsProvider,sourceId:string):Promise<SyncResult>{
    const result:SyncResult={source:provider.source.slug,fetched:0,inserted:0,updated:0,duplicates:0,status:'success'};
    const began=Date.now();
    try { const articles=await this.fetchWithRetry(provider); result.fetched=articles.length;
      for(const article of articles.slice(0,100)){const outcome=await this.persist(article,sourceId); if(outcome==='inserted')result.inserted++;if(outcome==='updated')result.updated++;if(outcome==='duplicate')result.duplicates++;}
      await this.db.from('news_sources').update({last_synced_at:new Date().toISOString(),last_status:'success',last_error:null,consecutive_failures:0}).eq('id',sourceId);
      await this.log(sourceId,'info','sync_completed',result,Date.now()-began);
    }catch(error){
      result.status='error'; result.error=error instanceof Error?error.message:String(error);
      const {data:previous}=await this.db.from('news_sources').select('consecutive_failures,last_alerted_at').eq('id',sourceId).maybeSingle();
      const failures=Number(previous?.consecutive_failures||0)+1;
      const now=new Date(); const lastAlert=previous?.last_alerted_at?new Date(previous.last_alerted_at).getTime():0;
      await this.db.from('news_sources').update({last_synced_at:now.toISOString(),last_status:'error',last_error:result.error,consecutive_failures:failures}).eq('id',sourceId);
      const threshold=Math.max(1,Number(process.env.SOURCE_FAILURE_THRESHOLD||3));
      if(failures>=threshold&&Date.now()-lastAlert>3_600_000){
        await notifyAdminOfSourceFailure(provider.source.name,result.error,failures);
        await this.db.from('news_sources').update({last_alerted_at:now.toISOString()}).eq('id',sourceId);
      }
      await this.log(sourceId,'error','sync_failed',{error:result.error,failures},Date.now()-began);
    }
    return result;
  }
  private async persist(article:NormalizedNewsArticle,sourceId:string):Promise<'inserted'|'updated'|'duplicate'>{
    const ai=await createSeoMetadata(article); const externalId=article.externalId||article.url;
    const duplicate=await findDuplicate(this.db,sourceId,externalId,ai.contentHash);
    if(duplicate?.kind==='cross_source'){await this.log(sourceId,'info','duplicate_skipped',{url:article.url,duplicateOf:duplicate.existingId});return 'duplicate';}
    const categoryId=await this.categoryId(classifyCategory(article)); const authorId=await this.authorId(sourceId,article.author);
    const image=await cacheFeedImage(this.db,article.image);
    const slug=`${article.sourceSlug}-${slugify(article.title)}-${crypto.createHash('sha1').update(externalId).digest('hex').slice(0,9)}`;
    const payload={source_id:sourceId,external_id:externalId,external_author_id:authorId,category_id:categoryId,title:article.title,slug,excerpt:article.description,content:article.content||article.description,content_markdown:article.content||article.description,featured_image_url:image,original_url:article.url,canonical_url:article.url,source_updated_at:article.updatedAt||article.publishedAt,country:article.country,status:'published',published_at:article.publishedAt,meta_title:article.title.slice(0,120),meta_description:ai.metaDescription,ai_summary:ai.summary,auto_tags:ai.tags,content_hash:ai.contentHash,is_aggregated:true,allow_comments:false,raw_payload:article.raw||{}};
    const {error}=await this.db.from('articles').upsert(payload,{onConflict:'source_id,external_id'}); if(error)throw error;
    const {data:saved,error:findError}=await this.db.from('articles').select('id').eq('source_id',sourceId).eq('external_id',externalId).single(); if(findError)throw findError;
    await this.saveTags(saved.id,ai.tags); await this.saveLiveUpdate(saved.id,article);
    if(breakingTerms.test(`${article.title} ${article.description}`))await this.db.from('breaking_news').upsert({article_id:saved.id,headline:article.title,link_url:article.url,active:true,pinned:false,starts_at:article.publishedAt},{onConflict:'article_id'});
    return duplicate?.kind==='existing'?'updated':'inserted';
  }
  private async categoryId(name:string){const slug=slugify(name||'General');const {data,error}=await this.db.from('categories').upsert({name:name||'General',slug},{onConflict:'slug'}).select('id').single();if(error)throw error;return data.id;}
  private async authorId(sourceId:string,name?:string){if(!name)return null;const {data,error}=await this.db.from('authors').upsert({source_id:sourceId,name,slug:slugify(name)},{onConflict:'source_id,name'}).select('id').single();if(error)throw error;return data.id;}
  private async saveTags(articleId:string,tags:string[]){for(const name of tags){const slug=slugify(name);const {data,error}=await this.db.from('tags').upsert({name,slug},{onConflict:'slug'}).select('id').single();if(error)throw error;await this.db.from('article_tags').upsert({article_id:articleId,tag_id:data.id},{onConflict:'article_id,tag_id'});}}
  private async saveLiveUpdate(articleId:string,article:NormalizedNewsArticle){await this.db.from('live_updates').upsert({article_id:articleId,title:article.title,body:article.description,kind:breakingTerms.test(article.title)?'breaking':'news',published_at:article.publishedAt},{onConflict:'article_id'});}
  private async rebuildTrending(){const since=new Date(Date.now()-48*3600_000).toISOString();const {data,error}=await this.db.from('articles').select('id,view_count,published_at').eq('status','published').gte('published_at',since).is('duplicate_of',null).order('view_count',{ascending:false}).limit(50);if(error)throw error;const scored=(data||[]).map(article=>({article_id:article.id,score:Number(article.view_count||0)+Math.max(0,48-(Date.now()-new Date(article.published_at).getTime())/3600_000)*10})).sort((a,b)=>b.score-a.score).slice(0,20);for(const [index,item] of scored.entries())await this.db.from('trending_news').upsert({...item,rank:index+1,calculated_at:new Date().toISOString()},{onConflict:'article_id'});}
  private async rebuildFeatured(){const {data,error}=await this.db.from('articles').select('id').eq('status','published').is('duplicate_of',null).order('published_at',{ascending:false}).limit(6);if(error)throw error;for(const [index,article] of (data||[]).entries())await this.db.from('featured_news').upsert({article_id:article.id,rank:index+1,active:true},{onConflict:'article_id'});}
  private async log(sourceId:string,level:'info'|'error',event:string,details:unknown={},durationMs?:number){await this.db.from('feed_logs').insert({source_id:sourceId,level,event,details,duration_ms:durationMs});}
}
