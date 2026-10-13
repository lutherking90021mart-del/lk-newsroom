self.addEventListener('push',event=>{let data={title:'LK Newsroom',message:'A new update is available.',url:'/'};try{data={...data,...event.data.json()};}catch{}event.waitUntil(self.registration.showNotification(data.title,{body:data.message,icon:'/assets/lk-newsroom-logo.png',badge:'/assets/lk-newsroom-logo.png',data:{url:data.url||'/'},tag:data.tag||'lk-newsroom'}));});
self.addEventListener('notificationclick',event=>{event.notification.close();event.waitUntil(clients.openWindow(event.notification.data?.url||'/'));});

const LK_PUBLIC_CACHE='lk-newsroom-public-shell-v1';
self.addEventListener('install',event=>{
  event.waitUntil(caches.open(LK_PUBLIC_CACHE).then(cache=>cache.addAll(['/','/manifest.webmanifest','/assets/lk-newsroom-app-icon.svg'])).catch(()=>{}).then(()=>self.skipWaiting()));
});
self.addEventListener('activate',event=>{
  event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith('lk-newsroom-public-shell-')&&key!==LK_PUBLIC_CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim()));
});
self.addEventListener('fetch',event=>{
  const request=event.request,url=new URL(request.url);
  if(request.method!=='GET'||url.origin!==self.location.origin||url.pathname.startsWith('/v1/')||url.pathname.startsWith('/admin/')||url.pathname.startsWith('/auth/'))return;
  if(request.mode==='navigate'){
    event.respondWith(fetch(request).then(response=>{
      if(response.ok&&url.pathname==='/')caches.open(LK_PUBLIC_CACHE).then(cache=>cache.put('/',response.clone()));
      return response;
    }).catch(()=>caches.match('/')));
  }
});
