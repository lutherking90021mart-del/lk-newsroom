import type { NewsProvider } from './types.js';

type XMedia={media_key?:string;type?:string;url?:string;preview_image_url?:string};
type XPost={id:string;text?:string;created_at?:string;attachments?:{media_keys?:string[]}};

/**
 * Official X API provider for Fabrizio Romano's public posts.
 * The worker stores the post text and canonical X URL only; it never scrapes X.
 */
export function fabrizioRomanoProvider():NewsProvider{
  const token=process.env.X_BEARER_TOKEN?.trim();
  const handle=(process.env.FABRIZIO_X_HANDLE||'FabrizioRomano').replace(/^@/,'').trim();
  const configuredId=process.env.FABRIZIO_X_USER_ID?.trim();
  const headers={Authorization:`Bearer ${token}`};
  return {
    source:{slug:'fabrizio-romano-x',name:'Fabrizio Romano (X)',apiEndpoint:'https://api.x.com/2/users/:id/tweets',apiSecretName:'X_BEARER_TOKEN',country:'International',category:'Sports',sourceType:'api',enabled:Boolean(token&&handle)},
    async fetch(){
      if(!token||!handle)return [];
      let userId=configuredId;
      if(!userId){
        // X exposes both username lookup forms. Try both because access plans can differ.
        const direct=await fetch(`https://api.x.com/2/users/by/username/${encodeURIComponent(handle)}`,{headers,signal:AbortSignal.timeout(15_000)});
        let payload:any=direct.ok?await direct.json():null;userId=payload?.data?.id;
        if(!userId){
          const listed=await fetch(`https://api.x.com/2/users/by?${new URLSearchParams({usernames:handle})}`,{headers,signal:AbortSignal.timeout(15_000)});
          payload=listed.ok?await listed.json():await listed.json().catch(()=>null);userId=payload?.data?.[0]?.id;
          if(!userId){const detail=payload?.detail||payload?.title||payload?.errors?.[0]?.detail||`HTTP ${direct.status}/${listed.status}`;throw new Error(`X API could not resolve @${handle}: ${detail}`);}
        }
      }
      const params=new URLSearchParams({max_results:'20',exclude:'retweets,replies','tweet.fields':'created_at,attachments','expansions':'attachments.media_keys','media.fields':'url,preview_image_url,type'});
      const response=await fetch(`https://api.x.com/2/users/${encodeURIComponent(userId)}/tweets?${params}`,{headers,signal:AbortSignal.timeout(15_000)});
      if(!response.ok){const payload=await response.json().catch(()=>null) as any;throw new Error(payload?.detail||payload?.title||`X API timeline returned ${response.status}`);}
      const payload=await response.json() as any;const media=new Map<string,XMedia>((payload.includes?.media||[]).map((item:XMedia)=>[item.media_key||'',item]));
      return ((payload.data||[]) as XPost[]).filter(post=>post.id&&post.text).map(post=>{
        const image=(post.attachments?.media_keys||[]).map(key=>media.get(key)).find(item=>item?.type==='photo');
        const text=String(post.text||'').trim();const url=`https://x.com/${encodeURIComponent(handle)}/status/${encodeURIComponent(post.id)}`;
        return {title:text.slice(0,180),description:text,content:text,image:image?.url||image?.preview_image_url,source:'Fabrizio Romano (X)',sourceSlug:'fabrizio-romano-x',author:'Fabrizio Romano',publishedAt:post.created_at||new Date().toISOString(),updatedAt:post.created_at,category:'Sports' as const,country:'International',url,externalId:post.id,raw:post};
      });
    }
  };
}
