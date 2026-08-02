import { categories } from './data.js';

const root = () => document.body.dataset.root || '.';
const link = (path) => `${root()}/${path}`;
const esc = (value = '') => String(value).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));

/** Every story card has a single, full-card link to its own canonical /news/:id route. */
export function articleCard(article, compact = false) {
  const href=`/news/${encodeURIComponent(article.id)}`;
  const fallback=link('assets/default-news.svg');
  return `<article class="news-card" data-aos="fade-up"><a class="news-card__link" href="${href}" aria-label="Read ${esc(article.title)}"><span class="news-card__image"><img src="${esc(article.image||fallback)}" alt="" loading="lazy" onerror="this.src='${fallback}'"></span><span class="news-card__body"><span class="eyebrow">${esc(article.category)}</span><h3 class="headline">${esc(article.title)}</h3>${compact ? '' : `<span class="text-muted card-excerpt">${esc(article.excerpt)}</span>`}<span class="meta">${esc(article.source||'LK Newsroom')} · ${esc(article.time || article.date)} · ${Number(article.reading)||1} min read</span></span></a></article>`;
}

export function renderHeader(active = '') {
  const nav = [['Home','index.html'],['Latest','pages/category.html?category=Latest'],['Politics','pages/category.html?category=Politics'],['Business','pages/category.html?category=Business'],['Technology','pages/category.html?category=Technology'],['Sports','pages/category.html?category=Sports'],['More','pages/category.html?category=World']];
  const links = nav.map(([label,url]) => `<a class="${active === label.toLowerCase() ? 'active':''}" href="${link(url)}">${label}</a>`).join('');
  const header = document.querySelector('[data-site-header]');
  if (!header) return;
  header.innerHTML = `<a class="skip-link" href="#main-content">Skip to content</a><div class="topbar"><div class="container"><span><i class="fa-regular fa-calendar"></i> <span data-today></span></span><div class="topbar-links"><a href="${link('pages/about.html')}">About</a><a href="${link('pages/contact.html')}">Contact</a><a href="${link('pages/advertise.html')}">Advertise</a><a href="${link('admin/login.html')}">Admin</a></div></div></div><header class="site-header"><div class="container header-main"><a href="${link('index.html')}" aria-label="LK Newsroom home"><img class="brand" src="${link('assets/lk-newsroom-logo.png')}" alt="LK Newsroom"></a><nav class="primary-nav" aria-label="Primary navigation">${links}</nav><div class="header-actions"><a class="icon-button" href="${link('pages/search.html')}" aria-label="Search"><i class="fa-solid fa-magnifying-glass"></i></a><button class="icon-button" id="theme-toggle" aria-label="Toggle dark mode"><i class="fa-regular fa-moon"></i></button><button class="icon-button menu-button" id="menu-toggle" aria-label="Open menu"><i class="fa-solid fa-bars"></i></button></div></div><nav class="mobile-menu" id="mobile-menu" aria-label="Mobile navigation">${links}<a href="${link('pages/live.html')}"><span class="badge">Live</span> Live updates</a></nav></header>`;
}

export function renderBreaking(headlines = []) {
  const el = document.querySelector('[data-breaking]'); if (!el) return;
  const items = headlines.length ? headlines : ['Parliament approves landmark community health plan','Regional trade corridors open new opportunities','Black Stars ready for decisive qualifier this weekend','Coastal cities receive new climate finance support'];
  el.innerHTML = `<div class="breaking"><div class="container breaking-inner"><span class="breaking-label"><i class="fa-solid fa-bolt"></i>&nbsp; Breaking</span><div class="ticker-window"><div class="ticker-track">${[...items,...items].map(item=>{const headline=typeof item==='string'?item:item.headline;const href=typeof item==='string'?link('pages/live.html'):(item.link_url||link('pages/live.html'));return `<a class="ticker-item" href="${esc(href)}" ${typeof item==='string'?'': 'target="_blank" rel="noopener noreferrer"'}>${esc(headline)}</a>`}).join('')}</div></div></div></div>`;
}

export function renderNewsletter(target) {
  const el = target || document.querySelector('[data-newsletter]'); if (!el) return;
  el.innerHTML = `<section class="newsletter" data-aos="fade-up"><div><span class="eyebrow" style="color:#fff">The daily brief</span><h2>News worth your attention.</h2><p>Get the biggest stories, clear context and sharp analysis in your inbox.</p></div><form class="newsletter-form" data-newsletter-form><label class="hide" for="newsletter-email">Email address</label><input id="newsletter-email" type="email" required placeholder="Your email address"><button class="btn" type="submit">Subscribe <i class="fa-solid fa-arrow-right"></i></button></form></section>`;
}

export function renderFooter() {
  const el = document.querySelector('[data-site-footer]'); if (!el) return;
  const catLinks = categories.slice(0,6).map(([name])=>`<li><a href="${link(`pages/category.html?category=${name}`)}">${name}</a></li>`).join('');
  el.innerHTML = `<footer class="site-footer"><div class="container footer-main"><div><img class="footer-logo" src="${link('assets/lk-newsroom-logo.png')}" alt="LK Newsroom"><p>Independent reporting, clear context and the stories that shape our world.</p><div class="socials" aria-label="Follow LK Newsroom"><a href="https://www.facebook.com/profile.php?id=61570722200277" target="_blank" rel="noopener noreferrer" aria-label="Follow LK Newsroom on Facebook"><i class="fa-brands fa-facebook-f"></i></a><a href="https://www.instagram.com/lk.news.global/" target="_blank" rel="noopener noreferrer" aria-label="Follow LK Newsroom on Instagram"><i class="fa-brands fa-instagram"></i></a><a href="https://www.tiktok.com/@lk.news.global1" target="_blank" rel="noopener noreferrer" aria-label="Follow LK Newsroom on TikTok"><i class="fa-brands fa-tiktok"></i></a><a href="https://www.threads.com/@lk.news.global" target="_blank" rel="noopener noreferrer" aria-label="Follow LK Newsroom on Threads"><i class="fa-brands fa-threads"></i></a></div></div><div><h4>Sections</h4><ul class="footer-links">${catLinks}</ul></div><div><h4>Explore</h4><ul class="footer-links"><li><a href="${link('pages/live.html')}">Live Updates</a></li><li><a href="${link('pages/video-news.html')}">Video News</a></li><li><a href="${link('pages/gallery.html')}">Photo Gallery</a></li><li><a href="${link('pages/newsletter.html')}">Newsletter</a></li><li><a href="${link('pages/search.html')}">Search</a></li></ul></div><div><h4>Company</h4><ul class="footer-links"><li><a href="${link('pages/about.html')}">About us</a></li><li><a href="${link('pages/contact.html')}">Contact</a></li><li><a href="${link('pages/privacy.html')}">Privacy policy</a></li><li><a href="${link('pages/terms.html')}">Terms of use</a></li><li><a href="${link('pages/advertise.html')}">Advertise</a></li></ul></div></div><div class="container footer-bottom"><span>© <span data-year></span> LK Newsroom. All rights reserved.</span><span>Informing Today, Inspiring Tomorrow</span></div></footer>`;
}

export function toast(message) {
  let el = document.querySelector('.toast'); if (!el) { el = document.createElement('div'); el.className='toast'; document.body.append(el); }
  el.textContent = message; el.classList.add('show'); setTimeout(()=>el.classList.remove('show'),3300);
}

export { link, esc };
