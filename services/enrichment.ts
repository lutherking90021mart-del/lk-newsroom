import crypto from 'node:crypto';
import type { NormalizedNewsArticle } from '../providers/types.js';
const common=new Set(['about','after','against','their','there','these','those','with','from','this','that','news','says','will','have','into','over','more']);
export interface EnrichedArticle { summary:string; seoDescription:string; tags:string[]; contentHash:string; }
/** Server-side enrichment hook. Replace the deterministic fallback with a licensed LLM adapter if desired. */
export async function enrich(article:NormalizedNewsArticle):Promise<EnrichedArticle>{
 const plain=`${article.title}. ${article.description}`.replace(/\s+/g,' ').trim(); const words=plain.split(' '); const summary=words.slice(0,Math.min(words.length,55)).join(' ')+(words.length>55?'…':'');
 const tags=[...new Set([article.category,...article.title.toLowerCase().match(/[a-z][a-z-]{4,}/g)||[]].filter(tag=>!common.has(tag.toLowerCase())))].slice(0,8);
 const contentHash=crypto.createHash('sha256').update(article.title.toLowerCase().replace(/\W+/g,' ').trim()).digest('hex');
 return {summary,seoDescription:plain.slice(0,155),tags,contentHash};
}
export const relatedTerms=(article:NormalizedNewsArticle)=>[article.category,article.country,...article.title.toLowerCase().split(/\W+/).filter(word=>word.length>5).slice(0,3)];
