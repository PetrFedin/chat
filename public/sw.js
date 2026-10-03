const CACHE='chat-shell-v27';
const SHELL=['/','/styles.css','/calls.css','/preferences.css','/daily-work.css','/meeting-intelligence.css','/preferences.js','/preferences-context.js','/app.js','/meeting-intelligence.js','/meeting-operations.js','/daily-work.js','/requests.js','/calls-ui.js','/demo.js','/manifest.webmanifest','/icon.svg','/icon-192.png','/icon-512.png','/apple-touch-icon.png'];

self.addEventListener('install',(event)=>event.waitUntil(
  caches.open(CACHE).then((cache)=>cache.addAll(SHELL)).then(()=>self.skipWaiting())
));

self.addEventListener('activate',(event)=>event.waitUntil(
  caches.keys()
    .then((keys)=>Promise.all(keys.filter((key)=>key!==CACHE).map((key)=>caches.delete(key))))
    .then(()=>self.clients.claim())
));

/**
 * Сначала сеть, кэш — на случай её отсутствия.
 *
 * Две вещи, на которых это ломалось.
 *
 * Первая: в кэш клался любой ответ, включая 404 и 500. Один неудачный
 * запрос к значку — скажем, в секунду перезапуска сервера — и в кэше
 * навсегда оставалась «не найдено». Дальше, стоило сети моргнуть, знак
 * приходил пустым квадратом с надорванным уголком, и понять, почему,
 * из кода было нельзя. Кладём только удачное.
 *
 * Вторая: когда в кэше ничего не нашлось, отдавалась страница целиком —
 * на любой запрос. Картинка, получившая в ответ HTML, — это та же
 * поломка, только с другой стороны. Страницу подставляем лишь переходу
 * по адресу: ради него всё и затевалось, чтобы приложение открывалось
 * без сети.
 */
self.addEventListener('fetch',(event)=>{
  const request=event.request;
  const url=new URL(request.url);
  if(request.method!=='GET'||url.origin!==location.origin||url.pathname.startsWith('/api/')) return;
  event.respondWith(
    fetch(request).then((response)=>{
      if(response.ok&&response.type==='basic'){
        const copy=response.clone();
        caches.open(CACHE).then((cache)=>cache.put(request,copy)).catch(()=>{});
      }
      return response;
    }).catch(()=>caches.match(request).then((cached)=>
      cached??(request.mode==='navigate'?caches.match('/'):Response.error())))
  );
});

self.addEventListener('push',(event)=>{
  let data={title:'ChatX',body:'Новое уведомление',url:'/'};
  try{data={...data,...event.data.json()}}catch{}
  event.waitUntil(Promise.all([
    self.registration.showNotification(data.title,{
      body:data.body,
      // Растровый значок, а не SVG: Chrome на Android второй в
      // уведомлении не рисует вовсе, и приходит уведомление без знака.
      icon:'/icon-192.png',
      badge:'/icon-192.png',
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
