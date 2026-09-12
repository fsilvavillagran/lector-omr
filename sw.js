const CACHE='omr-docente-v0.37.2';
const CORE=['./styles/main.css','./js/app.js?v=0.37.2','./manifest.webmanifest','./icons/icon-192.png','./icons/icon-512.png'];

self.addEventListener('install', event=>{
  event.waitUntil((async()=>{
    const cache=await caches.open(CACHE);
    for(const url of CORE){
      try{ await cache.add(url); }catch(_){}
    }
  })());
  self.skipWaiting();
});

self.addEventListener('activate', event=>{
  event.waitUntil((async()=>{
    for(const key of await caches.keys()){
      if(key!==CACHE) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event=>{
  if(event.request.method!=='GET') return;
  const req=event.request;
  const url=new URL(req.url);

  // Always prefer fresh HTML/navigation and the service worker itself.
  if(req.mode==='navigate' || url.pathname.endsWith('/sw.js')){
    event.respondWith((async()=>{
      try{
        const fresh=await fetch(req,{cache:'no-store'});
        const cache=await caches.open(CACHE);
        if(req.mode==='navigate') cache.put('./index.html', fresh.clone()).catch(()=>{});
        return fresh;
      }catch(err){
        return (await caches.match('./index.html')) || Response.error();
      }
    })());
    return;
  }

  // Static assets: cache fallback, but refresh from network when possible.
  event.respondWith((async()=>{
    try{
      const fresh=await fetch(req);
      const cache=await caches.open(CACHE);
      cache.put(req, fresh.clone()).catch(()=>{});
      return fresh;
    }catch(err){
      const cached=await caches.match(req);
      return cached || Response.error();
    }
  })());
});
