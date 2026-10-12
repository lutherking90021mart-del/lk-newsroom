export interface ImageSearchCandidate {
  imageUrl:string;
  thumbnailUrl:string;
  title:string;
  sourceName:string;
  pageUrl:string;
}

/**
 * Searches Pixabay for illustrative editorial photos.
 * This runs server-side; the Pixabay API key never reaches the browser.
 *
 * These are stock/illustrative images, not verified photographs of the reported event.
 * The caller stores the Pixabay image page URL for attribution.
 */
export async function findImageCandidates(title:string,_originalUrl?:string,limit=5):Promise<ImageSearchCandidate[]>{
  const key=process.env.PIXABAY_API_KEY?.trim();
  if(!key)throw new Error('Pixabay image search is not configured. Add PIXABAY_API_KEY to the server environment.');

  const query=title.trim().slice(0,100);
  if(!query)return [];
  const params=new URLSearchParams({
    key,
    q:query,
    image_type:'photo',
    safesearch:'true',
    lang:'en',
    per_page:String(Math.max(3,Math.min(limit,10))),
  });
  const response=await fetch(`https://pixabay.com/api/?${params}`,{signal:AbortSignal.timeout(15_000)});
  if(!response.ok){
    // Do not include the request URL in the error: it contains the API key.
    throw new Error(`Pixabay image search returned HTTP ${response.status}`);
  }
  const payload=await response.json() as any;
  if(payload?.error)throw new Error(String(payload.error));
  return (payload.hits||[]).map((item:any)=>({
    imageUrl:String(item.webformatURL||item.largeImageURL||''),
    thumbnailUrl:String(item.previewURL||item.webformatURL||''),
    title:String(item.tags||'Pixabay photo'),
    sourceName:'Pixabay',
    pageUrl:String(item.pageURL||''),
  })).filter((item:ImageSearchCandidate)=>/^https:\/\//i.test(item.imageUrl)&&/^https:\/\//i.test(item.pageUrl));
}

/** Returns the best available Pixabay photo as an illustrative image, not an event-verified photo. */
export async function findPublisherImage(title:string,originalUrl?:string){
  const candidates=await findImageCandidates(title,originalUrl,5);
  return candidates[0]||null;
}
