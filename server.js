// Servidor sin dependencias: node server.js  ->  http://localhost:3000
const http=require("http"),fs=require("fs"),path=require("path"),os=require("os");
const PORT=process.env.PORT||3000,DB=path.join(__dirname,"data.json"),PUB=path.join(__dirname,"public");
const TYPES={".html":"text/html; charset=utf-8",".js":"text/javascript",".json":"application/json",".svg":"image/svg+xml"};
let items=[];try{items=JSON.parse(fs.readFileSync(DB,"utf8"))}catch(e){}
const save=()=>fs.writeFileSync(DB,JSON.stringify(items,null,1));
const union=(a,b)=>[...new Set([...(a||[]),...(b||[])])];
function merge(inc){
  for(const it of inc){
    if(!it||typeof it.id!=="string"||typeof it.title!=="string")continue;
    const clean={id:it.id.slice(0,40),type:["serv","favor","sos"].includes(it.type)?it.type:"serv",title:it.title.slice(0,80),cat:String(it.cat||"").slice(0,30),desc:String(it.desc||"").slice(0,240),lat:+it.lat||0,lng:+it.lng||0,by:String(it.by||"").slice(0,30),av:union(it.av,[]).slice(0,200),helpers:union(it.helpers,[]).slice(0,200),ts:+it.ts||Date.now(),pend:false};
    const cur=items.find(x=>x.id===clean.id);
    if(cur){cur.av=union(cur.av,clean.av);cur.helpers=union(cur.helpers,clean.helpers)}else items.push(clean);
  }
  save();
}
http.createServer((req,res)=>{
  if(req.method==="POST"&&req.url.startsWith("/api/sync")){
    let b="";req.on("data",c=>{b+=c;if(b.length>2e6)req.destroy()});
    req.on("end",()=>{try{merge(JSON.parse(b).items||[])}catch(e){}res.writeHead(200,{"Content-Type":"application/json"});res.end(JSON.stringify({items}))});
    return;
  }
  let p=req.url.split("?")[0];if(p==="/")p="/index.html";
  const f=path.join(PUB,path.normalize(p));
  if(!f.startsWith(PUB)||!fs.existsSync(f)||fs.statSync(f).isDirectory()){res.writeHead(404);return res.end("No encontrado")}
  res.writeHead(200,{"Content-Type":TYPES[path.extname(f)]||"application/octet-stream"});fs.createReadStream(f).pipe(res);
}).listen(PORT,"0.0.0.0",()=>{
  console.log("Vecino a Vecino listo:\n  http://localhost:"+PORT);
  for(const l of Object.values(os.networkInterfaces()))for(const a of l)if(a.family==="IPv4"&&!a.internal)console.log("  En tu red (otros celulares): http://"+a.address+":"+PORT);
});
