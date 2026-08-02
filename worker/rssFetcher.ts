import type { NewsProvider, NormalizedNewsArticle } from '../providers/types.js';
/** Fetches only publisher-provided RSS/API endpoints and retries a failing source. */
export async function fetchPublisherFeed(provider:NewsProvider,retries=3):Promise<NormalizedNewsArticle[]>{let last:unknown;for(let attempt=1;attempt<=retries;attempt++){try{return await provider.fetch();}catch(error){last=error;await new Promise(resolve=>setTimeout(resolve,attempt*700));}}throw last instanceof Error?last:new Error(String(last));}
