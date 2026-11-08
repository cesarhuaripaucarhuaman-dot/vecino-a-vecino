const C="vav-v8",FILES=["./","index.html","manifest.json","icon.svg"];
const LIB=["https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.js","https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.css","https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js"];
self.addEventListener("install",e=>{e.waitUntil(caches.open(C).then(c=>Promise.all([c.addAll(FILES)].concat(LIB.map(u=>fetch(u,{mode:"no-cors"}).then(r=>c.put(u,r)).catch(()=>{}))))));self.skipWaiting()});
self.addEventListener("activate",e=>{e.waitUntil(caches.keys().then(k=>Promise.all(k.filter(x=>x!==C).map(x=>caches.delete(x)))));self.clients.claim()});
self.addEventListener("fetch",e=>{
  if(e.request.method!=="GET"||e.request.url.indexOf("/api/")>=0)return;
  if(new URL(e.request.url).origin!==location.origin&&LIB.indexOf(e.request.url)<0)return;
  e.respondWith(fetch(e.request).then(r=>{const cp=r.clone();caches.open(C).then(c=>c.put(e.request,cp));return r}).catch(()=>caches.match(e.request).then(m=>m||caches.match("index.html"))));
});
self.addEventListener("push",e=>{
  let d={};try{d=e.data.json()}catch(x){}
  e.waitUntil(self.registration.showNotification(d.title||"🚨 Alerta vecinal",{body:d.body||"Un vecino necesita ayuda.",vibrate:[500,200,500,200,500,200,800],tag:"alerta",renotify:true,requireInteraction:true,icon:"icon.svg"}));
});
self.addEventListener("notificationclick",e=>{
  e.notification.close();
  e.waitUntil(clients.matchAll({type:"window",includeUncontrolled:true}).then(l=>l.length?l[0].focus():clients.openWindow("./")));
});
