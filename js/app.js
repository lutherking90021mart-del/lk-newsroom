import { categories, videos, gallery } from './data.js';
import { articleCard, renderHeader, renderBreaking, renderNewsletter, renderFooter, toast, link, esc } from './components.js';
import { configured, newsApi, subscribeRealtime } from './supabase-client.js';

const $=(selector,parent=document)=>parent.querySelector(selector);
const query=new URLSearchParams(location.search);
const aggregatorApi=()=>String(window.LK_AGGREGATOR_API_URL||location.origin).replace(/\/$/,'');
const fallbackImage=()=>link('assets/default-news.svg');
let feed=[];
const categorySlug=value=>String(value||'').trim().toLowerCase().replace(/&/g,'and').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
const categoryStories=(items,category)=>category==='Latest'?items:items.filter(article=>article.category.toLowerCase()===category.toLowerCase()||article.categorySlug===categorySlug(category));
const relativeTime=date=>{const minutes=Math.max(0,Math.floor((Date.now()-new Date(date).getTime())/60_000));if(minutes<1)return 'Updated just now';if(minutes<60)return `Updated ${minutes} minute${minutes===1?'':'s'} ago`;const hours=Math.floor(minutes/60);if(hours<24)return `Updated ${hours} hour${hours===1?'':'s'} ago`;const days=Math.floor(hours/24);return days===1?'Updated yesterday':`Updated ${days} days ago`;};
const uiDate=date=>new Intl.DateTimeFormat('en-GB',{day:'numeric',month:'long',year:'numeric'}).format(new Date(date));
const toUiArticle=row=>({
  id:row.id,slug:row.slug||row.id,title:row.title,excerpt:row.excerpt||row.ai_summary||'',
  content:row.content_markdown||row.content||row.ai_summary||row.excerpt||'',category:row.categories?.name||'News',
  categorySlug:row.categories?.slug||'',author:row.authors?.name||row.news_sources?.name||'LK Newsroom',
  source:row.news_sources?.name||'LK Newsroom',sourceSlug:row.news_sources?.slug||'',country:row.country||'International',
  date:uiDate(row.published_at||row.created_at),publishedAt:row.published_at||row.created_at,time:relativeTime(row.published_at||row.created_at),
  views:Number(row.view_count||0),reading:Math.max(1,Math.ceil(String(row.content_markdown||row.content||row.ai_summary||row.excerpt||'').split(/\s+/).filter(Boolean).length/220)),
  image:row.featured_image_url||fallbackImage(),originalUrl:row.original_url||'',tags:row.auto_tags||[],raw:row
});

async function hydrateNews(){
  try{const response=await fetch(`${aggregatorApi()}/v1/news?limit=100`);if(response.ok){const payload=await response.json();if(Array.isArray(payload.data)){feed=payload.data.map(toUiArticle);return;}}}catch{}
  if(!configured)return;
  try{const rows=await newsApi.published({limit:100});if(rows?.length)feed=rows.map(toUiArticle);}catch(error){console.warn('Using offline LK Newsroom demo data:',error.message);}
}
async function refreshBreaking(){try{const response=await fetch(`${aggregatorApi()}/v1/breaking`);if(!response.ok)return;const payload=await response.json();if(payload.data?.length)renderBreaking(payload.data);}catch{}}
async function loadAdvertisements(){const slots=[...document.querySelectorAll('.ad-slot')];if(!slots.length||!configured)return;try{const rows=await newsApi.advertisements(30);if(!rows.length)return;slots.forEach((slot,index)=>{const placement=slot.dataset.adPlacement||(document.body.dataset.template==='article'?'article-sidebar':'homepage-sidebar');const matches=rows.filter(ad=>ad.placement===placement);const ad=(matches.length?matches:rows)[index%(matches.length||rows.length)];const image=ad.image_url?`<img src="${esc(ad.image_url)}" alt="${esc(ad.name)}" loading="lazy">`:'';const target=ad.target_url||'#';slot.innerHTML=`<span class="ad-label">Sponsored</span><a class="ad-link" href="${esc(target)}" ${ad.target_url?'target="_blank" rel="sponsored noopener"':''}>${image}<strong>${esc(ad.name)}</strong>${ad.html_content?`<span>${esc(ad.html_content)}</span>`:''}</a>`;void newsApi.trackAdvertisement(ad.id,'impression').catch(()=>{});slot.querySelector('.ad-link')?.addEventListener('click',()=>void newsApi.trackAdvertisement(ad.id,'click').catch(()=>{}));});}catch(error){console.warn('Could not load advertisements',error);}}
function connectLiveUpdates(){if(!configured)return;subscribeRealtime('articles',async payload=>{if(payload.eventType==='INSERT'&&payload.new?.status==='published'){await hydrateNews();toast('A new verified story is live.');}});subscribeRealtime('breaking_news',async()=>{await refreshBreaking();toast('Breaking news updated.');});}

function setTheme(){const saved=localStorage.getItem('lk-theme');if(saved)document.documentElement.dataset.theme=saved;}
function initShell(){
  renderHeader(document.body.dataset.page||'');renderBreaking();renderFooter();
  if($('[data-today]'))$('[data-today]').textContent=new Intl.DateTimeFormat('en-GB',{weekday:'long',day:'numeric',month:'long',year:'numeric'}).format(new Date());
  document.querySelectorAll('[data-year]').forEach(element=>element.textContent=new Date().getFullYear());
  $('#theme-toggle')?.addEventListener('click',()=>{const next=document.documentElement.dataset.theme==='dark'?'light':'dark';document.documentElement.dataset.theme=next;localStorage.setItem('lk-theme',next);});
  $('#menu-toggle')?.addEventListener('click',()=>$('#mobile-menu')?.classList.toggle('open'));
  document.addEventListener('submit',async event=>{if(!event.target.matches('[data-newsletter-form]'))return;event.preventDefault();const email=$('input',event.target).value;try{const {subscribe}=await import('./supabase-client.js');await subscribe(email);}catch{}event.target.reset();toast("You're subscribed to the LK Daily Brief.");});
  document.addEventListener('submit',event=>{if(!event.target.matches('[data-contact-form]'))return;event.preventDefault();event.target.reset();toast('Thanks — your message has been sent to LK Newsroom.');});
  if(window.AOS)AOS.init({once:true,offset:35,duration:520});
}
function renderHero(){
  const wrapper=$('.hero-swiper .swiper-wrapper');if(!wrapper||!feed.length)return;
  wrapper.innerHTML=feed.slice(0,3).map(article=>`<article class="swiper-slide hero-slide" style="background-image:url('${esc(article.image)}')"><div class="hero-content"><span class="badge">${esc(article.category)}</span><h1>${esc(article.title)}</h1><p>${esc(article.excerpt)}</p><a class="btn btn-primary" href="/news/${encodeURIComponent(article.id)}">Read the full story <i class="fa-solid fa-arrow-right"></i></a></div></article>`).join('');
}
function home(){
  renderHero();
  $('#featured-articles').innerHTML=feed.slice(0,3).map(article=>articleCard(article)).join('');
  $('#top-stories').innerHTML=feed.slice(1,5).map((article,index)=>articleCard(article,index>0)).join('');
  $('#latest-news').innerHTML=feed.slice(4,10).map(article=>articleCard(article)).join('');
  $('#trending-news').innerHTML=[...feed].sort((a,b)=>b.views-a.views).slice(0,3).map(article=>articleCard(article,true)).join('');
  const mostRead=$('#most-read')||$('.ranked-list');if(mostRead)mostRead.innerHTML=[...feed].sort((a,b)=>b.views-a.views).slice(0,4).map(article=>`<li><a href="/news/${encodeURIComponent(article.id)}">${esc(article.title)}</a></li>`).join('');
  $('#category-tiles').innerHTML=categories.map(([name,icon])=>{const stories=categoryStories(feed,name);const latest=stories[0];const label=stories.length?`${stories.length} live ${stories.length===1?'story':'stories'}`:'Live desk';const detail=latest?.title||'Fresh verified reporting is on the way.';return `<a data-aos="zoom-in" class="category-tile" href="${link(`pages/category.html?category=${encodeURIComponent(name)}`)}"><i class="fa-solid ${icon}"></i><strong>${name}</strong><small>${label}</small><span class="category-tile__headline" title="${esc(detail)}">${esc(detail)}</span></a>`;}).join('');
  $('#videos').innerHTML=videos.map(video=>`<article><div class="video-card"><img src="${video.image}" alt="" loading="lazy"><a class="play-button" href="${link('pages/video-news.html')}" aria-label="Play ${esc(video.title)}"><i class="fa-solid fa-play"></i></a></div><h3 class="headline">${esc(video.title)}</h3></article>`).join('');
  $('#gallery').innerHTML=gallery.map(item=>`<a class="gallery-item" href="${link('pages/gallery.html')}"><img src="${item.image}" alt="${esc(item.title)}" loading="lazy"><span>${esc(item.title)}</span></a>`).join('');
  renderNewsletter($('#newsletter'));
  $('#load-more')?.addEventListener('click',event=>{event.currentTarget.remove();$('#latest-news').insertAdjacentHTML('beforeend',feed.slice(10).map(article=>articleCard(article)).join(''));if(window.AOS)AOS.refresh();});
  if(window.Swiper)new Swiper('.hero-swiper',{loop:feed.length>1,speed:750,autoplay:{delay:5000,disableOnInteraction:false},pagination:{el:'.swiper-pagination',clickable:true}});
  if(window.gsap)gsap.from('.featured-strip article',{y:26,opacity:0,stagger:.12,duration:.55,delay:.25});
}
async function categoryPage(){
  const category=query.get('category')||document.body.dataset.category||'Latest';
  const grid=$('#category-news');
  const pageSize=24;
  let filtered=categoryStories(feed,category);
  let total=filtered.length;
  let offset=0;
  let usingApi=false;
  $('#category-title').textContent=category==='Latest'?'Latest News':category;
  $('#category-description').textContent=category==='Latest'?'All the latest verified reporting, analysis and explainers from LK Newsroom.':`In-depth ${category.toLowerCase()} reporting, analysis and explainers from trusted publishers.`;
  grid.innerHTML='<div class="spinner"></div>';
  try{
    const params=new URLSearchParams({limit:String(pageSize),offset:'0'});
    if(category!=='Latest')params.set('category',categorySlug(category));
    const response=await fetch(`${aggregatorApi()}/v1/news?${params}`);
    if(response.ok){const payload=await response.json();if(Array.isArray(payload.data)){filtered=payload.data.map(toUiArticle);total=Number(payload.total??filtered.length);usingApi=true;offset=filtered.length;}}
  }catch{}
  const renderStories=stories=>stories.map(article=>articleCard(article)).join('');
  grid.innerHTML=filtered.length?renderStories(filtered):'<div class="empty-state"><i class="fa-solid fa-newspaper fa-2x"></i><p>No published stories in this section yet. Enable more authorised sources in Admin to grow this live desk.</p></div>';
  const oldPager=document.querySelector('[data-category-pager]');if(oldPager)oldPager.remove();
  const summary=document.createElement('div');summary.className='category-results-summary';summary.dataset.categoryPager='';
  const visible=filtered.length;summary.innerHTML=`<span><strong>${total.toLocaleString()}</strong> ${total===1?'story':'stories'} available in ${esc(category==='Latest'?'the newsroom':category)}.</span>${usingApi&&visible<total?'<button class="btn btn-outline" type="button" data-category-more>Load more stories <i class="fa-solid fa-arrow-down"></i></button>':''}`;
  grid.after(summary);
  const more=$('[data-category-more]',summary);
  more?.addEventListener('click',async()=>{
    more.disabled=true;more.innerHTML='<i class="fa-solid fa-spinner fa-spin"></i> Loading stories';
    try{
      const params=new URLSearchParams({limit:String(pageSize),offset:String(offset)});if(category!=='Latest')params.set('category',categorySlug(category));
      const response=await fetch(`${aggregatorApi()}/v1/news?${params}`);if(!response.ok)throw new Error('Unable to load more stories.');
      const payload=await response.json();const moreStories=Array.isArray(payload.data)?payload.data.map(toUiArticle):[];offset+=moreStories.length;grid.insertAdjacentHTML('beforeend',renderStories(moreStories));
      total=Number(payload.total??total);if(!moreStories.length||offset>=total)more.remove();else{more.disabled=false;more.innerHTML='Load more stories <i class="fa-solid fa-arrow-down"></i>';}if(window.AOS)AOS.refresh();
    }catch(error){more.disabled=false;more.innerHTML='Try loading more <i class="fa-solid fa-rotate-right"></i>';toast(error.message||'Unable to load more stories.');}
  });
  renderNewsletter($('#newsletter'));
}
const paragraphs=value=>String(value||'').split(/\n{2,}/).filter(Boolean).map(part=>`<p>${esc(part)}</p>`).join('');
const sourceMark=source=>`<span class="source-mark" title="${esc(source)}">${esc(String(source||'LK').slice(0,4).toUpperCase())}</span>`;
async function getArticle(identifier){try{const response=await fetch(`${aggregatorApi()}/v1/news/${encodeURIComponent(identifier)}`);if(!response.ok)throw new Error(response.status===404?'This article is no longer available.':'Unable to load this article.');return response.json();}catch(error){if(configured)return newsApi.article(identifier);throw error;}}
function mediaSection(items,type){
  if(!items?.length)return '';
  if(type==='gallery')return `<section class="article-media"><h2>In pictures</h2><div class="gallery-grid">${items.map(item=>`<a class="gallery-item" href="${esc(item.image_url)}" target="_blank" rel="noopener"><img src="${esc(item.image_url)}" alt="${esc(item.alt_text||item.title)}" loading="lazy"><span>${esc(item.caption||item.title)}</span></a>`).join('')}</div></section>`;
  return `<section class="article-media"><h2>Watch</h2><div class="news-grid">${items.map(item=>{const video=item.youtube_url||item.video_url||'';const embed=/youtu(?:\.be|be\.com)/i.test(video)?`<iframe src="${esc(video.replace('watch?v=','embed/'))}" title="${esc(item.title)}" loading="lazy" allowfullscreen></iframe>`:`<a class="video-card" href="${esc(video)}" target="_blank" rel="noopener"><img src="${esc(item.thumbnail_url||fallbackImage())}" alt="${esc(item.title)}"><span class="play-button"><i class="fa-solid fa-play"></i></span></a>`;return `<article>${embed}<h3>${esc(item.title)}</h3><p class="text-muted">${esc(item.description||'')}</p></article>`;}).join('')}</div></section>`;
}
async function articlePage(){
  const route=location.pathname.match(/^\/news\/([^/]+)$/);const identifier=route?decodeURIComponent(route[1]):query.get('id')||query.get('slug');
  const target=$('#article-content');if(!target)return;
  if(!identifier){target.innerHTML='<div class="container section"><div class="empty-state"><p>Select an article to read it.</p></div></div>';return;}
  target.innerHTML='<div class="container section"><div class="spinner"></div></div>';
  try{
    const payload=await getArticle(identifier);const article=toUiArticle(payload.data);document.title=`${article.title} | LK Newsroom`;
    const original=article.originalUrl?`<p><a class="btn btn-outline" href="${esc(article.originalUrl)}" target="_blank" rel="noopener noreferrer">Read the full story at ${esc(article.source)} <i class="fa-solid fa-arrow-up-right-from-square"></i></a></p>`:'';
    const tags=(article.tags||[]).map(tag=>`<span class="tag">${esc(tag)}</span>`).join('')||`<span class="tag">${esc(article.category)}</span>`;
    const comments=payload.comments||[];
    target.innerHTML=`<div class="container"><header class="article-header"><span class="eyebrow">${esc(article.category)}</span><h1>${esc(article.title)}</h1><p class="text-muted">${esc(article.excerpt)}</p><div class="article-byline"><div class="author">${sourceMark(article.source)}<div><strong>${esc(article.author)}</strong><div class="meta">${esc(article.source)}</div></div></div><div class="meta"><i class="fa-regular fa-calendar"></i> ${esc(article.date)} &nbsp; <i class="fa-regular fa-clock"></i> ${article.reading} min read &nbsp; <i class="fa-regular fa-eye"></i> ${article.views.toLocaleString()} views</div></div></header><img class="article-featured" src="${esc(article.image)}" alt="" fetchpriority="high" onerror="this.src='${fallbackImage()}'"><div class="article-body"><div class="share-row"><strong>Share</strong><button class="icon-button" data-share aria-label="Share article"><i class="fa-solid fa-share-nodes"></i></button><button class="icon-button" data-copy-link aria-label="Copy article link"><i class="fa-solid fa-link"></i></button></div>${paragraphs(article.content)||`<p>${esc(article.excerpt)}</p>`}${original}${mediaSection(payload.gallery,'gallery')}${mediaSection(payload.videos,'video')}<div class="tags">${tags}</div><nav class="article-nav">${payload.previous?`<a href="/news/${encodeURIComponent(payload.previous.id)}"><span class="eyebrow">Previous</span><br>${esc(payload.previous.title)}</a>`:'<span></span>'}${payload.next?`<a href="/news/${encodeURIComponent(payload.next.id)}"><span class="eyebrow">Next</span><br>${esc(payload.next.title)}</a>`:'<span></span>'}</nav></div><section class="comments"><h2>Comments <small class="text-muted">(${comments.length})</small></h2><div id="approved-comments">${comments.length?comments.map(comment=>`<article class="comment"><strong>${esc(comment.display_name||'LK Reader')}</strong><span class="meta">${esc(relativeTime(comment.created_at))}</span><p>${esc(comment.body)}</p></article>`).join(''):'<p class="text-muted">No approved comments yet. Be the first to join the conversation.</p>'}</div><form class="form-card" data-comment-form><div class="form-group"><label for="comment-name">Name</label><input id="comment-name" class="form-control" required maxlength="80" placeholder="Your name"></div><div class="form-group"><label for="comment">Join the conversation</label><textarea id="comment" class="form-control" rows="3" required maxlength="5000" placeholder="Write a respectful comment"></textarea></div><button class="btn btn-primary">Post comment</button></form></section></div>`;
    const related=$('#related-news');if(related)related.innerHTML=(payload.related||[]).map(row=>articleCard(toUiArticle(row))).join('')||'<p class="text-muted">More related reporting will appear here soon.</p>';
    const relatedHeading=$('#related-source-heading');if(relatedHeading)relatedHeading.textContent=`More from ${article.source}`;
    const sourceMore=$('#more-from-source');if(sourceMore)sourceMore.innerHTML=(payload.moreFromSource||[]).map(row=>articleCard(toUiArticle(row),true)).join('')||'<p class="text-muted">No additional stories from this source yet.</p>';
    $('[data-share]')?.addEventListener('click',()=>{if(navigator.share)navigator.share({title:article.title,url:location.href});else window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(article.title)}&url=${encodeURIComponent(location.href)}`,'_blank','noopener');});
    $('[data-copy-link]')?.addEventListener('click',async()=>{await navigator.clipboard?.writeText(location.href);toast('Link copied to clipboard.');});
    $('[data-comment-form]')?.addEventListener('submit',async event=>{event.preventDefault();const form=event.currentTarget;const displayName=$('#comment-name',form).value;const body=$('#comment',form).value;try{const response=await fetch(`${aggregatorApi()}/v1/news/${encodeURIComponent(identifier)}/comments`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({displayName,body})});if(!response.ok)throw new Error((await response.json().catch(()=>({}))).error||'Unable to submit comment.');}catch(error){if(!configured){toast(error.message);return;}try{await newsApi.comment(article.id,displayName,body);}catch(fallbackError){toast(fallbackError.message);return;}}form.reset();toast('Thanks — your comment is awaiting moderation.');});
    if(configured)subscribeRealtime('comments',()=>toast('New comment activity detected.'));
  }catch(error){target.innerHTML=`<div class="container section"><div class="empty-state"><i class="fa-solid fa-triangle-exclamation fa-2x"></i><p>${esc(error.message)}</p><a class="btn btn-primary" href="/index.html">Back to the newsroom</a></div></div>`;}
}
function searchPage(){const list=$('#search-results');const run=()=>{const term=$('#search-term').value.toLowerCase();const category=$('#search-category').value;const author=$('#search-author').value.toLowerCase();const date=$('#search-date').value;const country=$('#search-country')?.value||'';const source=$('#search-source')?.value||'';const found=feed.filter(article=>{const published=new Date(article.publishedAt||article.date).toISOString().slice(0,10);return(!term||article.title.toLowerCase().includes(term))&&(!category||article.category===category)&&(!author||article.author.toLowerCase().includes(author))&&(!date||published===date)&&(!country||article.country===country)&&(!source||article.source===source);});list.innerHTML=found.length?found.map(article=>`<article class="search-result"><img src="${esc(article.image)}" alt="" loading="lazy" onerror="this.src='${fallbackImage()}'"><div><span class="eyebrow">${esc(article.category)}</span><h2><a class="headline" href="/news/${encodeURIComponent(article.id)}">${esc(article.title)}</a></h2><p class="text-muted">${esc(article.excerpt)}</p><div class="meta">${esc(article.source)} · ${esc(article.date)} · ${article.reading} min read</div></div></article>`).join(''):'<div class="empty-state"><i class="fa-solid fa-magnifying-glass fa-2x"></i><p>No stories matched those filters.</p></div>';};$('#search-form').addEventListener('submit',event=>{event.preventDefault();run();});run();}
function livePage(){const updates=[['14:10','Transport ministry says the project timeline remains on track.'],['13:42','Community leaders welcome the announcement and call for open dialogue.'],['13:08','Our correspondent is speaking with officials at the briefing.'],['12:30','The afternoon briefing has begun; follow verified updates below.']];$('#live-updates').innerHTML=updates.map(([time,text],index)=>`<article class="comment"><span class="badge">${index===0?'New':'Update'}</span><strong style="margin-left:8px">${time}</strong><p>${text}</p></article>`).join('');let seconds=31;setInterval(()=>{seconds=seconds===1?31:seconds-1;const element=$('#refresh-countdown');if(element)element.textContent=seconds;},1000);if(configured)subscribeRealtime('breaking_news',()=>toast('A new breaking update is available.'));}
function mediaPage(type){const title=type==='video'?'Video News':'Photo Gallery';$('#media-title').textContent=title;$('#media-description').textContent=type==='video'?'Watch original reporting, interviews and explainers from LK Newsroom.':'The week’s stories, through the lens of our photojournalists.';const element=$('#media-content');element.innerHTML=type==='video'?videos.concat(videos).map(video=>`<article><div class="video-card"><img src="${video.image}" alt=""><a href="#" class="play-button"><i class="fa-solid fa-play"></i></a></div><h3>${video.title}</h3><span class="meta">LK Newsroom · 4:20</span></article>`).join(''):gallery.concat(gallery).map(item=>`<a class="gallery-item" href="#"><img src="${item.image}" alt="${item.title}"><span>${item.title}</span></a>`).join('');}
function staticPage(){const page=document.body.dataset.static;const pages={about:['About LK Newsroom','Independent journalism that helps people understand their world.','We are a modern newsroom built on accuracy, humanity and public service. Our team brings clear reporting and useful context to the stories that shape our communities.'],contact:['Contact us','We would like to hear from you.','For news tips, corrections, partnerships or general enquiries, email <strong>hello@lknewsroom.example</strong>. Our editorial desk reviews credible public-interest leads every day.'],privacy:['Privacy Policy','Your privacy matters to us.','We only collect information needed to deliver our service, such as newsletter sign-ups and account preferences. We do not sell your personal information.'],terms:['Terms of Use','A simple agreement for using LK Newsroom.','Content is provided for personal, non-commercial use. Please credit LK Newsroom when sharing excerpts and do not reproduce material without written permission.'],advertise:['Advertise with LK Newsroom','Reach an informed, engaged audience.','Our commercial team can create effective sponsorships, display campaigns and branded content opportunities with clear editorial safeguards.']};const content=pages[page]||pages.about;$('#static-title').textContent=content[0];$('#static-subtitle').textContent=content[1];$('#static-content').innerHTML=`<div class="article-body"><p>${content[2]}</p><h2>Our commitment</h2><p>We believe good journalism should be accessible, trustworthy and responsive to the people it serves. Contact our team for more information.</p></div>`;}
document.addEventListener('DOMContentLoaded',async()=>{setTheme();initShell();await Promise.all([hydrateNews(),refreshBreaking(),loadAdvertisements()]);connectLiveUpdates();const type=document.body.dataset.template;if(type==='home')home();if(type==='category')await categoryPage();if(type==='article')await articlePage();if(type==='search')searchPage();if(type==='live')livePage();if(type==='media')mediaPage(document.body.dataset.media);if(type==='static')staticPage();});
