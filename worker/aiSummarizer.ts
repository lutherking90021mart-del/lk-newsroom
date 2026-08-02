import type { NormalizedNewsArticle } from '../providers/types.js';
import { enrich } from '../services/enrichment.js';
/** Deterministic server-side fallback; replace enrich() with an approved model adapter if required. */
export async function createSummary(article:NormalizedNewsArticle){return enrich(article);}
