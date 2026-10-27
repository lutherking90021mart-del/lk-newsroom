self.addEventListener('push',event=>{let data={title:'LK Newsroom',message:'A new update is available.',url:'/'};try{data={...data,...event.data.json()};}catch{}event.waitUntil(self.registration.showNotification(data.title,{body:data.message,icon:'/assets/lk-newsroom-app-icon.svg',badge:'/assets/lk-newsroom-app-icon.svg',data:{url:data.url||'/'},tag:data.tag||'lk-newsroom'}));});
self.addEventListener('notificationclick',event=>{event.notification.close();event.waitUntil(clients.openWindow(event.notification.data?.url||'/'));});

// Cache only small static app metadata. Do not cache the homepage HTML by itself:
// offline navigation must not show a stale, unstyled shell without its CSS/JS.
const LK_PUBLIC_CACHE='lk-newsroom-public-shell-v2';
const LK_OFFLINE_PAGE='<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#003366"><title>LK Newsroom — Connection unavailable</title><style>*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;background:#f3f6fa;color:#142336;font:16px/1.6 system-ui,-apple-system,Segoe UI,sans-serif}.panel{max-width:560px;background:#fff;border:1px solid #dbe3ed;border-radius:18px;padding:32px;box-shadow:0 12px 36px #09254112}h1{margin:0 0 12px;color:#003366;font-size:1.7rem;line-height:1.2}p{margin:0 0 20px}.button{display:inline-block;border:0;border-radius:8px;padding:11px 18px;background:#003366;color:#fff;font:inherit;font-weight:700;cursor:pointer}</style></head><body><main class="panel"><h1>LK Newsroom is temporarily unreachable</h1><p>We could not connect to the live news service. Check your internet connection and try again. Your news page has not been replaced or deleted.</p><button class="button" onclick="location.reload()">Try again</button></main></body></html>';

self.addEventListener('install',event=>{
  event.waitUntil(caches.open(LK_PUBLIC_CACHE)
    .then(cache=>cache.addAll(['/manifest.webmanifest','/assets/lk-newsroom-app-icon.svg']))
    .catch(()=>{})
    .then(()=>self.skipWaiting()));
});
self.addEventListener('activate',event=>{
  event.waitUntil(caches.keys()
    .then(keys=>Promise.all(keys.filter(key=>key.startsWith('lk-newsroom-public-shell-')&&key!==LK_PUBLIC_CACHE).map(key=>caches.delete(key))))
    .then(()=>self.clients.claim()));
});
self.addEventListener('fetch',event=>{
  const request=event.request,url=new URL(request.url);
  if(request.method!=='GET'||url.origin!==self.location.origin||url.pathname.startsWith('/v1/')||url.pathname.startsWith('/admin/')||url.pathname.startsWith('/auth/'))return;
  if(request.mode==='navigate'){
    event.respondWith(fetch(request).catch(()=>new Response(LK_OFFLINE_PAGE,{
      status:503,
      headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'}
    })));
  }
});
