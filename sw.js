self.addEventListener('push',event=>{
  let data={title:'LK Newsroom',message:'A new update is available.',url:'/'};
  try{data={...data,...event.data.json()};}catch{}
  event.waitUntil(self.registration.showNotification(data.title,{
    body:data.message,
    icon:'/assets/lk-newsroom-logo.png',
    badge:'/assets/lk-newsroom-logo.png',
    data:{url:data.url||'/'},
    tag:data.tag||'lk-newsroom'
  }));
});
self.addEventListener('notificationclick',event=>{
  event.notification.close();
  event.waitUntil(clients.openWindow(event.notification.data?.url||'/'));
});

// Bump this cache when the public shell changes. This deliberately discards
// the old potentially unstyled homepage cached by previous mobile/PWA sessions.
const LK_PUBLIC_CACHE='lk-newsroom-public-shell-v4';
const LK_SHELL_ASSETS=[
  '/',
  '/manifest.webmanifest',
  '/assets/lk-newsroom-logo.png',
  '/styles/global.css',
  '/styles/variables.css',
  '/styles/typography.css',
  '/styles/animations.css',
  '/styles/navbar.css',
  '/styles/hero.css',
  '/styles/breaking-news.css',
  '/styles/cards.css',
  '/styles/articles.css',
  '/styles/sidebar.css',
  '/styles/weather.css',
  '/styles/search.css',
  '/styles/footer.css',
  '/styles/forms.css',
  '/styles/darkmode.css',
  '/styles/responsive.css',
  '/styles/mobile.css',
  '/styles/video-player.css',
  '/styles/sports-center.css'
];
self.addEventListener('install',event=>{
  event.waitUntil((async()=>{
    const cache=await caches.open(LK_PUBLIC_CACHE);
    // Do not let one missing optional asset prevent the new shell from
    // activating; each file is cached independently.
    await Promise.all(LK_SHELL_ASSETS.map(async path=>{
      try{
        const response=await fetch(path,{cache:'reload'});
        if(response.ok)await cache.put(path,response);
      }catch{}
    }));
    await self.skipWaiting();
  })());
});
self.addEventListener('activate',event=>{
  event.waitUntil(caches.keys()
    .then(keys=>Promise.all(keys
      .filter(key=>key.startsWith('lk-newsroom-public-shell-')&&key!==LK_PUBLIC_CACHE)
      .map(key=>caches.delete(key))))
    .then(()=>self.clients.claim()));
});
self.addEventListener('fetch',event=>{
  const request=event.request,url=new URL(request.url);
  if(request.method!=='GET'||url.origin!==self.location.origin||
    url.pathname.startsWith('/v1/')||url.pathname.startsWith('/api/')||
    url.pathname.startsWith('/admin/')||url.pathname.startsWith('/auth/'))return;

  if(request.mode==='navigate'){
    event.respondWith(fetch(request).then(response=>{
      if(response.ok&&url.pathname==='/'){
        event.waitUntil(caches.open(LK_PUBLIC_CACHE).then(cache=>cache.put('/',response.clone())).catch(()=>{}));
      }
      return response;
    }).catch(async()=>{
      // Only use an offline shell when the network really is unavailable.
      return (await caches.match('/'))||Response.error();
    }));
    return;
  }

  const isPublicStyle=/^\/styles\/[^/]+\.css$/i.test(url.pathname);
  const isPublicScript=/^(?:\/pwa-install\.js|\/js\/(?:app|components|data|config|sports-center|weather|ads|analytics|monetization-public|supabase-client)\.js)$/i.test(url.pathname);
  if(isPublicStyle||isPublicScript){
    event.respondWith(fetch(request).then(async response=>{
      if(!response.ok)return response;
      const contentType=String(response.headers.get('content-type')||'').toLowerCase();
      const expectedType=isPublicStyle?contentType.includes('text/css'):(contentType.includes('javascript')||contentType.includes('ecmascript'));
      if(!expectedType){
        // Never overwrite a good cached stylesheet/module with an HTML error
        // page returned as HTTP 200 by a broken asset route.
        const cached=await caches.match(request,{ignoreSearch:true});
        return cached||response;
      }
      event.waitUntil(caches.open(LK_PUBLIC_CACHE).then(cache=>cache.put(request,response.clone())).catch(()=>{}));
      return response;
    }).catch(async()=>{
      // Query-string cache busts are ignored for the offline copy, because the
      // installed app may reconnect after a deployment while offline.
      return (await caches.match(request,{ignoreSearch:true}))||Response.error();
    }));
  }
});
