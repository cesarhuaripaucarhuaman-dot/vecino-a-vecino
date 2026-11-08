// Vecino a Vecino - servidor sin dependencias (web-push opcional).
// Datos: Supabase si hay SUPABASE_URL + SUPABASE_SERVICE_KEY; si no, archivo data.json.
const http=require("http"),fs=require("fs"),path=require("path"),os=require("os"),crypto=require("crypto");
let webpush=null;try{webpush=require("web-push")}catch(e){}
const PUBK=process.env.VAPID_PUBLIC_KEY||"",PRIVK=process.env.VAPID_PRIVATE_KEY||"";
const PUSH=!!(webpush&&PUBK&&PRIVK);
if(PUSH)webpush.setVapidDetails(process.env.VAPID_SUBJECT||"mailto:vecinos@example.com",PUBK,PRIVK);
const PORT=process.env.PORT||3000,FILE=path.join(process.env.DATA_DIR||__dirname,"data.json"),PUB=path.join(__dirname,"public");
const SB_URL=(process.env.SUPABASE_URL||"").replace(/\/+$/,""),SB_KEY=process.env.SUPABASE_SERVICE_KEY||"",USE_SB=!!(SB_URL&&SB_KEY);
const SBH=()=>{const h={apikey:SB_KEY};if(!SB_KEY.startsWith("sb_"))h.Authorization="Bearer "+SB_KEY;return h};
const TYPES=["serv","prod","favor","sos","rec"],RK=["nuevo","encamino","resuelto"];
const MIME={".html":"text/html; charset=utf-8",".js":"text/javascript",".json":"application/json",".svg":"image/svg+xml"};
const ADMINS=(process.env.ADMIN_TELS||"").split(",").map(t=>t.replace(/\D/g,"")).filter(Boolean);
const S=(v,n)=>String(v==null?"":v).slice(0,n),norm=t=>String(t||"").replace(/\D/g,"");
const sha=t=>crypto.createHash("sha256").update(t).digest("hex");
const hash=(pin,salt)=>crypto.scryptSync(String(pin),salt,32).toString("hex");
let db={items:[],subs:[],dead:[],alert:null,users:[],sessions:{},reports:[]};
async function loadDB(){
  let j=null;
  if(USE_SB){
    const r=await fetch(SB_URL+"/rest/v1/vav_store?key=eq.main&select=value",{headers:SBH()});
    if(!r.ok)throw new Error("Supabase respondio "+r.status);
    const a=await r.json();if(a[0])j=a[0].value;
  }else{try{j=JSON.parse(fs.readFileSync(FILE,"utf8"))}catch(e){}}
  if(Array.isArray(j))db.items=j;else if(j)db=Object.assign(db,j);
  db.items=db.items.filter(x=>!/^s\d+$/.test(x.id));
  const now=Date.now();for(const k of Object.keys(db.sessions))if(now-db.sessions[k].ts>90*864e5)delete db.sessions[k];
}
let dirty=false,saving=false,timer=null;
function save(){dirty=true;if(!timer)timer=setTimeout(flush,1500)}
async function flush(){
  timer=null;if(!dirty||saving)return;dirty=false;saving=true;
  try{
    if(USE_SB){
      const r=await fetch(SB_URL+"/rest/v1/vav_store",{method:"POST",headers:Object.assign({"Content-Type":"application/json",Prefer:"resolution=merge-duplicates,return=minimal"},SBH()),body:JSON.stringify({key:"main",value:db})});
      if(!r.ok){console.log("Guardado en Supabase fallo:",r.status,await r.text());dirty=true}
    }else fs.writeFileSync(FILE,JSON.stringify(db));
  }catch(e){console.log("Guardado fallo:",e.message);dirty=true}
  saving=false;if(dirty&&!timer)timer=setTimeout(flush,5000);
}
process.on("SIGTERM",async()=>{if(timer)clearTimeout(timer);dirty=true;await flush();process.exit(0)});
const isAdmin=u=>!!u&&ADMINS.includes(u.tel);
const pub=u=>({id:u.id,name:u.name,zone:u.zone,admin:isAdmin(u)});
function userOf(req){
  const m=/^Bearer ([0-9a-f]{40,})$/.exec(req.headers.authorization||"");if(!m)return null;
  const s=db.sessions[sha(m[1])];if(!s||Date.now()-s.ts>90*864e5)return null;
  return db.users.find(u=>u.id===s.uid)||null;
}
function newSession(u){const t=crypto.randomBytes(24).toString("hex");db.sessions[sha(t)]={uid:u.id,ts:Date.now()};save();return t}
const fails={};
function send(res,o,code){res.writeHead(code||200,{"Content-Type":"application/json"});res.end(JSON.stringify(o))}
function body(req,cb){let b="";req.on("data",c=>{b+=c;if(b.length>2e6)req.destroy()});req.on("end",()=>{let j={};try{j=JSON.parse(b)||{}}catch(e){}cb(j)})}
function register(j,res){
  const name=S(j.name,30).trim(),tel=norm(j.tel),pin=String(j.pin||""),zone=S(j.zone,30).trim();
  if(name.length<2)return send(res,{error:"Escribe tu nombre"},400);
  if(tel.length<7||tel.length>15)return send(res,{error:"Escribe un celular válido (solo números)"},400);
  if(!/^\d{4,6}$/.test(pin))return send(res,{error:"El PIN debe tener de 4 a 6 números"},400);
  if(zone.length<2)return send(res,{error:"Elige tu barrio"},400);
  if(db.users.some(x=>x.tel===tel))return send(res,{error:"Ese celular ya tiene cuenta. Toca Ya tengo cuenta."},409);
  const salt=crypto.randomBytes(16).toString("hex");
  const u={id:"u"+crypto.randomBytes(6).toString("hex"),name,tel,zone,salt,hash:hash(pin,salt),ts:Date.now()};
  db.users.push(u);send(res,{token:newSession(u),user:pub(u)});
}
function login(j,res){
  const tel=norm(j.tel),pin=String(j.pin||"");
  const f=fails[tel]||(fails[tel]={n:0,until:0});
  if(f.until>Date.now())return send(res,{error:"Demasiados intentos. Espera 15 minutos."},429);
  const u=db.users.find(x=>x.tel===tel);
  const ok=u&&crypto.timingSafeEqual(Buffer.from(hash(pin,u.salt),"hex"),Buffer.from(u.hash,"hex"));
  if(!ok){if(++f.n>=5){f.until=Date.now()+15*60000;f.n=0}return send(res,{error:"Celular o PIN incorrecto"},401)}
  f.n=0;send(res,{token:newSession(u),user:pub(u)});
}
function merge(inc,me){
  const key=me.zone+"|"+me.id;let made=db.items.filter(x=>x.owner===me.id&&Date.now()-x.ts<864e5).length;
  for(const it of (Array.isArray(inc)?inc:[]).slice(0,300)){
    if(!it||typeof it.id!=="string"||!S(it.title,80).trim()||db.dead.includes(it.id)||/^s\d+$/.test(it.id))continue;
    const cur=db.items.find(x=>x.id===it.id);
    if(!cur){
      const seed=/^t(\d|1\d|2[01])$/.test(it.id);
      if(!seed&&(!/^u\d{10,}$/.test(it.id)||made>=30))continue;
      if(!seed)made++;
      const lat=+it.lat,lng=+it.lng;
      db.items.push({id:it.id,type:TYPES.includes(it.type)?it.type:"serv",title:S(it.title,80),cat:S(it.cat,30),desc:S(it.desc,240),tel:norm(it.tel).slice(0,15),lat:Math.abs(lat)<=90?lat:0,lng:Math.abs(lng)<=180?lng:0,by:seed?"Vecino":me.name,owner:seed?"":me.id,zone:seed?"*":me.zone,kind:["Ofrezco","Necesito"].includes(it.kind)?it.kind:"",emerg:!!it.emerg,status:"nuevo",av:seed?(Array.isArray(it.av)?it.av:[]).filter(v=>typeof v==="string"&&!v.includes("|")).slice(0,6):[],helpers:[],ts:Date.now(),pend:false});
      continue;
    }
    if(cur.owner!==me.id&&(cur.zone==="*"||cur.zone===me.zone)&&Array.isArray(it.av)&&it.av.includes(key)&&!cur.av.includes(key)&&cur.av.length<500)cur.av.push(key);
    if(cur.owner!==me.id&&Array.isArray(it.helpers)&&it.helpers.includes(me.id)&&!cur.helpers.includes(me.id)&&cur.helpers.length<200)cur.helpers.push(me.id);
    if((me.id===cur.owner||cur.helpers.includes(me.id)||isAdmin(me))&&RK.indexOf(it.status)>RK.indexOf(cur.status||"nuevo"))cur.status=it.status;
  }
}
function remove(ids,me){
  for(const id of (Array.isArray(ids)?ids:[]).slice(0,100)){
    const i=db.items.findIndex(x=>x.id===id);
    if(i>=0&&(db.items[i].owner===me.id||isAdmin(me))){db.items.splice(i,1);db.dead.push(id)}
  }
  db.dead=db.dead.slice(-3000);
}
const visible=me=>db.items.filter(i=>!i.hidden||isAdmin(me)||i.owner===me.id);
function api(u,j,req,res){
  if(u==="/api/register")return register(j,res);
  if(u==="/api/login")return login(j,res);
  const me=userOf(req);
  if(!me)return send(res,{error:"Inicia sesión"},401);
  switch(u){
    case "/api/sync":remove(j.dels,me);merge(j.items,me);save();return send(res,{items:visible(me),alert:db.alert,me:pub(me)});
    case "/api/profile":{const z=S(j.zone,30).trim();if(z.length>=2){me.zone=z;save()}return send(res,{ok:true,user:pub(me)})}
    case "/api/logout":{const m=/^Bearer (\w+)$/.exec(req.headers.authorization||"");if(m)delete db.sessions[sha(m[1])];save();return send(res,{ok:true})}
    case "/api/subscribe":{
      const s=j.sub;
      if(s&&typeof s.endpoint==="string"&&s.endpoint.startsWith("https://")){db.subs=db.subs.filter(x=>x.endpoint!==s.endpoint).concat([{endpoint:s.endpoint,keys:s.keys,uid:me.id}]).slice(-5000);save()}
      return send(res,{ok:true})}
    case "/api/report":{
      const it=db.items.find(x=>x.id===j.id);if(!it||it.owner===me.id)return send(res,{ok:false},400);
      if(!db.reports.some(r=>r.id===it.id&&r.by===me.id))db.reports.push({id:it.id,by:me.id,reason:S(j.reason,60),ts:Date.now()});
      if(new Set(db.reports.filter(r=>r.id===it.id).map(r=>r.by)).size>=3)it.hidden=true;
      db.reports=db.reports.slice(-3000);save();return send(res,{ok:true,hidden:!!it.hidden})}
    case "/api/moderate":{
      if(!isAdmin(me))return send(res,{error:"Solo el administrador"},403);
      const it=db.items.find(x=>x.id===j.id);if(!it)return send(res,{ok:false},404);
      it.hidden=false;db.reports=db.reports.filter(r=>r.id!==it.id);save();return send(res,{ok:true})}
    case "/api/alert":{
      const now=Date.now();
      if((db.alert&&now-db.alert.ts<30000)||(me.lastAlert&&now-me.lastAlert<120000))return send(res,{ok:false,error:"Ya se envió un aviso hace instantes"});
      me.lastAlert=now;
      db.alert={id:"a"+now,owner:me.id,msg:me.name+" activó la emergencia en "+me.zone+". Abre la app para ayudar.",ts:now};save();
      if(PUSH)Promise.all(db.subs.filter(s=>s.uid!==me.id).map(s=>webpush.sendNotification(s,JSON.stringify({title:"🚨 Alerta vecinal",body:db.alert.msg})).catch(e=>{if(e.statusCode===404||e.statusCode===410)db.subs=db.subs.filter(x=>x.endpoint!==s.endpoint)}))).then(save);
      return send(res,{ok:true,push:PUSH})}
  }
  return send(res,{error:"No existe"},404);
}
function route(req,res){
  const u=req.url.split("?")[0];
  if(req.method==="GET"&&u==="/api/config")return send(res,{key:PUSH?PUBK:null,store:USE_SB?"supabase":"archivo"});
  if(req.method==="POST"&&u.startsWith("/api/"))return body(req,j=>{try{api(u,j,req,res)}catch(e){console.log("error",e);send(res,{error:"Error del servidor"},500)}});
  let p=u;if(p==="/")p="/index.html";
  const f=path.join(PUB,path.normalize(p));
  if(!f.startsWith(PUB)||!fs.existsSync(f)||fs.statSync(f).isDirectory()){res.writeHead(404);return res.end("No encontrado")}
  res.writeHead(200,{"Content-Type":MIME[path.extname(f)]||"application/octet-stream"});fs.createReadStream(f).pipe(res);
}
(async()=>{
  for(let i=1;;i++){
    try{await loadDB();break}
    catch(e){console.log("No se pudo leer la base de datos: "+e.message);if(i>=4){console.log("Me detengo para no borrar datos.");process.exit(1)}await new Promise(r=>setTimeout(r,3000))}
  }
  http.createServer(route).listen(PORT,"0.0.0.0",()=>{
    console.log("Vecino a Vecino listo (avisos push: "+(PUSH?"SI":"NO")+", datos: "+(USE_SB?"Supabase":"archivo")+", cuentas: "+db.users.length+")\n  http://localhost:"+PORT);
    for(const l of Object.values(os.networkInterfaces()))for(const a of l)if(a.family==="IPv4"&&!a.internal)console.log("  En tu red: http://"+a.address+":"+PORT);
  });
})();
