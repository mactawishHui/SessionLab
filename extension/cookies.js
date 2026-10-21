export function domainMatches(host, domain) {
  domain=domain.replace(/^\./,'').toLowerCase();
  return host===domain||host.endsWith('.'+domain);
}
const indexes=new WeakMap();
const cookieKey=c=>[c.name,c.domain.replace(/^\./,''),c.path||'/',JSON.stringify(c.partitionKey||null)].join('|');
function index(jar){
  let value=indexes.get(jar);if(value)return value;
  value={domains:new Map(),keys:new Map(),order:new Map(),next:0};
  for(const c of jar){const domain=c.domain.replace(/^\./,'').toLowerCase();
    if(!value.domains.has(domain))value.domains.set(domain,[]);
    value.domains.get(domain).push(c);value.keys.set(cookieKey(c),c);value.order.set(c,value.next++);
  }
  indexes.set(jar,value);return value;
}
function candidates(jar,hostname){
  const lookup=index(jar),buckets=lookup.domains,result=[];let domain=hostname;
  for(;;){if(buckets.has(domain))result.push(...buckets.get(domain));const dot=domain.indexOf('.');if(dot<0)break;domain=domain.slice(dot+1);}
  return result.sort((a,b)=>lookup.order.get(a)-lookup.order.get(b));
}
export function matches(cookie,url) {
  const u=typeof url==='string'?new URL(url):url, path=cookie.path||'/';
  if(cookie.expirationDate&&cookie.expirationDate<=Date.now()/1000)return false;
  if(cookie.secure&&u.protocol!=='https:')return false;
  if(cookie.hostOnly?u.hostname!==cookie.domain:!domainMatches(u.hostname,cookie.domain))return false;
  return u.pathname===path||u.pathname.startsWith(path.endsWith('/')?path:path+'/');
}
export function visibleCookies(jar,url) {
  const target=new URL(url);
  return candidates(jar,target.hostname).filter(c=>!c.httpOnly&&matches(c,target));
}
export function header(jar,url,topUrl,topNavigation,method) {
  const top=new URL(topUrl), target=new URL(url);
  return candidates(jar,target.hostname).filter(c=>{
    if(!matches(c,target))return false;
    if(c.partitionKey?.topLevelSite){
      const key=new URL(c.partitionKey.topLevelSite);
      if(key.protocol!==top.protocol||!domainMatches(top.hostname,key.hostname))return false;
    }
    // Conservative same-site handling: do not broaden an imported cookie's scope.
    const sameSite=top.protocol===target.protocol&&domainMatches(top.hostname,c.domain);
    if(c.sameSite==='strict'&&!sameSite)return false;
    if(c.sameSite!=='no_restriction'&&!sameSite&&!(topNavigation&&['GET','HEAD'].includes(method)))return false;
    return true;
  }).sort((a,b)=>(b.path||'/').length-(a.path||'/').length)
    .map(c=>c.name+'='+c.value).join('; ');
}
export function put(jar,cookie) {
  const lookup=index(jar),key=cookieKey(cookie),old=lookup.keys.get(key);
  const alive=!cookie.expirationDate||cookie.expirationDate>Date.now()/1000;
  if(old&&alive&&old.value===cookie.value&&!!old.hostOnly===!!cookie.hostOnly&&!!old.secure===!!cookie.secure&&!!old.httpOnly===!!cookie.httpOnly&&old.expirationDate===cookie.expirationDate&&old.sameSite===cookie.sameSite)return false;
  if(!old&&!alive)return false;
  if(old){const at=jar.indexOf(old);if(at>=0)jar.splice(at,1);lookup.order.delete(old);}
  const domain=cookie.domain.replace(/^\./,'').toLowerCase();
  const bucket=(lookup.domains.get(domain)||[]).filter(c=>cookieKey(c)!==key);
  lookup.keys.delete(key);
  if(alive){jar.push(cookie);bucket.push(cookie);lookup.keys.set(key,cookie);lookup.order.set(cookie,lookup.next++);}
  lookup.domains.set(domain,bucket);
  return true;
}
export function parse(text,url,fromScript=false) {
  const u=new URL(url), parts=String(text).split(';'), first=parts.shift(),eq=first.indexOf('=');
  if(eq<=0)return null;
  const c={name:first.slice(0,eq).trim(),value:first.slice(eq+1).trim(),domain:u.hostname,hostOnly:true,
    path:u.pathname.slice(0,u.pathname.lastIndexOf('/'))||'/',secure:false,httpOnly:false,sameSite:'lax'};
  let maxAge;
  for(const part of parts){const i=part.indexOf('='),k=(i<0?part:part.slice(0,i)).trim().toLowerCase(),v=(i<0?'':part.slice(i+1)).trim();
    if(k==='domain'){if(!domainMatches(u.hostname,v))return null;c.domain=v.replace(/^\./,'');c.hostOnly=false;}
    if(k==='path'&&v.startsWith('/'))c.path=v;
    if(k==='secure')c.secure=true;
    if(k==='httponly')c.httpOnly=true;
    if(k==='samesite')c.sameSite=({none:'no_restriction',strict:'strict',lax:'lax'})[v.toLowerCase()]||'lax';
    if(k==='max-age'&&/^-?\d+$/.test(v))maxAge=Number(v);
    if(k==='expires'&&Number.isFinite(Date.parse(v)))c.expirationDate=Date.parse(v)/1000;
    if(k==='partitioned')return null; // Unsupported CHIPS writes must not become unpartitioned cookies.
  }
  if(maxAge!==undefined)c.expirationDate=Date.now()/1000+maxAge;
  if(fromScript&&c.httpOnly)return null;
  if(c.secure&&u.protocol!=='https:')return null;
  if(c.sameSite==='no_restriction'&&!c.secure)return null;
  if(c.name.startsWith('__Secure-')&&!c.secure)return null;
  if(c.name.startsWith('__Host-')&&(!c.secure||!c.hostOnly||c.path!=='/'))return null;
  return c;
}
