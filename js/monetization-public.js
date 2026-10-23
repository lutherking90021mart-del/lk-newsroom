const $=(selector,parent=document)=>parent.querySelector(selector);

export async function mountSupportPage(){
  const title=$('#static-title'),subtitle=$('#static-subtitle'),target=$('#static-content');
  if(!target)return;
  if(title)title.textContent='Free news · Optional support';
  if(subtitle)subtitle.textContent='Every reader gets free access. Supporting us is entirely your choice.';
  target.innerHTML='<section class="panel"><h2>News should be accessible to everyone.</h2><p>All public news articles, categories, videos and newsroom updates are free. There is no paywall, paid membership, required donation or fee to use LK Newsroom.</p><p><strong>Would you like to help?</strong> Voluntary contributions are welcome but never required, and they do not unlock extra content or affect editorial decisions. Please contact our team directly for current, verified contribution options; do not send money in response to unsolicited messages.</p><p><a class="btn btn-primary" href="https://wa.me/233559627349?text=Hello%20LK%20Newsroom%2C%20I%20would%20like%20to%20ask%20about%20optional%20voluntary%20support." target="_blank" rel="noopener noreferrer">Ask about voluntary support</a> <a href="mailto:lutherking90021mart@gmail.com?subject=Optional%20LK%20Newsroom%20support">Email the team</a></p><p>Thank you for reading and sharing LK Newsroom.</p></section>';
}

export async function mountAdvertiseMarketplace(){
  const title=$('#static-title'),subtitle=$('#static-subtitle'),target=$('#static-content');
  if(!target)return;
  if(title)title.textContent='Free community announcements';
  if(subtitle)subtitle.textContent='No paid placements or checkout. Send a free announcement for editorial review.';
  target.innerHTML='<section class="panel"><h2>No paid checkout or advertising packages</h2><p>LK Newsroom has disabled paid advertising packages and online payment collection. For a community announcement or a possible editorial partnership, contact our team first. Publication is subject to editorial review and is not guaranteed.</p><p>Email <a href="mailto:martinluther@lknewsroom.online">martinluther@lknewsroom.online</a> or WhatsApp <a href="https://wa.me/233559627349" target="_blank" rel="noopener noreferrer">+233 55 962 7349</a>.</p></section>';
}
