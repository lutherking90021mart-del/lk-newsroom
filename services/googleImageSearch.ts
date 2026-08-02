export interface ImageSearchCandidate {
  imageUrl:string;
  thumbnailUrl:string;
  title:string;
  sourceName:string;
  pageUrl:string;
}

/**
 * Searches Google through the official Programmable Search JSON API.
 * This is intentionally server-only: the API key never reaches the browser.
 */
export async function findImageCandidates(title:string,originalUrl?:string,limit=5):Promise<ImageSearchCandidate[]>{
  const key=process.env.GOOGLE_CUSTOM_SEARCH_API_KEY?.trim();
  const engineId=process.env.GOOGLE_CUSTOM_SEARCH_ENGINE_ID?.trim();
  if(!key||!engineId)throw new Error('Google image search is not configured. Add GOOGLE_CUSTOM_SEARCH_API_KEY and GOOGLE_CUSTOM_SEARCH_ENGINE_ID to the server variables.');

  let domain='';
  try{domain=originalUrl?new URL(originalUrl).hostname.replace(/^www\./,''):'';}catch{}
  // Prefer the original publisher so an editor can choose the most relevant, attributable image.
  const query=`${domain?`site:${domain} `:''}${title}`.slice(0,220);
  const params=new URLSearchParams({key,cx:engineId,q:query,searchType:'image',safe:'active',num:String(Math.max(1,Math.min(limit,10)))});
  const response=await fetch(`https://www.googleapis.com/customsearch/v1?${params}`,{signal:AbortSignal.timeout(15_000)});
  if(!response.ok){const detail=await response.json().catch(()=>null) as any;throw new Error(detail?.error?.message||`Google image search returned ${response.status}`);}
  const payload=await response.json() as any;
  return (payload.items||[]).map((item:any)=>({
    imageUrl:String(item.link||''),thumbnailUrl:String(item.image?.thumbnailLink||item.link||''),title:String(item.title||'Image result'),sourceName:String(item.displayLink||domain||'Google result'),pageUrl:String(item.image?.contextLink||item.link||'')
  })).filter((item:ImageSearchCandidate)=>/^https:\/\//i.test(item.imageUrl));
}
