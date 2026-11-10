import { categories } from './data.js';

const root = () => document.body.dataset.root || '.';
const link = (path) => `${root()}/${path}`;
const esc = (value = '') => String(value).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const categoryUrl=name=>link(`category/${String(name).toLowerCase().replace(/&/g,'and').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')}`);

/** Every story card has a single, full-card link to its own canonical /news/:id route. */
export function articleCard(article, compact = false) {
  const href=`/news/${encodeURIComponent(article.id)}`;
  return `<article class="news-card news-card--text-only" data-aos="fade-up"><a class="news-card__link" href="${href}" aria-label="Read ${esc(article.title)}"><span class="news-card__body"><span class="eyebrow">${esc(article.category)}</span><h3 class="headline">${esc(article.title)}</h3>${compact ? '' : `<span class="text-muted card-excerpt">${esc(article.excerpt)}</span>`}<span class="meta">${esc(article.source||'LK Newsroom')} · ${esc(article.time || article.date)} · ${Number(article.reading)||1} min read</span></span></a></article>`;
}

export function renderHeader(active = '') {
  const nav = [['Home',link('index.html')],['Latest',categoryUrl('Latest')],['Politics',categoryUrl('Politics')],['Business',categoryUrl('Business')],['Technology',categoryUrl('Technology')],['Sports',categoryUrl('Sports')],['Live Scores',link('pages/sports.html#live-scores')],['World',categoryUrl('World')],['Alerts',link('pages/notifications.html')]];
  const links = nav.map(([label,url]) => `<a class="${active === label.toLowerCase() ? 'active':''}" href="${url}">${label}</a>`).join('');
  const header = document.querySelector('[data-site-header]');
  if (!header) return;
  header.innerHTML = `<a class="skip-link" href="#main-content">Skip to content</a><div class="topbar"><div class="container"><span><i class="fa-regular fa-calendar"></i> <span data-today></span></span><div class="topbar-links"><a href="${link('pages/about.html')}">About</a><a href="${link('pages/contact.html')}">Contact</a><a href="${link('pages/company.html')}">Company Hub</a><a href="${link('pages/advertise.html')}">Advertise</a></div></div></div><header class="site-header"><div class="container header-main"><a href="${link('index.html')}" aria-label="LK Newsroom home"><img class="brand" src="${link('assets/lk-newsroom-logo.svg')}" alt="LK Newsroom"></a><nav class="primary-nav" aria-label="Primary navigation">${links}</nav><div class="header-actions"><a class="icon-button" href="${link('pages/search.html')}" aria-label="Search"><i class="fa-solid fa-magnifying-glass"></i></a><a class="icon-button header-user" href="${link('pages/notifications.html')}" aria-label="Your notification settings"><i class="fa-regular fa-user"></i></a><button class="icon-button theme-button" id="theme-toggle" aria-label="Toggle dark mode"><i class="fa-regular fa-moon"></i></button><button class="icon-button menu-button" id="menu-toggle" aria-label="Open navigation menu" aria-controls="mobile-menu" aria-expanded="false"><i class="fa-solid fa-bars"></i></button></div></div><button class="mobile-menu-backdrop" id="mobile-menu-backdrop" aria-label="Close navigation menu" tabindex="-1"></button><nav class="mobile-menu" id="mobile-menu" aria-label="Mobile navigation"><div class="mobile-menu__heading"><strong>Explore LK Newsroom</strong><button class="icon-button" id="menu-close" aria-label="Close navigation menu"><i class="fa-solid fa-xmark"></i></button></div>${links}<a href="${link('pages/live.html')}"><span class="badge">Live</span> Live updates</a></nav></header>`;

  // Mount the first-party LK Assistant Contact Hub on every page using the shared header.
  if (!document.getElementById('lk-assistant-launch')) {
    const assistant = document.createElement('div');
    assistant.id = 'lk-assistant-root';
    assistant.innerHTML = `
      <button class="lk-assistant-launch" id="lk-assistant-launch" type="button" aria-controls="lk-assistant-panel" aria-expanded="false"><span aria-hidden="true">●</span> Ask LK Assistant</button>
      <section class="lk-assistant-panel" id="lk-assistant-panel" role="dialog" aria-label="LK Newsroom assistant" aria-modal="false" aria-hidden="true">
        <div class="lk-assistant-head"><div><strong>✧ LK Assistant</strong><small>AI-powered answers · Human handoff available</small></div><button class="lk-assistant-close" id="lk-assistant-close" type="button" aria-label="Close chat">×</button></div>
        <div class="lk-assistant-messages" id="lk-assistant-messages" aria-live="polite"><div class="lk-assistant-bubble bot">Akwaaba! 👋 I’m the LK Newsroom assistant. Ask about advertising, payments, contacting the team, news coverage, or choose a quick topic below.</div></div>
        <div class="lk-assistant-quick"><button type="button" data-lk-question="How do I advertise with LK Newsroom?">Advertising</button><button type="button" data-lk-question="How do payments work?">Payment details</button><button type="button" data-lk-question="How do I contact the team?">Contact team</button><button type="button" data-lk-question="I want to speak to a human administrator.">Talk to admin</button></div>
        <form class="lk-assistant-input" id="lk-assistant-form"><input id="lk-assistant-text" aria-label="Type your question" placeholder="Type your question..." autocomplete="off" maxlength="1200" required><button type="submit" aria-label="Send message">↑</button></form>
      </section>`;
    document.body.appendChild(assistant);
    const panel=assistant.querySelector('#lk-assistant-panel');
    const launch=assistant.querySelector('#lk-assistant-launch');
    const close=assistant.querySelector('#lk-assistant-close');
    const messages=assistant.querySelector('#lk-assistant-messages');
    const form=assistant.querySelector('#lk-assistant-form');
    const input=assistant.querySelector('#lk-assistant-text');
    const handoff='https://wa.me/233559627349?text='+encodeURIComponent('Hello LK Newsroom team, I need help from an administrator.');
    const toggle=open=>{panel.classList.toggle('open',open);panel.setAttribute('aria-hidden',String(!open));launch.setAttribute('aria-expanded',String(open));if(open)setTimeout(()=>input.focus(),60);};
    launch.addEventListener('click',()=>toggle(!panel.classList.contains('open')));
    close.addEventListener('click',()=>toggle(false));
    const bubble=(value,who)=>{const node=document.createElement('div');node.className='lk-assistant-bubble '+who;node.textContent=value;messages.appendChild(node);messages.scrollTop=messages.scrollHeight;return node;};
    const handoffLink=()=>{const a=document.createElement('a');a.className='lk-assistant-handoff';a.href=handoff;a.target='_blank';a.rel='noopener noreferrer';a.textContent='Talk to an administrator on WhatsApp';messages.appendChild(a);messages.scrollTop=messages.scrollHeight;};
    const send=async raw=>{
      const question=String(raw||'').trim();if(!question)return;
      bubble(question,'user');
      if(/admin|human|person|whatsapp|staff|speak to|talk to/i.test(question)){bubble('I can connect you with the LK Newsroom team on WhatsApp.','bot');handoffLink();return;}
      const pending=bubble('One moment…','bot');
      try{
        const api=String(window.LK_AGGREGATOR_API_URL||location.origin).replace(/\/$/,'');
        const response=await fetch(api+'/v1/company/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:question})});
        const data=await response.json();pending.remove();
        if(response.ok&&data.answer){bubble(data.answer,'bot');return;}
        bubble(data.error||'The assistant is temporarily unavailable. Please try again or contact our team.','bot');handoffLink();
      }catch(error){pending.remove();bubble('I could not reach the assistant service just now. Please try again or contact our team on WhatsApp.','bot');handoffLink();}
    };
    form.addEventListener('submit',event=>{event.preventDefault();const value=input.value;input.value='';send(value);});
    assistant.querySelectorAll('[data-lk-question]').forEach(button=>button.addEventListener('click',()=>send(button.dataset.lkQuestion)));
  }
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
  const catLinks = categories.slice(0,6).map(([name])=>`<li><a href="${categoryUrl(name)}">${name}</a></li>`).join('');
  el.innerHTML = `<footer class="site-footer"><div class="container footer-main"><div><img class="footer-logo" src="${link('assets/lk-newsroom-logo.png')}" alt="LK Newsroom"><p>Independent reporting, clear context and the stories that shape our world.</p><div class="socials" aria-label="Follow LK Newsroom"><a href="https://www.facebook.com/profile.php?id=61570722200277" target="_blank" rel="noopener noreferrer" aria-label="Follow LK Newsroom on Facebook"><i class="fa-brands fa-facebook-f"></i></a><a href="https://www.instagram.com/lk.news.global/" target="_blank" rel="noopener noreferrer" aria-label="Follow LK Newsroom on Instagram"><i class="fa-brands fa-instagram"></i></a><a href="https://www.tiktok.com/@lk.news.global1" target="_blank" rel="noopener noreferrer" aria-label="Follow LK Newsroom on TikTok"><i class="fa-brands fa-tiktok"></i></a><a href="https://www.threads.com/@lk.news.global" target="_blank" rel="noopener noreferrer" aria-label="Follow LK Newsroom on Threads"><i class="fa-brands fa-threads"></i></a></div></div><div><h4>Sections</h4><ul class="footer-links">${catLinks}</ul></div><div><h4>Explore</h4><ul class="footer-links"><li><a href="${link('pages/live.html')}">Live Updates</a></li><li><a href="${link('pages/video-news.html')}">Video News</a></li><li><a href="${link('pages/gallery.html')}">Photo Gallery</a></li><li><a href="${link('pages/newsletter.html')}">Newsletter</a></li><li><a href="${link('pages/search.html')}">Search</a></li></ul></div><div><h4>Company</h4><ul class="footer-links"><li><a href="${link('pages/about.html')}">About us</a></li><li><a href="${link('pages/contact.html')}">Contact</a></li><li><a href="${link('pages/company.html')}">Company Hub</a></li><li><a href="${link('pages/privacy.html')}">Privacy policy</a></li><li><a href="${link('pages/terms.html')}">Terms of use</a></li><li><a href="${link('pages/advertise.html')}">Advertise</a></li><li><a href="${link('pages/support.html')}">Support us</a></li></ul></div></div><div class="container footer-bottom"><span>© <span data-year></span> LK Newsroom. All rights reserved.</span><span>Informing Today, Inspiring Tomorrow</span></div></footer>`;
  enhanceFooterAccordion(el);
}

function enhanceFooterAccordion(footer){
  const main=footer.querySelector('.footer-main');if(!main)return;
  const section=(title,items)=>`<details class="footer-section" open><summary>${title}<i class="fa-solid fa-chevron-down" aria-hidden="true"></i></summary><ul class="footer-links">${items}</ul></details>`;
  const categoryLinks=categories.slice(0,6).map(([name])=>`<li><a href="${categoryUrl(name)}">${name}</a></li>`).join('');
  main.innerHTML=`<div class="footer-brand"><img class="footer-logo" src="${link('assets/lk-newsroom-logo.png')}" alt="LK Newsroom"><p>Independent reporting, clear context and the stories that shape our world.</p><p class="footer-slogan">Informing Today, Inspiring Tomorrow</p></div>${section('Explore',`${categoryLinks}<li><a href="${link('pages/live.html')}">Live Updates</a></li><li><a href="${link('pages/video-news.html')}">Video News</a></li><li><a href="${link('pages/gallery.html')}">Photo Gallery</a></li><li><a href="${link('pages/search.html')}">Search</a></li>`)}${section('Company',`<li><a href="${link('pages/about.html')}">About us</a></li><li><a href="${link('pages/contact.html')}">Contact</a></li><li><a href="${link('pages/company.html')}">Company Hub</a></li><li><a href="${link('pages/advertise.html')}">Advertise</a></li><li><a href="${link('pages/support.html')}">Support us</a></li>`)}${section('Social Media',`<li><a href="https://www.facebook.com/profile.php?id=61570722200277" target="_blank" rel="noopener noreferrer">Facebook</a></li><li><a href="https://www.instagram.com/lk.news.global/" target="_blank" rel="noopener noreferrer">Instagram</a></li><li><a href="https://www.tiktok.com/@lk.news.global1" target="_blank" rel="noopener noreferrer">TikTok</a></li><li><a href="https://www.threads.com/@lk.news.global" target="_blank" rel="noopener noreferrer">Threads</a></li>`)}${section('Legal',`<li><a href="${link('pages/privacy.html')}">Privacy policy</a></li><li><a href="${link('pages/terms.html')}">Terms of use</a></li><li><a href="${link('pages/newsletter.html')}">Newsletter</a></li>`)}`;
}

export function toast(message) {
  let el = document.querySelector('.toast'); if (!el) { el = document.createElement('div'); el.className='toast'; document.body.append(el); }
  el.textContent = message; el.classList.add('show'); setTimeout(()=>el.classList.remove('show'),3300);
}

export { link, esc };
