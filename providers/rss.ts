import { XMLParser } from 'fast-xml-parser';
import type { NewsCategory, NewsProvider, NormalizedNewsArticle, SourceDefinition } from './types.js';

const parser = new XMLParser({ignoreAttributes:false,attributeNamePrefix:'@_',removeNSPrefix:true,trimValues:true});
const list = <T>(value:T|T[]|undefined):T[] => value ? (Array.isArray(value)?value:[value]) : [];
const text = (value:unknown):string => typeof value==='string'?value:(value&&typeof value==='object'?String((value as Record<string,unknown>)['#text']||''): '');
const stripHtml = (value:string) => value.replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim();
const safeDate = (value:unknown) => { const date=new Date(text(value)); return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString(); };
/** Extracts images explicitly supplied inside RSS/Atom fields. It never visits an article page. */
function imageOf(item:Record<string,unknown>) {
  const urlFrom=(value:unknown):string=>{
    if(!value)return '';
    if(typeof value==='string')return /^https?:\/\//i.test(value.trim())?value.trim():'';
    if(Array.isArray(value)){for(const entry of value){const found=urlFrom(entry);if(found)return found;}return '';}
    if(typeof value==='object'){
      const record=value as Record<string,unknown>;
      for(const key of ['@_url','@_href','url','href','@_src','src']){const candidate=text(record[key]);if(/^https?:\/\//i.test(candidate))return candidate;}
      for(const key of ['thumbnail','content','image','media']){const found=urlFrom(record[key]);if(found)return found;}
    }
    return '';
  };
  // `removeNSPrefix` makes media:content/media:group appear as content/group in several Atom feeds.
  const suppliedFields=['media:thumbnail','media:content','media:group','media','group','thumbnail','image','enclosure','content','content:encoded'];
  for(const field of suppliedFields){const found=urlFrom(item[field]);if(found)return found;}
  // Some publishers put a thumbnail <img> directly in the RSS description/content field.
  for(const field of ['description','summary','content','content:encoded']){
    const html=text(item[field]);const match=html.match(/<img[^>]+src=["']([^"']+)["']/i);if(match?.[1])return match[1];
  }
  return '';
}

/** Parses publisher-supplied RSS/Atom XML only; it never fetches or scrapes article pages. */
export function rssProvider(source:SourceDefinition):NewsProvider {
  return {source, async fetch(){
    if(!source.feedUrl) return [];
    const response=await fetch(source.feedUrl,{headers:{accept:'application/rss+xml, application/xml, text/xml','user-agent':'LK-Newsroom-Aggregator/1.0 (+contact@lknewsroom.example)'}});
    if(!response.ok) throw new Error(`${source.slug} feed returned ${response.status}`);
    const doc=parser.parse(await response.text()) as Record<string,any>;
    const channel=doc.rss?.channel || doc.feed || {}; const items=list<Record<string,unknown>>(channel.item || channel.entry);
    return items.map(item=>{
      const url=text(item.link && typeof item.link==='object' ? (item.link as Record<string,unknown>)['@_href'] : item.link);
      const description=stripHtml(text(item.description || item.summary || item.content));
      const authorObject=item.author&&typeof item.author==='object'?item.author as Record<string,unknown>:undefined;
      return {title:stripHtml(text(item.title)),description,content:stripHtml(text(item['content:encoded'] || item.content)),image:imageOf(item),source:source.name,sourceSlug:source.slug,author:stripHtml(text(item.creator || authorObject?.name || item.author)),publishedAt:safeDate(item.pubDate || item.published || item.updated),updatedAt:safeDate(item.updated || item.pubDate || item.published),category:source.category,country:source.country,url,externalId:text(item.guid || item.id || url),raw:item};
    }).filter(item=>item.title&&item.url);
  }};
}
export function configuredRss(slug:string,name:string,envKey:string,country:string,category:NewsCategory):NewsProvider { const feedUrl=process.env[envKey]; return rssProvider({slug,name,feedUrl,country,category,sourceType:'rss',enabled:Boolean(feedUrl)}); }
