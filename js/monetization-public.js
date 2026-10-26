const $=(selector,parent=document)=>parent.querySelector(selector);

export async function mountSupportPage(){
  const title=$('#static-title'),subtitle=$('#static-subtitle'),target=$('#static-content');
  if(!target)return;
  if(title)title.textContent='Free access for every reader';
  if(subtitle)subtitle.textContent='LK Newsroom news and articles are free to read.';
  target.innerHTML='<section class="panel"><h2>News should be accessible to everyone.</h2><p>All public news articles, categories and newsroom updates are available free of charge. LK Newsroom does not require a paid membership, donation or subscription to read its coverage.</p><p>Thank you for reading and sharing LK Newsroom.</p><p>Questions or feedback? Contact <a href="mailto:martinluther@lknewsroom.online">martinluther@lknewsroom.online</a>.</p></section>';
}

export async function mountAdvertiseMarketplace(){
  const title=$('#static-title'),subtitle=$('#static-subtitle'),target=$('#static-content');
  if(!target)return;
  if(title)title.textContent='Community promotions';
  if(subtitle)subtitle.textContent='Contact LK Newsroom about free community announcements.';
  target.innerHTML='<section class="panel"><h2>No paid checkout or advertising packages</h2><p>LK Newsroom has disabled paid advertising packages and online payment collection. For a community announcement or a possible editorial partnership, contact our team first. Publication is subject to editorial review and is not guaranteed.</p><p>Email <a href="mailto:martinluther@lknewsroom.online">martinluther@lknewsroom.online</a> or WhatsApp <a href="https://wa.me/233559627349" target="_blank" rel="noopener noreferrer">+233 55 962 7349</a>.</p></section>';
}
