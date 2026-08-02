import type { NewsCategory, NewsProvider } from './types.js';

const categoryMap:Record<string,NewsCategory>={business:'Business',entertainment:'Entertainment',health:'Health',sports:'Sports',technology:'Technology',science:'Technology',general:'World'};
const countryName:Record<string,string>={us:'United States',gb:'United Kingdom',za:'South Africa',ng:'Nigeria',ae:'United Arab Emirates',au:'Australia',ca:'Canada',in:'India'};

type NewsApiOptions={slug?:string;name?:string;category?:string;query?:string};

/** Official News API adapter. It stores only the metadata returned by News API and links to the publisher URL. */
export function newsApiProvider(options:NewsApiOptions={}):NewsProvider{
  const key=process.env.NEWS_API_KEY?.trim();
  const country=(process.env.NEWS_API_COUNTRY||'us').toLowerCase();
  const requestedCategory=(options.category||process.env.NEWS_API_CATEGORY||'general').toLowerCase();
  const category=categoryMap[requestedCategory]||'World';
  const query=options.query?.trim();
  return {
    source:{slug:options.slug||'news-api',name:options.name||'News API',apiEndpoint:'https://newsapi.org/v2/top-headlines',apiSecretName:'NEWS_API_KEY',country:countryName[country]||country.toUpperCase(),category,sourceType:'api',enabled:Boolean(key)},
    async fetch(){
      if(!key)return [];
      const url=new URL('https://newsapi.org/v2/top-headlines');
      const params:Record<string,string>={country,category:requestedCategory,pageSize:'100'};
      if(query)params.q=query;
      url.search=new URLSearchParams(params).toString();
      const response=await fetch(url,{headers:{'X-Api-Key':key},signal:AbortSignal.timeout(15_000)});
      if(!response.ok)throw new Error(`News API returned ${response.status}`);
      const data=await response.json();
      if(data.status!=='ok')throw new Error(data.message||'News API did not return headlines');
      return (data.articles||[]).filter((item:any)=>item?.title&&item?.url).map((item:any)=>({
        title:String(item.title).replace(/\s*\|\s*[^|]+$/,''),description:item.description||'',content:item.content||item.description||'',image:item.urlToImage||undefined,
        source:item.source?.name||options.name||'News API',sourceSlug:options.slug||'news-api',author:item.author||item.source?.name||options.name||'News API',publishedAt:item.publishedAt||new Date().toISOString(),updatedAt:item.publishedAt||undefined,
        category,country:countryName[country]||country.toUpperCase(),url:item.url,externalId:item.url,raw:item
      }));
    }
  };
}

/** A dedicated football feed for the Sports section, powered by the same licensed News API key. */
export function newsApiFootballProvider():NewsProvider{
  return newsApiProvider({slug:'news-api-football',name:'News API Football',category:'sports',query:process.env.NEWS_API_SPORTS_QUERY||'football OR soccer OR premier league OR champions league OR Black Stars OR CAF OR FIFA'});
}
