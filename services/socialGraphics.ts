import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SupabaseClient } from '@supabase/supabase-js';

export const socialGraphicVariants={
  instagram_feed:{width:1080,height:1080,label:'Instagram Feed'},
  instagram_story:{width:1080,height:1920,label:'Instagram Story'},
  facebook_post:{width:1200,height:630,label:'Facebook Post'},
  x_post:{width:1600,height:900,label:'X Post'},
  linkedin_post:{width:1200,height:627,label:'LinkedIn Post'},
  whatsapp_channel:{width:1080,height:1080,label:'WhatsApp Channel'}
} as const;
export type SocialGraphicVariant=keyof typeof socialGraphicVariants;

export type SocialGraphicArticle={id:string;slug?:string|null;title:string;excerpt?:string|null;ai_summary?:string|null;featured_image_url?:string|null;published_at?:string|null;breaking?:boolean;categories?:{name?:string|null;slug?:string|null}|null;};
export type SocialTemplate={id?:string;slug:string;name:string;category_slug:string;accent_color:string;background_color:string;font_family:string;background_url?:string|null;text_position?:Record<string,unknown>;enabled?:boolean;is_default?:boolean;};
export type SocialGraphicAssets=Partial<Record<SocialGraphicVariant,string>>;

const origin=()=>String(process.env.PUBLIC_ORIGIN||'http://localhost:5173').split(',')[0].replace(/\/$/,'');
const cleanText=(value:unknown)=>String(value??'').replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim();
const escapeXml=(value:unknown)=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[char]!));
const validColour=(value:unknown,fallback:string)=>/^#[0-9a-f]{3}(?:[0-9a-f]{3})?$/i.test(String(value||''))?String(value):fallback;
const isImageUrl=(value:string|undefined|null)=>/^https?:\/\//i.test(String(value||''));
let logoDataUri='';
try{logoDataUri=`data:image/png;base64,${readFileSync(join(process.cwd(),'assets','lk-newsroom-logo.png')).toString('base64')}`;}catch{logoDataUri='';}

const defaultTemplates:SocialTemplate[]=[
  {slug:'breaking-news',name:'Breaking News',category_slug:'breaking',accent_color:'#E31E24',background_color:'#003366',font_family:'Arial, Helvetica, sans-serif'},
  {slug:'latest-news',name:'Latest News',category_slug:'latest',accent_color:'#E31E24',background_color:'#003366',font_family:'Arial, Helvetica, sans-serif'},
  {slug:'sports',name:'Sports',category_slug:'sports',accent_color:'#0B8A5A',background_color:'#003366',font_family:'Arial, Helvetica, sans-serif'},
  {slug:'politics',name:'Politics',category_slug:'politics',accent_color:'#0057B8',background_color:'#003366',font_family:'Arial, Helvetica, sans-serif'},
  {slug:'business',name:'Business',category_slug:'business',accent_color:'#7B3F61',background_color:'#003366',font_family:'Arial, Helvetica, sans-serif'},
  {slug:'technology',name:'Technology',category_slug:'technology',accent_color:'#008CA8',background_color:'#003366',font_family:'Arial, Helvetica, sans-serif'},
  {slug:'entertainment',name:'Entertainment',category_slug:'entertainment',accent_color:'#A54278',background_color:'#003366',font_family:'Arial, Helvetica, sans-serif'},
  {slug:'health',name:'Health',category_slug:'health',accent_color:'#008A6A',background_color:'#003366',font_family:'Arial, Helvetica, sans-serif'},
  {slug:'education',name:'Education',category_slug:'education',accent_color:'#B56A12',background_color:'#003366',font_family:'Arial, Helvetica, sans-serif'},
  {slug:'world',name:'World',category_slug:'world',accent_color:'#4A6DDC',background_color:'#003366',font_family:'Arial, Helvetica, sans-serif'},
  {slug:'africa',name:'Africa',category_slug:'africa',accent_color:'#C99022',background_color:'#003366',font_family:'Arial, Helvetica, sans-serif'},
  {slug:'ghana',name:'Ghana',category_slug:'ghana',accent_color:'#CE1126',background_color:'#003366',font_family:'Arial, Helvetica, sans-serif'}
];
export const defaultSocialTemplates=()=>defaultTemplates.map(template=>({...template}));

function wrap(value:string,max:number,lines:number){
  const result:string[]=[];let current='';
  for(const word of cleanText(value).split(' ')){const next=current?`${current} ${word}`:word;if(next.length>max&&current){result.push(current);current=word;if(result.length===lines)break;}else current=next;}
  if(current&&result.length<lines)result.push(current);return result;
}
function headlineSvg(value:string,x:number,y:number,size:number,max:number,limit:number,font:string){return wrap(value,max,limit).map((line,index)=>`<text x="${x}" y="${y+index*(size*1.13)}" fill="#ffffff" font-family="${escapeXml(font)}" font-size="${size}" font-weight="800">${escapeXml(line)}</text>`).join('');}
function summarySvg(value:string,x:number,y:number,size:number,max:number,font:string){return wrap(value,max,2).map((line,index)=>`<text x="${x}" y="${y+index*(size*1.35)}" fill="#D8E2EE" font-family="${escapeXml(font)}" font-size="${size}" font-weight="500">${escapeXml(line)}</text>`).join('');}
function dateLabel(value:string|undefined|null){const date=value?new Date(value):new Date();return new Intl.DateTimeFormat('en-GB',{day:'2-digit',month:'short',year:'numeric',timeZone:'Africa/Accra'}).format(Number.isNaN(date.getTime())?new Date():date).toUpperCase();}
function socialIcons(x:number,y:number,size:number){return [['f','#1877F2'],['X','#ffffff'],['◎','#E4405F'],['in','#0A66C2'],['♪','#111111']].map(([label,colour],index)=>`<circle cx="${x+index*(size+12)}" cy="${y}" r="${size/2}" fill="${colour}"/><text x="${x+index*(size+12)}" y="${y+size*.18}" text-anchor="middle" fill="#ffffff" font-family="Arial,Helvetica,sans-serif" font-size="${label==='in'?size*.38:size*.53}" font-weight="800">${label}</text>`).join('');}
function photoLayer(image:string|undefined|null,width:number,height:number,clip:string){return isImageUrl(image)?`<image href="${escapeXml(image)}" x="0" y="0" width="${width}" height="${height}" preserveAspectRatio="xMidYMid slice" clip-path="url(#${clip})"/>`:'';}
function logo(x:number,y:number,width:number){return logoDataUri?`<image href="${logoDataUri}" x="${x}" y="${y}" width="${width}" preserveAspectRatio="xMinYMid meet"/>`:`<text x="${x}" y="${y+42}" fill="#ffffff" font-family="Arial,Helvetica,sans-serif" font-size="40" font-weight="900">LK NEWSROOM</text>`;}

function squareGraphic(article:SocialGraphicArticle,template:SocialTemplate,width:number,height:number){
  const accent=validColour(template.accent_color,'#E31E24'),background=validColour(template.background_color,'#003366'),font=template.font_family||'Arial, Helvetica, sans-serif';const label=article.breaking?'BREAKING NEWS':'LATEST NEWS';const description=cleanText(article.ai_summary||article.excerpt||'The latest verified reporting from LK Newsroom.');const photoHeight=Math.round(height*.56);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img"><defs><clipPath id="photo"><rect width="${width}" height="${photoHeight}"/></clipPath><linearGradient id="shade" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#001B35" stop-opacity=".1"/><stop offset="1" stop-color="#001B35" stop-opacity=".72"/></linearGradient><pattern id="grid" width="42" height="42" patternUnits="userSpaceOnUse"><path d="M0 0H42V42" fill="none" stroke="#fff" stroke-opacity=".05"/></pattern></defs><rect width="100%" height="100%" fill="${background}"/>${template.background_url?`<image href="${escapeXml(template.background_url)}" width="${width}" height="${height}" preserveAspectRatio="xMidYMid slice" opacity=".24"/>`:''}${photoLayer(article.featured_image_url,width,photoHeight,'photo')}<rect width="${width}" height="${photoHeight}" fill="url(#shade)"/><rect y="${photoHeight}" width="${width}" height="${height-photoHeight}" fill="${background}"/><rect width="100%" height="100%" fill="url(#grid)"/><rect x="0" y="${photoHeight-10}" width="${width}" height="10" fill="${accent}"/>${logo(56,42,245)}<rect x="56" y="${photoHeight-70}" width="290" height="48" rx="7" fill="${accent}"/><text x="76" y="${photoHeight-38}" fill="#fff" font-family="${escapeXml(font)}" font-size="25" font-weight="800" letter-spacing="2">${label}</text><text x="${width-58}" y="80" text-anchor="end" fill="#fff" font-family="${escapeXml(font)}" font-size="21" font-weight="700">${dateLabel(article.published_at)}</text>${headlineSvg(article.title,56,photoHeight+86,52,31,3,font)}${summarySvg(description,56,height-150,26,65,font)}<text x="56" y="${height-48}" fill="#fff" font-family="${escapeXml(font)}" font-size="22" font-weight="700">lknewsroom.com</text><text x="${width-56}" y="${height-48}" text-anchor="end" fill="#fff" font-family="${escapeXml(font)}" font-size="22" font-weight="700">@lk.news.global</text>${socialIcons(width-266,height-99,28)}</svg>`;
}
function landscapeGraphic(article:SocialGraphicArticle,template:SocialTemplate,width:number,height:number){
  const accent=validColour(template.accent_color,'#E31E24'),background=validColour(template.background_color,'#003366'),font=template.font_family||'Arial, Helvetica, sans-serif';const label=article.breaking?'BREAKING NEWS':'LATEST NEWS';const description=cleanText(article.ai_summary||article.excerpt||'The latest verified reporting from LK Newsroom.');const split=Math.round(width*.53);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img"><defs><clipPath id="photo"><rect x="${split}" y="0" width="${width-split}" height="${height}"/></clipPath><linearGradient id="cover" x1="0" y1="1" x2="1" y2="0"><stop stop-color="#001A34" stop-opacity=".82"/><stop offset="1" stop-color="#001A34" stop-opacity=".14"/></linearGradient><pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse"><path d="M0 0H40V40" fill="none" stroke="#fff" stroke-opacity=".05"/></pattern></defs><rect width="100%" height="100%" fill="${background}"/>${template.background_url?`<image href="${escapeXml(template.background_url)}" width="${width}" height="${height}" preserveAspectRatio="xMidYMid slice" opacity=".18"/>`:''}${photoLayer(article.featured_image_url,width,height,'photo')}<rect width="100%" height="100%" fill="url(#cover)"/><rect width="${split}" height="${height}" fill="${background}" opacity=".82"/><rect width="100%" height="100%" fill="url(#grid)"/><rect x="${split-9}" y="0" width="9" height="${height}" fill="${accent}"/>${logo(55,44,218)}<text x="55" y="130" fill="#CBDAEB" font-family="${escapeXml(font)}" font-size="19" font-weight="700" letter-spacing="2">${dateLabel(article.published_at)}</text><rect x="55" y="158" width="250" height="42" rx="6" fill="${accent}"/><text x="75" y="186" fill="#fff" font-family="${escapeXml(font)}" font-size="21" font-weight="800" letter-spacing="2">${label}</text>${headlineSvg(article.title,55,265,49,28,4,font)}${summarySvg(description,55,height-116,21,66,font)}<text x="55" y="${height-45}" fill="#fff" font-family="${escapeXml(font)}" font-size="19" font-weight="700">lknewsroom.com · @lk.news.global</text>${socialIcons(split-225,height-45,23)}</svg>`;
}
function storyGraphic(article:SocialGraphicArticle,template:SocialTemplate,width:number,height:number){
  const accent=validColour(template.accent_color,'#E31E24'),background=validColour(template.background_color,'#003366'),font=template.font_family||'Arial, Helvetica, sans-serif';const label=article.breaking?'BREAKING NEWS':'LATEST NEWS';const description=cleanText(article.ai_summary||article.excerpt||'The latest verified reporting from LK Newsroom.');const photoHeight=Math.round(height*.61);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img"><defs><clipPath id="photo"><rect width="${width}" height="${photoHeight}"/></clipPath><linearGradient id="shade" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#001A34" stop-opacity=".08"/><stop offset="1" stop-color="#001A34" stop-opacity=".8"/></linearGradient></defs><rect width="100%" height="100%" fill="${background}"/>${template.background_url?`<image href="${escapeXml(template.background_url)}" width="${width}" height="${height}" preserveAspectRatio="xMidYMid slice" opacity=".18"/>`:''}${photoLayer(article.featured_image_url,width,photoHeight,'photo')}<rect width="${width}" height="${photoHeight}" fill="url(#shade)"/><rect y="${photoHeight}" width="${width}" height="${height-photoHeight}" fill="${background}"/>${logo(58,55,262)}<text x="${width-58}" y="103" text-anchor="end" fill="#fff" font-family="${escapeXml(font)}" font-size="23" font-weight="700">${dateLabel(article.published_at)}</text><rect x="58" y="${photoHeight-92}" width="315" height="54" rx="8" fill="${accent}"/><text x="81" y="${photoHeight-56}" fill="#fff" font-family="${escapeXml(font)}" font-size="27" font-weight="800" letter-spacing="2">${label}</text>${headlineSvg(article.title,58,photoHeight+106,60,29,4,font)}${summarySvg(description,58,height-180,28,60,font)}<rect x="58" y="${height-118}" width="${width-116}" height="2" fill="${accent}"/><text x="58" y="${height-65}" fill="#fff" font-family="${escapeXml(font)}" font-size="24" font-weight="700">lknewsroom.com</text><text x="${width-58}" y="${height-65}" text-anchor="end" fill="#fff" font-family="${escapeXml(font)}" font-size="24" font-weight="700">@lk.news.global</text>${socialIcons(width-284,height-112,30)}</svg>`;
}

export function renderSocialGraphicSvg(article:SocialGraphicArticle,template:SocialTemplate,variant:SocialGraphicVariant){
  const size=socialGraphicVariants[variant];if(variant==='instagram_story')return storyGraphic(article,template,size.width,size.height);if(size.width===size.height)return squareGraphic(article,template,size.width,size.height);return landscapeGraphic(article,template,size.width,size.height);
}
function fallbackTemplate(article:SocialGraphicArticle){const category=(article.categories?.slug||'').toLowerCase();const preferred=article.breaking?'breaking':'latest';return defaultTemplates.find(template=>template.category_slug===category)||defaultTemplates.find(template=>template.category_slug===preferred)||defaultTemplates[1];}
function errorText(error:unknown){return error instanceof Error?error.message:String(error||'');}
function missingTable(error:unknown){return /social_(graphics|templates)|relation .*does not exist|PGRST205/i.test(errorText(error));}

async function templateForArticle(db:SupabaseClient,article:SocialGraphicArticle){
  const category=article.breaking?'breaking':(article.categories?.slug||'latest').toLowerCase();const {data,error}=await db.from('social_templates').select('*').eq('enabled',true).in('category_slug',[category,'latest']).order('is_default',{ascending:false}).limit(8);if(error)throw error;return ((data||[]).find((item:any)=>item.category_slug===category)||(data||[]).find((item:any)=>item.category_slug==='latest')||fallbackTemplate(article)) as SocialTemplate;
}
export function socialGraphicVariantForPlatform(platform:string):SocialGraphicVariant{if(platform==='instagram'||platform==='threads')return 'instagram_feed';if(platform==='facebook')return 'facebook_post';if(platform==='x')return 'x_post';if(platform==='linkedin')return 'linkedin_post';return 'whatsapp_channel';}
export function graphicUrlForPlatform(assets:SocialGraphicAssets|undefined,platform:string){return assets?.[socialGraphicVariantForPlatform(platform)]||null;}
export function hasCompleteSocialGraphicAssets(assets:SocialGraphicAssets|undefined|null){return (Object.keys(socialGraphicVariants) as SocialGraphicVariant[]).every(variant=>Boolean(assets?.[variant]));}

/** Renders and caches every required branded social format in the public Supabase social-graphics bucket. */
export async function ensureSocialGraphics(db:SupabaseClient,article:SocialGraphicArticle):Promise<SocialGraphicAssets|null>{
  try{
    const {data:existing,error:existingError}=await db.from('social_graphics').select('assets,source_image_url').eq('article_id',article.id).maybeSingle();if(existingError)throw existingError;
    const assets=(existing?.assets||{}) as SocialGraphicAssets;const complete=hasCompleteSocialGraphicAssets(assets);
    if(complete&&String(existing?.source_image_url||'')===String(article.featured_image_url||''))return assets;
    const template=await templateForArticle(db,article);const next:SocialGraphicAssets={};const version=new Date().toISOString().replace(/[:.]/g,'-');
    for(const variant of Object.keys(socialGraphicVariants) as SocialGraphicVariant[]){
      const path=`articles/${article.id}/${version}/${variant}.svg`;const svg=renderSocialGraphicSvg(article,template,variant);const {error:uploadError}=await db.storage.from('social-graphics').upload(path,Buffer.from(svg),{contentType:'image/svg+xml',cacheControl:'31536000, immutable',upsert:true});if(uploadError)throw uploadError;const {data:urlData}=db.storage.from('social-graphics').getPublicUrl(path);next[variant]=urlData.publicUrl;
    }
    const {error:saveError}=await db.from('social_graphics').upsert({article_id:article.id,template_id:template.id||null,source_image_url:article.featured_image_url||null,assets:next,generated_at:new Date().toISOString()},{onConflict:'article_id'});if(saveError)throw saveError;return next;
  }catch(error){if(missingTable(error))return null;throw error;}
}
export async function listSocialTemplates(db:SupabaseClient){const {data,error}=await db.from('social_templates').select('*').order('category_slug');if(error)throw error;return data||[];}
export function previewArticleForTemplate(template:SocialTemplate):SocialGraphicArticle{return {id:'preview',title:'LK Newsroom brings you the stories shaping today',excerpt:'A branded social graphic built automatically for every important story.',published_at:new Date().toISOString(),breaking:template.category_slug==='breaking',categories:{name:template.name,slug:template.category_slug}};}
