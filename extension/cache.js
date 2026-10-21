// Memory-only HTTP cache owned by the extension, never Chrome's shared cache.
// Only fresh, explicitly cacheable static GET resources are eligible.
const TYPES=new Set(['Script','Stylesheet','Image','Font']);
const MAX_ENTRY=4*1024*1024,MAX_GROUP=32*1024*1024,MAX_TOTAL=128*1024*1024;
const pairs=headers=>Object.fromEntries(headers.map(h=>[h.name.toLowerCase(),String(h.value)]));
const directives=text=>String(text||'').split(',').map(s=>s.trim().toLowerCase());
const origin=url=>{try{return new URL(url).origin;}catch{return '';}};
export class GroupCache {
  constructor(){this.groups=new Map();this.bytes=0;}
  bucket(id){if(!this.groups.has(id))this.groups.set(id,{epoch:0,entries:new Map(),bytes:0,hits:0,misses:0,stores:0});return this.groups.get(id);}
  remove(bucket,key){const entry=bucket.entries.get(key);if(entry){bucket.bytes-=entry.size;this.bytes-=entry.size;bucket.entries.delete(key);}}
  invalidate(id){const b=this.bucket(id);b.epoch++;this.bytes-=b.bytes;b.bytes=0;b.entries.clear();}
  drop(id){const b=this.groups.get(id);if(b){this.bytes-=b.bytes;this.groups.delete(id);}}
  summary(id){const b=this.bucket(id);return {entries:b.entries.size,bytes:b.bytes,hits:b.hits,misses:b.misses,stores:b.stores};}
  prepare(id,url,type,method,headers,topUrl){
    if(method!=='GET'||!TYPES.has(type))return null;
    const h=pairs(headers),cc=directives(h['cache-control']);
    if(cc.some(s=>/^no-store(?:=|$)|^no-cache(?:=|$)/.test(s)||s==='max-age=0')||/no-cache/i.test(h.pragma||'')||
      Object.keys(h).some(n=>n==='range'||n.startsWith('if-')))return null;
    // Referer is checked through Vary below; include its origin in the partition.
    // All other effective headers (including Cookie/Authorization/custom ones)
    // are matched even if a server forgets to advertise Vary.
    const identity=Object.entries(h).filter(([n])=>!['referer','cache-control','pragma','priority'].includes(n)).sort(([a],[b])=>a.localeCompare(b));
    const b=this.bucket(id),key=JSON.stringify([url,type,origin(topUrl),origin(h.referer||topUrl),identity]);
    return {gid:id,key,epoch:b.epoch,headers:h,started:Date.now(),url,type};
  }
  lookup(record){
    const b=this.bucket(record.gid),entry=b.entries.get(record.key);
    if(entry&&entry.epoch===b.epoch&&entry.expires>Date.now()&&entry.vary.every(([name,value])=>(record.headers[name]||'')===value)){
      b.entries.delete(record.key);b.entries.set(record.key,entry);entry.used=Date.now();b.hits++;return entry;
    }
    if(entry&&entry.expires<=Date.now())this.remove(b,record.key);
    b.misses++;return null;
  }
  response(record,response){
    if(response.status!==200||response.url!==record.url)return null;
    const headers=Object.entries(response.headers||{}).map(([name,value])=>({name,value:String(value)})),h=pairs(headers),cc=directives(h['cache-control']);
    if(cc.some(s=>/^no-store(?:=|$)|^no-cache(?:=|$)/.test(s))||h['set-cookie']||h['clear-site-data']||h['content-range'])return null;
    const ages=cc.filter(s=>s.startsWith('max-age='));
    if(ages.length!==1||!/^max-age=\s*"?\d+"?$/.test(ages[0]))return null;
    const maxAge=ages[0];
    const age=Math.max(Number(h.age||0)*1000,Number.isFinite(Date.parse(h.date))?Math.max(0,Date.now()-Date.parse(h.date)):0);
    const ttl=Math.min(3600000,Number(maxAge.match(/\d+/)[0])*1000-age);
    if(!(ttl>0))return null;
    const vary=(h.vary||'').split(',').map(n=>n.trim().toLowerCase()).filter(Boolean);
    if(vary.includes('*'))return null;
    const length=Number(h['content-length']);if(Number.isFinite(length)&&length>MAX_ENTRY)return null;
    // Avoid reconstructing legacy text encodings as UTF-8.
    const charset=(h['content-type']||'').match(/charset\s*=\s*["']?([^;"'\s]+)/i)?.[1]?.toLowerCase();
    if(charset&&!['utf-8','utf8','us-ascii','ascii'].includes(charset))return null;
    return {headers,charset,expires:Date.now()+ttl,vary:vary.map(n=>[n,record.headers[n]||''])};
  }
  store(record,policy,result){
    const b=this.bucket(record.gid);
    if(b.epoch!==record.epoch||policy.expires<=Date.now())return false;
    let body,size;
    if(result.base64Encoded){body=result.body;size=Math.ceil(body.length*3/4);}
    else{
      if(!policy.charset&&/[^\x00-\x7f]/.test(result.body)||result.body.includes('\ufffd'))return false;
      const bytes=new TextEncoder().encode(result.body);size=bytes.length;
      if(size>MAX_ENTRY)return false;
      let binary='';for(let i=0;i<bytes.length;i+=32768)binary+=String.fromCharCode(...bytes.subarray(i,i+32768));body=btoa(binary);
    }
    if(size>MAX_ENTRY)return false;
    const ignored=new Set(['content-encoding','content-length','transfer-encoding','connection','set-cookie','set-cookie2','clear-site-data','cache-control','age','vary']);
    const headers=policy.headers.filter(h=>!ignored.has(h.name.toLowerCase()));
    // Synthetic hits must not populate the ordinary Profile's cache either.
    headers.push({name:'Cache-Control',value:'no-store'},{name:'Vary',value:'*'});
    this.remove(b,record.key);
    b.entries.set(record.key,{epoch:b.epoch,headers,body,size,expires:policy.expires,vary:policy.vary,used:Date.now()});b.bytes+=size;this.bytes+=size;b.stores++;
    while(b.bytes>MAX_GROUP||b.entries.size>512)this.remove(b,b.entries.keys().next().value);
    while(this.bytes>MAX_TOTAL){
      let oldest;
      for(const group of this.groups.values()){const first=group.entries.entries().next().value;if(first&&(!oldest||first[1].used<oldest.entry.used))oldest={group,key:first[0],entry:first[1]};}
      if(!oldest)break;this.remove(oldest.group,oldest.key);
    }
    return b.entries.has(record.key);
  }
}
