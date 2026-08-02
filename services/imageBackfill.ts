import type { SupabaseClient } from '@supabase/supabase-js';
import { findPublisherImage } from './googleImageSearch.js';

type BackfillResult={checked:number;updated:number;skipped:number;errors:number};

/**
 * Optional, rights-conscious image completion for feed records that supplied no image.
 * It calls Google's official API and accepts only results whose context page is on the original publisher domain.
 * It never fetches or scrapes a publisher article page.
 */
export async function backfillMissingImages(db:SupabaseClient):Promise<BackfillResult>{
  const result={checked:0,updated:0,skipped:0,errors:0};
  if(process.env.AUTO_FILL_MISSING_IMAGES!=='true')return result;
  if(!process.env.GOOGLE_CUSTOM_SEARCH_API_KEY||!process.env.GOOGLE_CUSTOM_SEARCH_ENGINE_ID){console.warn('Automatic image backfill skipped: Google Custom Search credentials are not configured.');return result;}
  const limit=Math.min(Math.max(Number(process.env.AUTO_IMAGE_BACKFILL_LIMIT||6),1),20);
  const retryBefore=new Date(Date.now()-30*24*60*60_000).toISOString();
  const {data,error}=await db.from('articles').select('id,title,original_url').eq('status','published').is('featured_image_url',null).not('original_url','is',null).or(`image_search_checked_at.is.null,image_search_checked_at.lt.${retryBefore}`).order('published_at',{ascending:false}).limit(limit);
  if(error)throw error;
  for(const article of data||[]){
    result.checked++;
    try{
      const candidate=await findPublisherImage(article.title,article.original_url);
      const payload={image_search_checked_at:new Date().toISOString(),image_attribution_url:candidate?.pageUrl||null};
      if(candidate){const {error:updateError}=await db.from('articles').update({...payload,featured_image_url:candidate.imageUrl}).eq('id',article.id);if(updateError)throw updateError;result.updated++;}
      else {const {error:updateError}=await db.from('articles').update(payload).eq('id',article.id);if(updateError)throw updateError;result.skipped++;}
    }catch(error){result.errors++;console.warn(`Image backfill failed for ${article.id}:`,error instanceof Error?error.message:error);}
  }
  return result;
}
