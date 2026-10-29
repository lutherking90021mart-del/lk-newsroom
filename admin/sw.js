const CACHE_NAME='lk-admin-shell-v2';
const SHELL=['/admin/index.html','/admin/manifest.webmanifest','/assets/lk-newsroom-logo.png'];
self.addEventListener('install',event=>{event.waitUntil(caches.open(CACHE_NAME).then(cache=>cache.addAll(SHELL)).then(()=>self.skipWaiting()));});
self.addEventListener('activate',event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith('lk-admin-shell-')&&key!==CACHE_NAME).map(key=>caches.delete(key)))).then(()=>self.clients.claim()));});
self.addEventListener('fetch',event=>{
  const request=event.request;
  const url=new URL(request.url);
  if(request.method!=='GET'||url.origin!==self.location.origin||url.pathname.startsWith('/v1/')||url.pathname.startsWith('/auth/')||url.pathname.includes('/login'))return;
  if(request.mode==='navigate'&&url.pathname.startsWith('/admin/')){
    event.respondWith(fetch(request).then(response=>{if(response.ok){const copy=response.clone();caches.open(CACHE_NAME).then(cache=>cache.put('/admin/index.html',copy));}return response;}).catch(()=>caches.match('/admin/index.html')));
  }
});
