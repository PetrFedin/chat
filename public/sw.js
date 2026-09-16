const CACHE='chat-shell-v5';
const SHELL=['/','/styles.css','/calls.css','/preferences.css','/preferences.js','/preferences-context.js','/app.js','/calls-ui.js','/demo.js','/manifest.webmanifest','/icon.svg'];

self.addEventListener('install',(event)=>event.waitUntil(
  caches.open(CACHE).then((cache)=>cache.addAll(SHELL)).then(()=>self.skipWaiting())
));

self.addEventListener('activate',(event)=>event.waitUntil(
  caches.keys()
    .then((keys)=>Promise.all(keys.filter((key)=>key!==CACHE).map((key)=>caches.delete(key))))
    .then(()=>self.clients.claim())
));

self.addEventListener('fetch',(event)=>{
  const request=event.request;
  const url=new URL(request.url);
  if(request.method!=='GET'||url.origin!==location.origin||url.pathname.startsWith('/api/')) return;
  event.respondWith(
    fetch(request).then((response)=>{
      const copy=response.clone();
      caches.open(CACHE).then((cache)=>cache.put(request,copy));
      return response;
    }).catch(()=>caches.match(request).then((cached)=>cached||caches.match('/')))
  );
});

self.addEventListener('push',(event)=>{
  let data={title:'Chat',body:'Новое уведомление',url:'/'};
  try{data={...data,...event.data.json()}}catch{}
  event.waitUntil(Promise.all([
    self.registration.showNotification(data.title,{
      body:data.body,
      icon:'/icon.svg',
      badge:'/icon.svg',
      data:{url:data.url||'/'}
    }),
    clients.matchAll({type:'window',includeUncontrolled:true}).then((windows)=>
      Promise.all(windows.map((client)=>client.postMessage({type:'chat.push',payload:data})))
    )
  ]));
});

self.addEventListener('notificationclick',(event)=>{
  event.notification.close();
  event.waitUntil(clients.matchAll({type:'window',includeUncontrolled:true}).then((windows)=>{
    const url=event.notification.data?.url||'/';
    for(const client of windows){
      if('focus'in client){client.navigate(url);return client.focus();}
    }
    return clients.openWindow?clients.openWindow(url):undefined;
  }));
});