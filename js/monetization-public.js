const $=(selector,parent=document)=>parent.querySelector(selector);

const EMAIL='lutherking90021mart@gmail.com';
const WHATSAPP='https://wa.me/233559627349';

export async function mountSupportPage(){
  const title=$('#static-title'),subtitle=$('#static-subtitle'),target=$('#static-content');
  if(!target)return;
  if(title)title.textContent='Free news. Optional support.';
  if(subtitle)subtitle.textContent='Every LK Newsroom reader gets full public access without paying.';
  target.innerHTML='<section class="panel"><h2>News should be accessible to everyone.</h2><p>All public news articles, categories, videos, live scores and newsroom updates are free to read. No paid membership, subscription, donation or checkout is required to access any public story or feature.</p><p><strong>Would you like to support our work?</strong> Support is completely voluntary. It does not unlock extra content, change your access, or give you special treatment. Contact the team first for current, verified voluntary-support options; never send money based only on an unsolicited message.</p><p><a class="btn btn-primary" href="mailto:'+EMAIL+'?subject='+encodeURIComponent('Optional support for LK Newsroom')+'">Ask about voluntary support</a> <a class="btn btn-outline" href="'+WHATSAPP+'" target="_blank" rel="noopener noreferrer">Contact LK Newsroom</a></p><p>Thank you for reading, sharing our reporting, sending story tips and correcting errors. Those are valuable ways to help, too.</p><p>Questions or feedback? Email <a href="mailto:'+EMAIL+'">'+EMAIL+'</a>.</p></section>';
}

export async function mountAdvertiseMarketplace(){
  const title=$('#static-title'),subtitle=$('#static-subtitle'),target=$('#static-content');
  if(!target)return;
  if(title)title.textContent='Free community announcements';
  if(subtitle)subtitle.textContent='Share community news with LK Newsroom at no charge.';
  target.innerHTML='<section class="panel"><h2>No paid packages or checkout</h2><p>LK Newsroom is not selling paid reader access, subscriptions, membership plans or online promotional packages. Community announcements may be submitted free of charge and are subject to editorial review; publication is not guaranteed.</p><p>We never require payment to read, submit a story tip, request a correction or ask the newsroom a question.</p><p><a class="btn btn-primary" href="mailto:'+EMAIL+'?subject='+encodeURIComponent('Free community announcement')+'">Submit a community announcement</a> <a class="btn btn-outline" href="'+WHATSAPP+'" target="_blank" rel="noopener noreferrer">Contact our team</a></p><p>Organisations that would like to voluntarily support our journalism may contact the team separately. Support is optional and does not buy editorial coverage or reader access.</p></section>';
}
