import type { NormalizedNewsArticle } from '../providers/types.js';
import { createSummary } from './aiSummarizer.js';
export async function createSeoMetadata(article:NormalizedNewsArticle){const enriched=await createSummary(article);return {summary:enriched.summary,metaDescription:enriched.seoDescription,tags:enriched.tags,contentHash:enriched.contentHash};}
