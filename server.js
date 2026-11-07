// node server.js -> http://localhost:3000   (web-push es opcional: sin llaves VAPID solo hay avisos con la app abierta)
const http=require("http"),fs=require("fs"),path=require("path"),os=require("os");
let webpush=null;try{webpush=require("web-push")}catch(e){}
const PUBK=process.env.VAPID_PUBLIC_KEY||"",PRIVK=process.env.VAPID_PRIVATE_KEY||"";
const PUSH=!!(webpush&&PUBK&&PRIVK);
if(PUSH)webpush.setVapidDetails(process.env.VAPID_SUBJECT||"mailto:vecinos@example.com",PUBK,PRIVK);
const PORT=process.env.PORT||3000,DB=path.join(__dirname,"data.json"),PUB=path.join(__dirname,"public");
const TYPES={".html":"text/html; charset=utf-8",".js":"text/javascript",".json":"application/json",".svg":"image/svg+xml"};
let db={items:[],subs:[],dead:[],alert:null,};
try{const j=JSON.parse(fs.readFileSync(DB,"utf8"));db=Object.assign(db,Array.isArray(j)?{items:j}:j)}catch(e){}
const save=()=>{try{fs.writeFileSync(DB,JSON.stringify(db))}catch(e){}};
const union=(a,b)=>[...new Set([...(a||[]),...(b||[])])];
const S=(v,n)=>String(v==null?"":v).slice(0,n);
function merge(inc){
  for(const it of inc){
    if(!it||typeof it.id!=="string"||typeof it.title!=="string"||db.dead.includes(it.id))continue;
    const c={id:S(it.id,40),type:["serv","favor","sos"].includes(it.type)?it.type:"serv",title:S(it.title,80),cat:S(it.cat,30),desc:S(it.desc,240),tel:S(it.tel,20),lat:+it.lat||0,lng:+it.lng||0,by:S(it.by,30),owner:S(it.owner,30),av:union(it.av,[]).slice(0,200),helpers:union(it.helpers,[]).slice(0,200),ts:+it.ts||Date.now(),pend:false};
    const cur=db.items.find(x=>x.id===c.id);
    if(cur){cur.av=union(cur.av,c.av);cur.helpers=union(cur.helpers,c.helpers)}else db.items.push(c);
  }
}
function remove(ids,owner){
  for(const id of ids||[]){
    const i=db.items.findIndex(x=>x.id===id);
    if(i>=0&&db.items[i].owner&&db.items[i].owner===owner){db.items.splice(i,1);db.dead.push(id)}
    else if(i<0&&!db.dead.includes(id))db.dead.push(id);
  }
  db.dead=db.dead.slice(-2000);
}
function send(res,o){res.writeHead(200,{"Content-Type":"application/json"});res.end(JSON.stringify(o))}
function body(req,cb){let b="";req.on("data",c=>{b+=c;if(b.length>2e6)req.destroy()});req.on("end",()=>{let j={};try{j=JSON.parse(b)}catch(e){}cb(j)})}
http.createServer((req,res)=>{
  const u=req.url.split("?")[0];
  if(req.method==="GET"&&u==="/api/config")return send(res,{key:PUSH?PUBK:null});
  if(req.method==="POST"&&u==="/api/sync")return body(req,j=>{remove(j.dels,S(j.owner,30));merge(j.items||[]);save();send(res,{items:db.items,alert:db.alert})});
  if(req.method==="POST"&&u==="/api/subscribe")return body(req,j=>{
    const s=j.sub;if(s&&typeof s.endpoint==="string"&&s.endpoint.startsWith("https://")){db.subs=db.subs.filter(x=>x.endpoint!==s.endpoint).concat([s]).slice(-5000);save()}
    send(res,{ok:true})});
  if(req.method==="POST"&&u==="/api/alert")return body(req,a=>{
    if(db.alert&&Date.now()-db.alert.ts<30000)return send(res,{ok:false});
    db.alert={id:S(a.id,40),owner:S(a.owner,30),msg:S(a.msg,160),ts:Date.now()};save();
    if(PUSH)Promise.all(db.subs.map(s=>webpush.sendNotification(s,JSON.stringify({title:"🚨 Alerta vecinal",body:db.alert.msg})).catch(e=>{if(e.statusCode===404||e.statusCode===410)db.subs=db.subs.filter(x=>x.endpoint!==s.endpoint)}))).then(save);
    send(res,{ok:true,push:PUSH})});
  let p=u;if(p==="/")p="/index.html";
  const f=path.join(PUB,path.normalize(p));
  if(!f.startsWith(PUB)||!fs.existsSync(f)||fs.statSync(f).isDirectory()){res.writeHead(404);return res.end("No encontrado")}
  res.writeHead(200,{"Content-Type":TYPES[path.extname(f)]||"application/octet-stream"});fs.createReadStream(f).pipe(res);
}).listen(PORT,"0.0.0.0",()=>{
  console.log("Vecino a Vecino listo (avisos push: "+(PUSH?"SI":"NO")+")\n  http://localhost:"+PORT);
  for(const l of Object.values(os.networkInterfaces()))for(const a of l)if(a.family==="IPv4"&&!a.internal)console.log("  En tu red: http://"+a.address+":"+PORT);
});
