import { XMLParser } from 'fast-xml-parser';
import type { NewsCategory, NewsProvider, SourceDefinition } from './types.js';

const parser=new XMLParser({ignoreAttributes:false,attributeNamePrefix:'@_',removeNSPrefix:true,trimValues:true});
const list=<T>(value:T|T[]|undefined):T[]=>value?(Array.isArray(value)?value:[value]):[];
const text=(value:unknown)=>typeof value==='string'?value:(value&&typeof value==='object'?String((value as Record<string,unknown>)['#text']||''):'');

type Channel={slug:string;name:string;channelId:string;country:string;category:NewsCategory};

/** Uses YouTube's publisher-supplied Atom feed, not a page scrape or unofficial video downloader. */
function youtubeChannelProvider(channel:Channel):NewsProvider{
  const source:SourceDefinition={slug:channel.slug,name:channel.name,country:channel.country,category:channel.category,sourceType:'rss',feedUrl:`https://www.youtube.com/feeds/videos.xml?channel_id=${channel.channelId}`,enabled:true};
  return {source,async fetch(){
    const response=await fetch(source.feedUrl!,{headers:{accept:'application/atom+xml, application/xml, text/xml','user-agent':'LK-Newsroom-Aggregator/1.0 (+contact@lknewsroom.example)'},signal:AbortSignal.timeout(15_000)});
    if(!response.ok)throw new Error(`${source.slug} YouTube feed returned ${response.status}`);
    const doc=parser.parse(await response.text()) as Record<string,any>;
    return list<Record<string,any>>(doc.feed?.entry).map(entry=>{
      const videoId=text(entry.videoId||entry.id).replace(/^yt:video:/,'');
      const group=entry.group||{};const thumbnails=list<Record<string,unknown>>(group.thumbnail);
      const image=text(thumbnails[0]?.['@_url']);const publishedAt=text(entry.published||entry.updated)||new Date().toISOString();
      const watchUrl=videoId?`https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`:text(entry.link?.['@_href']);
      return {title:text(entry.title),description:text(group.description||entry.description),content:text(group.description||entry.description),image,source:channel.name.replace(/ Video$/,''),sourceSlug:channel.slug,author:text(entry.author?.name)||channel.name,publishedAt,updatedAt:text(entry.updated)||publishedAt,category:channel.category,country:channel.country,url:watchUrl,externalId:videoId||watchUrl,videoUrl:watchUrl,youtubeUrl:watchUrl,raw:entry};
    }).filter(item=>item.title&&item.url&&item.externalId);
  }};
}

export const videoProviders:NewsProvider[]=[
  youtubeChannelProvider({slug:'bbc-news-video',name:'BBC News Video',channelId:process.env.BBC_NEWS_YOUTUBE_CHANNEL_ID||'UC16niRr50-MSBwiO3YDb3RA',country:'United Kingdom',category:'World'}),
  youtubeChannelProvider({slug:'reuters-video',name:'Reuters Video',channelId:process.env.REUTERS_YOUTUBE_CHANNEL_ID||'UChqUTb7kYRX8-EiaN3XFrSQ',country:'International',category:'World'}),
  youtubeChannelProvider({slug:'al-jazeera-video',name:'Al Jazeera Video',channelId:process.env.ALJAZEERA_YOUTUBE_CHANNEL_ID||'UCNye-wNBqNL5ZzHSJj3l8Bg',country:'Qatar',category:'World'}),
  youtubeChannelProvider({slug:'sky-news-video',name:'Sky News Video',channelId:process.env.SKY_NEWS_YOUTUBE_CHANNEL_ID||'UCoMdktPbSTixAyNGwb-UYkQ',country:'United Kingdom',category:'World'})
];
