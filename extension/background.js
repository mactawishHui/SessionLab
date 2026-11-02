import {lifecycle,migrate,groupTitle,http} from './lifecycle.js';
import {header,parse,put,visibleCookies,expired} from './cookies.js';
import {isolate} from './isolate.js';
import {normalizeHeaders,applyHeaders} from './headers.js';
import {GroupCache} from './cache.js';
import {RuleBatcher} from './rules.js';
import {base64} from './bytes.js';
import {anonymousResource,documentResources} from './credentials.js';
const fetchRules=new RuleBatcher(change=>chrome.declarativeNetRequest.updateSessionRules(change));

const bindings=new Map(),groups=new Map(),queues=new Map();
const groupLinks=new Map(),moving=new Set(),initializing=new Set();
const popupTabs=new Map();
const resourceCache=new GroupCache(),networkRecords=new Map(),requestOwners=new Map(),wireOwners=new Map();
const timings=new Map();
function timed(gid,stage,start){
  let group=timings.get(gid);if(!group)timings.set(gid,group={});
  const row=group[stage]??={count:0,totalMs:0,maxMs:0,slow:0},ms=performance.now()-start;
  row.count++;row.totalMs+=ms;row.maxMs=Math.max(row.maxMs,ms);if(ms>100)row.slow++;
}
function timingSummary(gid){return Object.fromEntries(Object.entries(timings.get(gid)||{}).map(([k,v])=>[k,{count:v.count,totalMs:Math.round(v.totalMs),maxMs:Math.round(v.maxMs),averageMs:Math.round(v.totalMs/v.count),slow:v.slow}]));}
const proxyJobs=new Map(),proxyQueues=new Map();let proxyRule=1000000000;
const requestUrl=value=>{const u=new URL(value);u.hash='';return u.href;};
function proxyResponse(job,value){job.response=value;job.resolve?.();}
const endpoint=chrome.runtime.getURL('popup.html');
let lastError='';
function reportError(error){
  const closed=/No tab with given id\s+(\d+)/.exec(error.message||'');
  if(closed&&!bindings.has(Number(closed[1])))return;
  lastError=error.message;
}
const ready=(async()=>{
  const saved=await chrome.storage.local.get('nativeGroups');
  let removedExpired=false;
  for(const g of saved.nativeGroups||[]){
    migrate(g);
    const live=g.cookies.filter(c=>!expired(c));
    if(live.length!==g.cookies.length){g.cookies=live;removedExpired=true;}
    groups.set(g.id,g);
  }
  // Repair persisted deletion cookies from earlier versions without touching
  // valid login cookies, ordinary Profile storage, or other group settings.
  if(removedExpired)await chrome.storage.local.set({nativeGroups:[...groups.values()]});
  const state=await chrome.storage.session.get(['nativeBindings','nativeGroupLinks']);
  for(const [id,gid] of Object.entries(state.nativeGroupLinks||{}))groupLinks.set(Number(id),gid);
  for(const [id,b] of Object.entries(state.nativeBindings||{}))bindings.set(Number(id),{...b,contexts:new Map(),scripts:new Map()});
  // Real Chrome tab IDs can also exceed one billion. Identify our temporary
  // fetch rules by their initiator, never by a numeric ID threshold alone.
  const stale=(await chrome.declarativeNetRequest.getSessionRules()).filter(r=>r.condition.initiatorDomains?.includes(chrome.runtime.id)||(r.action.type==='allow'&&r.priority===10)).map(r=>r.id);
  if(stale.length)await chrome.declarativeNetRequest.updateSessionRules({removeRuleIds:stale});
  const attached=new Set((await chrome.debugger.getTargets()).filter(t=>t.attached&&t.tabId).map(t=>t.tabId));
  const live=new Set((await chrome.tabs.query({})).map(t=>t.id));
  for(const id of bindings.keys())if(!live.has(id)||!attached.has(id))bindings.delete(id);
  await life.start();
  await saveBindings();
})();
const life=lifecycle({groups,bindings,groupLinks,moving,initializing,persist,schedulePersist,saveBindings,guard,configure,command,open,moveIntoGroup,reportError,ready:()=>ready});
let diskWrites=Promise.resolve(),saveTimer=null;
const dirtyGroups=new Set();
function schedulePersist(gid){
  dirtyGroups.add(gid);
  if(!saveTimer)saveTimer=setTimeout(()=>{saveTimer=null;void persist().catch(error=>{reportError(error);});},25);
}
async function persist(){
  life.syncSnapshots();
  if(saveTimer){clearTimeout(saveTimer);saveTimer=null;}
  const dirty=[...dirtyGroups];dirtyGroups.clear();const started=performance.now();
  const write=diskWrites.then(()=>chrome.storage.local.set({nativeGroups:[...groups.values()]}));
  diskWrites=write.catch(()=>{});await write;
  for(const gid of dirty)timed(gid,'persist',started);
}
async function saveBindings(){await chrome.storage.session.set({nativeBindings:Object.fromEntries([...bindings].map(([id,b])=>[id,{gid:b.gid,topUrl:b.topUrl,frameId:b.frameId,pageKey:b.pageKey}])),nativeGroupLinks:Object.fromEntries(groupLinks)});}
async function guard(tabId,stop=false){
  await chrome.declarativeNetRequest.updateSessionRules({removeRuleIds:[tabId],addRules:[{id:tabId,priority:100,
    action:stop?{type:'block'}:{type:'modifyHeaders',requestHeaders:[{header:'cache-control',operation:'set',value:'no-cache, no-store'}],responseHeaders:[{header:'set-cookie',operation:'remove'},{header:'clear-site-data',operation:'remove'},
      {header:'cache-control',operation:'set',value:'no-store'},{header:'vary',operation:'set',value:'*'}]},condition:{tabIds:[tabId],urlFilter:'|http',
      // DNR's omitted resourceTypes excludes main_frame. Login redirects and
      // document responses must be protected just like fetch/XHR responses.
      resourceTypes:[...(stop==='prepare'?[]:['main_frame']),'sub_frame','stylesheet','script','image','font','object','xmlhttprequest','ping','csp_report','media','websocket','other']}}]});
}
chrome.webRequest.onBeforeRequest.addListener(details=>{const b=bindings.get(details.tabId);if(b)wireOwners.set(details.requestId,b);},{urls:['http://*/*','https://*/*']});
const releaseWire=details=>wireOwners.delete(details.requestId);
chrome.webRequest.onCompleted.addListener(releaseWire,{urls:['http://*/*','https://*/*']});
chrome.webRequest.onErrorOccurred.addListener(releaseWire,{urls:['http://*/*','https://*/*']});
chrome.webRequest.onHeadersReceived.addListener(details=>{
  const proxy=proxyJobs.get(requestUrl(details.url));
  if(proxy&&details.initiator===chrome.runtime.getURL('').replace(/\/$/,'')){
    proxyResponse(proxy,{status:details.statusCode,url:details.url,headers:details.responseHeaders||[]});return;
  }
  const b=wireOwners.get(details.requestId);if(!b||!groups.has(b.gid))return;
  const headers=(details.responseHeaders||[]).filter(h=>h.name.toLowerCase()==='set-cookie');
  const clear=(details.responseHeaders||[]).some(h=>h.name.toLowerCase()==='clear-site-data');
  if(!headers.length&&!clear)return;
  resourceCache.invalidate(b.gid);
  if(!headers.length)return;
  enqueue(b.gid,async()=>{
    const g=groups.get(b.gid);
    for(const h of headers){const cookie=parse(h.value,details.url);if(cookie)put(g.cookies,cookie);}
    schedulePersist(g.id);await broadcast(g.id,{op:'cookies',cookies:g.cookies});
  }).catch(()=>{});
},{urls:['http://*/*','https://*/*']},['responseHeaders','extraHeaders']);
chrome.webRequest.onBeforeRedirect.addListener(details=>{
  const proxy=proxyJobs.get(requestUrl(details.url));
  if(!proxy||details.initiator!==chrome.runtime.getURL('').replace(/\/$/,''))return;
  // HSTS/extension redirects have no wire response and can skip
  // onHeadersReceived. fetch(redirect: manual) exposes only status 0 for them.
  // Capture the redirect target here and replay it as a native redirect, so the
  // next URL is handled with its own group Cookie/Header rule.
  // The redirect event may expose headers after our Cookie-removal rule. Keep
  // the earlier wire headers so Set-Cookie still updates this group's jar.
  const headers=(proxy.response?.headers||details.responseHeaders||[]).filter(h=>h.name.toLowerCase()!=='location');
  headers.push({name:'Location',value:details.redirectUrl});
  proxyResponse(proxy,{status:details.statusCode>=300&&details.statusCode<400?details.statusCode:307,url:details.url,headers});
},{urls:['http://*/*','https://*/*']},['responseHeaders','extraHeaders']);
const pending=new Map(),trace=[];
async function command(source,method,params={}){
  const id=crypto.randomUUID();pending.set(id,method);
  try{return await chrome.debugger.sendCommand(source,method,params);}
  catch(error){
    // Navigation/reload can cancel a paused request before its queued continuation.
    // Only ignore this expired request ID; other interception errors remain visible.
    if(/^Fetch\.(continueRequest|continueResponse|fulfillRequest|failRequest)$/.test(method)&&/Invalid InterceptionId/.test(error.message))return {};
    throw error;
  }finally{pending.delete(id);}
}
const sourceKey=source=>source.sessionId||'root';
const networkKey=(source,id)=>source.tabId+':'+sourceKey(source)+':'+id;
function enqueue(gid,fn){const task=(queues.get(gid)||Promise.resolve()).then(fn);queues.set(gid,task.catch(error=>{reportError(error);}));return task;}
function publicGroup(g){return{id:g.id,name:g.name,url:g.url,homeUrl:g.homeUrl,history:g.history.map(({session,...h})=>h),windowTabs:(g.closedWindowTabs.length?g.closedWindowTabs:g.windowTabs).map(({session,...p})=>p),headers:g.headers?normalizeHeaders(g.headers):{rules:[]},performance:timingSummary(g.id),cache:{...resourceCache.summary(g.id),inFlightChanges:[...networkRecords.values()].filter(r=>r.gid===g.id&&r.unsafe).length},tabs:[...bindings].filter(([,b])=>b.gid===g.id).map(([id])=>id)};}
async function script(source,b){
  const result=await command(source,'Page.addScriptToEvaluateOnNewDocument',{source:'debugger;\n//# sourceURL=session-lab-initialize.js'});
  b.scripts.set(sourceKey(source),result.identifier);
}
async function configure(source,b){
  await command(source,'Runtime.enable');
  await command(source,'Runtime.addBinding',{name:'__sessionLabBinding'});
  await command(source,'Debugger.enable');
  await command(source,'Page.enable');
  await command(source,'Network.enable');
  await command(source,'Network.setCacheDisabled',{cacheDisabled:true});
  await command(source,'Network.setBypassServiceWorker',{bypass:true});
  await script(source,b);
  // Native cache bypass prevents reads but can still write upstream responses.
  // Documents/static/range GET/HEAD use an extension no-store fetch below.
  // Regular APIs stay native with explicit read/write cache exclusion.
  // Native pages always render the original response bytes.
  await command(source,'Fetch.enable',{patterns:[{urlPattern:'http*',requestStage:'Request'},{urlPattern:'http*',requestStage:'Response'}]});
  await command(source,'Target.setAutoAttach',{autoAttach:true,waitForDebuggerOnStart:true,flatten:true,filter:[{type:'iframe',exclude:false},{exclude:true}]});
}
async function broadcast(gid,change,exclude){
  const jobs=[];
  for(const [tabId,b] of bindings){if(b.gid!==gid)continue;
    for(const [key,c] of b.contexts){if(key===exclude||!/^https?:/.test(c.url||c.origin))continue;
      const value=change.op==='cookies'?{op:'cookies',cookies:visibleCookies(change.cookies,c.url||c.origin+'/')}:change;
      jobs.push(command({tabId,...(c.sessionId?{sessionId:c.sessionId}:{})},'Runtime.evaluate',{
        contextId:c.id,expression:'window.__sessionLabUpdate?.('+JSON.stringify(value)+')'}).catch(()=>{}));
    }
  }
  // A page may be waiting for a synchronous XHR whose response is queued here.
  // Its JS cannot run until we release the network response. Never make the
  // network queue wait for page-side notifications; CDP preserves their order.
  void Promise.all(jobs);
}
async function pause(source,p,b,anonymous=false){
  if(bindings.get(source.tabId)!==b){await command(source,'Fetch.failRequest',{requestId:p.requestId,errorReason:'Aborted'}).catch(()=>{});return;}
  const g=groups.get(b.gid);
  if(p.responseStatusCode!==undefined||p.responseErrorReason){
    const record=p.networkId&&networkRecords.get(networkKey(source,p.networkId));
    let changed=false;
    for(const h of p.responseHeaders||[])if(h.name.toLowerCase()==='set-cookie'){
      const cookie=parse(h.value,p.request.url);if(cookie){put(g.cookies,cookie);changed=true;}
    }
    if(changed||(p.responseHeaders||[]).some(h=>h.name.toLowerCase()==='clear-site-data'))resourceCache.invalidate(g.id);
    if(changed){schedulePersist(g.id);await broadcast(g.id,{op:'cookies',cookies:g.cookies});}
    // Complete mutations at the intercepted response boundary, before page JS
    // observes success. Some intercepted/redirected fetches have no matching
    // Network.loadingFinished event on supported Chrome versions.
    if(record?.unsafe||(p.responseStatusCode>=300&&p.responseStatusCode<400&&record)){
      if(record.unsafe)resourceCache.invalidate(record.gid);
      networkRecords.delete(networkKey(source,p.networkId));
    }
    if(p.responseStatusCode!==undefined){
      const headers=(p.responseHeaders||[]).filter(h=>!['cache-control','expires','pragma','vary','set-cookie','set-cookie2','clear-site-data'].includes(h.name.toLowerCase()));
      headers.push({name:'Cache-Control',value:'no-store'},{name:'Vary',value:'*'});
      await command(source,'Fetch.continueResponse',{requestId:p.requestId,responseCode:p.responseStatusCode,
        ...(p.responseStatusText?{responsePhrase:p.responseStatusText}:{}),responseHeaders:headers});
    }else await command(source,'Fetch.continueResponse',{requestId:p.requestId});
    return;
  }
  const top=p.resourceType==='Document'&&p.frameId===b.frameId&&!source.sessionId;
  const navigation=top&&b.navigation?.url===p.request.url?b.navigation:null;
  if(navigation)delete b.navigation;
  if(top)g.url=p.request.url;
  const headers=Object.entries(p.request.headers).filter(([name])=>name.toLowerCase()!=='cookie').map(([name,value])=>({name,value:String(value)}));
  const cookie=anonymous?'':header(g.cookies,p.request.url,b.topUrl||g.url,top,navigation?.method||p.request.method);
  // Empty Cookie explicitly suppresses Chrome's default jar on the initial navigation too.
  headers.push({name:'Cookie',value:cookie});
  if(navigation){
    for(let i=headers.length-1;i>=0;i--)if(['content-type','content-length','origin','referer'].includes(headers[i].name.toLowerCase()))headers.splice(i,1);
    headers.push({name:'Content-Type',value:navigation.contentType},{name:'Origin',value:navigation.origin},{name:'Referer',value:navigation.referrer});
  }
  const effective=applyHeaders(headers,g.headers),method=navigation?.method||p.request.method;
  const unsafe=!['GET','HEAD','OPTIONS'].includes(method);
  if(unsafe)resourceCache.invalidate(g.id);
  const candidate=resourceCache.prepare(g.id,p.request.url,p.resourceType,method,effective,b.topUrl||g.url);
  // A full-range request with a fresh, non-matching validator requests the
  // entire representation (RFC 9110 13.1.5). Chromium treats If-Range as
  // LOAD_DISABLE_CACHE, preventing both reads AND writes even with DevTools'
  // cache toggle enabled. Preserve application-specified range conditions.
  const nativeApi=['XHR','Fetch'].includes(p.resourceType)&&['GET','HEAD'].includes(method)&&!effective.some(h=>['range','if-range'].includes(h.name.toLowerCase()));
  const entry=!nativeApi&&candidate&&resourceCache.lookup(candidate);
  if(entry){
    try{await command(source,'Fetch.fulfillRequest',{requestId:p.requestId,responseCode:200,responseHeaders:entry.headers,body:entry.body});return;}
    catch{/* Cache delivery is optional: fall back to the isolated network path. */}
  }
  if(['GET','HEAD'].includes(method)&&!nativeApi){
    // Release the group queue while the network is in flight; independent
    // assets load in parallel. Response state is committed back on that queue.
    void networkResource(source,p,g,effective,candidate,anonymous,b).catch(async error=>{
      if(!bindings.has(source.tabId))return;
      reportError(error);
      await command(source,'Fetch.failRequest',{requestId:p.requestId,errorReason:'BlockedByClient'}).catch(()=>{});
    });return;
  }
  if(p.networkId&&unsafe){
    const key=networkKey(source,p.networkId);
    networkRecords.set(key,{gid:g.id,unsafe,started:Date.now()});
    for(const[k,v]of networkRecords)if(Date.now()-v.started>90000||networkRecords.size>4096)networkRecords.delete(k);
  }
  const networkHeaders=effective.filter(h=>h.name.toLowerCase()!=='cache-control');
  networkHeaders.push({name:'Cache-Control',value:'no-cache, no-store'});
  if(nativeApi)networkHeaders.push({name:'Range',value:'bytes=0-'},{name:'If-Range',value:'"session-lab-'+crypto.randomUUID()+'"'});
  await command(source,'Fetch.continueRequest',{requestId:p.requestId,headers:networkHeaders,...(navigation?{method:'POST',postData:navigation.postData}:{})});
}
async function networkResource(source,p,g,effective,candidate,anonymous=false,owner){
  const entered=performance.now();
  const url=requestUrl(p.request.url),previous=proxyQueues.get(url)||Promise.resolve();
  const task=previous.catch(()=>{}).then(async()=>{
    timed(g.id,'sameUrlQueue',entered);
    const id=proxyRule++,job={};job.ready=new Promise(resolve=>{job.resolve=resolve;});proxyJobs.set(url,job);
    const wanted=new Map(effective.map(h=>[h.name.toLowerCase(),h.value]));
    wanted.set('cache-control','no-cache, no-store');
    const requestHeaders=[...wanted].filter(([name])=>!['host','content-length','connection','accept-encoding'].includes(name))
      .map(([header,value])=>({header,operation:'set',value}));
    for(const header of ['origin','referer'])if(!wanted.has(header))requestHeaders.push({header,operation:'remove'});
    try{
      let phase=performance.now();
      await fetchRules.submit({addRules:[{id,priority:200,
        condition:{regexFilter:'^'+url.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'$',initiatorDomains:[chrome.runtime.id],resourceTypes:['xmlhttprequest']},
        action:{type:'modifyHeaders',requestHeaders,responseHeaders:[{header:'set-cookie',operation:'remove'},{header:'clear-site-data',operation:'remove'}]}}]});
      timed(g.id,'ruleInstall',phase);phase=performance.now();
      const response=await fetch(url,{method:p.request.method,cache:'no-store',credentials:'omit',redirect:'manual',signal:AbortSignal.timeout(45000)});
      timed(g.id,'networkHeaders',phase);phase=performance.now();
      if(!job.response)await new Promise(resolve=>{
        const timer=setTimeout(resolve,1500);
        job.ready.then(()=>{clearTimeout(timer);resolve();});
      });
      timed(g.id,'responseMetadata',phase);phase=performance.now();
      // A readable fetch response is authoritative even when another installed
      // extension bypasses onHeadersReceived for a synthetic/CDN response.
      // Opaque redirects require the raw event to preserve their target safely.
      const raw=job.response||(response.status?{status:response.status,url,
        headers:[...response.headers].map(([name,value])=>({name,value}))}:null);
      if(!raw)throw Error('无法确认资源原始响应（'+new URL(url).hostname+'），已阻止共享缓存回退');
      const headers=raw.headers.map(h=>({name:h.name,value:String(h.value||'')}));
      const type=headers.find(h=>h.name.toLowerCase()==='content-type')?.value||'';
      if(/text\/event-stream/i.test(type)){await response.body?.cancel();throw Error('当前隔离缓存版本暂不支持 SSE 流式响应');}
      const chunks=[];let size=0;const reader=response.body?.getReader();
      if(reader)for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;
        if(size>32*1024*1024){await reader.cancel();throw Error('资源超过 32 MiB，已阻止不隔离的缓存回退');}chunks.push(value);}
      timed(g.id,'responseBody',phase);phase=performance.now();
      const current=()=>!life.isHalted(source.tabId)&&bindings.get(source.tabId)===owner&&(p.resourceType!=='Document'||owner.documentRequests?.get(networkKey(source,p.frameId))===p.requestId);
      if(current())documentResources(source,p,owner,chunks,type,raw.status);
      const body=base64(chunks,size);
      timed(g.id,'base64',phase);const queued=performance.now();let delivery;
      await enqueue(g.id,async()=>{
      timed(g.id,'responseQueue',queued);
      let changed=false;
      for(const h of headers)if(!anonymous&&h.name.toLowerCase()==='set-cookie'){
        const cookie=parse(h.value,url);if(cookie){put(g.cookies,cookie);changed=true;}
      }
      if(changed||headers.some(h=>h.name.toLowerCase()==='clear-site-data'))resourceCache.invalidate(g.id);
      if(changed){schedulePersist(g.id);await broadcast(g.id,{op:'cookies',cookies:g.cookies});}
      const policy=candidate&&resourceCache.response(candidate,{status:raw.status,url,headers:Object.fromEntries(headers.map(h=>[h.name,h.value]))});
      if(policy&&groups.has(g.id))resourceCache.store(candidate,policy,{body,base64Encoded:true});
      const ignored=new Set(['content-encoding','content-length','transfer-encoding','connection','set-cookie','set-cookie2','clear-site-data','cache-control','vary']);
      const output=headers.filter(h=>!ignored.has(h.name.toLowerCase()));output.push({name:'Cache-Control',value:'no-store'},{name:'Vary',value:'*'});
      if(!current()){delivery=command(source,'Fetch.failRequest',{requestId:p.requestId,errorReason:'Aborted'}).catch(()=>{});return;}
      const deliver=performance.now();delivery=command(source,'Fetch.fulfillRequest',{requestId:p.requestId,responseCode:raw.status,responseHeaders:output,body}).then(()=>timed(g.id,'deliver',deliver));
      });
      await delivery;
    }finally{
      proxyJobs.delete(url);const cleanup=performance.now();await fetchRules.submit({removeRuleIds:[id]}).catch(()=>{});timed(g.id,'ruleRemove',cleanup);timed(g.id,'total',entered);
    }
  });
  proxyQueues.set(url,task);try{await task;}finally{if(proxyQueues.get(url)===task)proxyQueues.delete(url);}
}
async function binding(source,p,b){
  if(p.name!=='__sessionLabBinding')return;
  const context=b.contexts.get(source.tabId+':'+sourceKey(source)+':'+p.executionContextId);
  if(!context)return;
  const data=JSON.parse(p.payload),g=groups.get(b.gid),url=new URL(data.url);
  if(context.origin!==url.origin||!['http:','https:'].includes(url.protocol))return;
  context.url=url.href;
  if(data.op==='ready')return;
  if(data.op.startsWith('popup-')){
    const key=source.tabId+':'+sourceKey(source)+':'+p.executionContextId+':'+data.token;
    const destination=()=>{
      const target=new URL(data.target,url.href);
      if(!['http:','https:'].includes(target.protocol)&&target.href!=='about:blank')throw Error('不支持此新标签页协议');
      return target.href;
    };
    if(data.op==='popup-open'){
      if(popupTabs.has(key))return;
      const opener=await chrome.tabs.get(source.tabId);
      const result=await open(b.gid,opener.windowId,destination(),source.tabId);
      popupTabs.set(key,result.tabId);return;
    }
    const tabId=popupTabs.get(key);
    if(tabId===undefined||bindings.get(tabId)?.gid!==b.gid)return;
    if(data.op==='popup-navigate')await chrome.tabs.update(tabId,{url:destination()});
    if(data.op==='popup-submit'){
      const target=destination();
      if(!/^https?:/.test(target)||!['GET','POST'].includes(data.method))throw Error('不支持此表单跳转');
      if(data.method==='POST')bindings.get(tabId).navigation={url:target,method:'POST',
        postData:btoa(Array.from(new TextEncoder().encode(String(data.body)),byte=>String.fromCharCode(byte)).join('')),
        contentType:String(data.contentType),origin:url.origin,referrer:url.href};
      await chrome.tabs.update(tabId,{url:target});
    }
    if(data.op==='popup-focus')await chrome.tabs.update(tabId,{active:true});
    if(data.op==='popup-close'){await chrome.tabs.remove(tabId);popupTabs.delete(key);}
    return;
  }
  if(data.op==='cookie'){
    const cookie=parse(data.text,url.href,true);
    if(!cookie||g.cookies.some(c=>!expired(c)&&c.httpOnly&&c.name===cookie.name&&c.domain.replace(/^\./,'')===cookie.domain&&c.path===cookie.path)||!put(g.cookies,cookie))return;
    resourceCache.invalidate(g.id);schedulePersist(g.id);await broadcast(g.id,{op:'cookies',cookies:g.cookies});return;
  }
  if(data.op==='storage'&&['local','session'].includes(data.kind)){
    g.sessions??={};g.sessions[source.tabId]??={};
    const store=data.kind==='local'?g.local:g.sessions[source.tabId];store[url.origin]??={};
    const before=store[url.origin];
    if(data.key===null&&!Object.keys(before).length||data.key!==null&&data.value===null&&!Object.hasOwn(before,data.key)||data.key!==null&&data.value!==null&&before[data.key]===String(data.value))return;
    if(data.key===null)store[url.origin]={};else if(data.value===null)delete store[url.origin][data.key];else Object.defineProperty(store[url.origin],data.key,{value:String(data.value),enumerable:true,writable:true,configurable:true});
    schedulePersist(g.id);
    if(data.kind==='local')await broadcast(g.id,{...data,origin:url.origin},source.tabId+':'+sourceKey(source)+':'+p.executionContextId);
  }
}
chrome.debugger.onEvent.addListener(async(source,method,p)=>{
  await ready;
  const b=bindings.get(source.tabId);if(!b)return;
  const resourceKey=p.requestId&&networkKey(source,p.requestId),record=networkRecords.get(resourceKey);
  if(['Network.loadingFinished','Network.loadingFailed'].includes(method))requestOwners.delete(resourceKey);
  if(method==='Network.responseReceived'&&record){
    if(record.unsafe)resourceCache.invalidate(record.gid);
    return;
  }
  if(method==='Network.loadingFailed'){networkRecords.delete(resourceKey);return;}
  if(method==='Network.loadingFinished'&&record){
    networkRecords.delete(resourceKey);
    if(record.unsafe)resourceCache.invalidate(record.gid);
    return;
  }
  if(method==='Fetch.requestPaused'||method==='Target.attachedToTarget'){trace.push(method+' '+(p.responseStatusCode||p.request?.method||'')+' '+(p.request?new URL(p.request.url).pathname:'')+' headers='+(p.responseHeaders||[]).map(h=>h.name).join(','));if(trace.length>20)trace.shift();}
  const key=source.tabId+':'+sourceKey(source)+':'+(p.context?.id||p.executionContextId);
  if(method==='Runtime.executionContextCreated'&&p.context.auxData?.isDefault){b.contexts.set(key,{id:p.context.id,origin:p.context.origin,sessionId:source.sessionId});return;}
  if(method==='Runtime.executionContextDestroyed'){b.contexts.delete(key);return;}
  if(method==='DOM.documentUpdated'){b.domRoots?.delete(source.sessionId||'top');return;}
  if(method==='Runtime.executionContextsCleared'){b.domRoots?.delete(source.sessionId||'top');for(const[k,c]of b.contexts)if(c.sessionId===source.sessionId)b.contexts.delete(k);return;}
  if(method==='Page.frameNavigated'&&!p.frame.parentId&&!source.sessionId){b.frameId=p.frame.id;if(/^https?:/.test(p.frame.url))b.topUrl=p.frame.url;}
  if(method==='Debugger.paused'){
    (async()=>{
      const g=groups.get(b.gid),data={id:g.id,cookies:g.cookies.filter(c=>!c.httpOnly),local:g.local,session:g.sessions?.[source.tabId]||g.initialSession||{}};
      const result=await command(source,'Debugger.evaluateOnCallFrame',{callFrameId:p.callFrames[0].callFrameId,
        expression:'('+isolate.toString()+')('+JSON.stringify(data)+')',returnByValue:true});
      if(result.exceptionDetails)throw Error('页面存储接管失败：'+(result.exceptionDetails.exception?.description||result.exceptionDetails.text));
      await command(source,'Debugger.resume');
    })().catch(error=>{reportError(error);});return;
  }
  if(method==='Target.attachedToTarget'){
    const child={tabId:source.tabId,sessionId:p.sessionId};
    configure(child,b).then(()=>command(child,'Runtime.runIfWaitingForDebugger')).catch(async error=>{reportError(error);await chrome.tabs.update(source.tabId,{url:chrome.runtime.getURL('stopped.html')});});return;
  }
  if(method==='Fetch.requestPaused'){
    const response=p.responseStatusCode!==undefined||p.responseErrorReason;
    if(!response&&p.resourceType==='Document'){b.documentRequests??=new Map();b.documentRequests.set(networkKey(source,p.frameId),p.requestId);}
    const ownerKey=networkKey(source,p.networkId||('fetch:'+p.requestId));
    if(!response){
      try{if(!await life.beforeRequest(source,p,b)){await command(source,'Fetch.failRequest',{requestId:p.requestId,errorReason:'Aborted'}).catch(()=>{});return;}}
      catch(error){reportError(error);await command(source,'Fetch.failRequest',{requestId:p.requestId,errorReason:'Aborted'}).catch(()=>{});return;}
      requestOwners.set(ownerKey,b);
    }else if(requestOwners.get(ownerKey)!==b){await command(source,'Fetch.failRequest',{requestId:p.requestId,errorReason:'Aborted'}).catch(()=>{});return;}
    // DOM protocol reads can wait for the renderer too (e.g. while JS is in a
    // synchronous XHR). Resolve credential metadata OUTSIDE the group queue so
    // the XHR request/response can run and unblock the renderer. Cookie/Header
    // selection and response mutations still commit on the group queue.
    const credentialMode=response?Promise.resolve(false):anonymousResource(command,source,p,b);
    credentialMode.then(anonymous=>enqueue(b.gid,()=>pause(source,p,b,anonymous))).catch(async error=>{
      if(!bindings.has(source.tabId))return;
      reportError(error);await command(source,'Fetch.failRequest',{requestId:p.requestId,errorReason:'BlockedByClient'}).catch(()=>{});
    });
  }
  if(method==='Runtime.bindingCalled')enqueue(b.gid,()=>binding(source,p,b)).catch(()=>{});
});
async function stopTab(tabId){
  await life.halt(tabId);
  bindings.delete(tabId);await guard(tabId,true);await saveBindings();
  await chrome.tabs.update(tabId,{url:chrome.runtime.getURL('stopped.html')}).catch(()=>{});
}
chrome.debugger.onDetach.addListener(async(source,reason)=>{
  if(moving.has(source.tabId))return;
  const b=bindings.get(source.tabId);if(!b)return;
  if(reason!=='target_closed'){lastError='会话接管已停止，请通过插件重新打开分组。';await stopTab(source.tabId);}
  else{bindings.delete(source.tabId);await saveBindings();}
});
async function open(gid,windowId,url,openerId,options={}){
  const g=groups.get(gid);if(!g)throw Error('分组不存在');
  const tab=await chrome.tabs.create({windowId,url:'about:blank',active:true,...(openerId?{openerTabId:openerId}:{})});
  const b={gid,topUrl:bindings.get(openerId)?.topUrl||url||g.url,contexts:new Map(),scripts:new Map(),pageKey:options.pageKey};bindings.set(tab.id,b);initializing.add(tab.id);
  if(options.session){g.sessions??={};g.sessions[tab.id]=structuredClone(options.session);}
  else if(openerId){g.sessions??={};g.sessions[tab.id]=structuredClone(g.sessions[openerId]||g.initialSession||{});}
  try{
    await guard(tab.id);await life.allow(tab.id);
    await chrome.debugger.attach({tabId:tab.id},'1.3');
    const tree=await command({tabId:tab.id},'Page.getFrameTree');b.frameId=tree.frameTree.frame.id;
    await configure({tabId:tab.id},b);life.assertActive(tab.id,b);
    const sibling=(await chrome.tabs.query({windowId})).find(t=>t.id!==tab.id&&bindings.get(t.id)?.gid===gid&&t.groupId>=0);
    let groupId=sibling?.groupId;
    groupId=await chrome.tabs.group({tabIds:[tab.id],...(groupId===undefined?{}:{groupId})});
    groupLinks.set(groupId,gid);
    await chrome.tabGroups.update(groupId,{title:groupTitle(g),color:'green',collapsed:false});
    await saveBindings();
    // The tab is already blank. Reloading blank here creates an initialization
    // context that an immediately submitted form would cancel mid-injection.
    const destination=url||g.homeUrl;
    life.assertActive(tab.id,b);if(destination!=='about:blank')await chrome.tabs.update(tab.id,{url:destination});
    life.track({...tab,url:destination},gid);
    lastError='';
    return {tabId:tab.id,groupId};
  }catch(error){if(bindings.get(tab.id)===b)bindings.delete(tab.id);if(!life.isHalted(tab.id))await chrome.tabs.remove(tab.id).catch(()=>{});throw error;}
  finally{initializing.delete(tab.id);}
}
async function moveIntoGroup(tab,gid){
  if(moving.has(tab.id)||initializing.has(tab.id))return;
  moving.add(tab.id);
  try{
    const old=bindings.get(tab.id),url=/^https?:/.test(tab.url)?tab.url:groups.get(gid)?.url;
    if(!url)return;
    if(old?.gid===gid)return;
    // Destroy the old document before changing identity; this also clears its JS wrappers.
    await chrome.tabs.update(tab.id,{url:'about:blank'});
    await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{chrome.tabs.onUpdated.removeListener(done);reject(Error('标签页切换超时'));},10000);
      const done=(id,change)=>{if(id===tab.id&&change.status==='complete')chrome.tabs.get(id).then(t=>{if(t.url==='about:blank'&&t.status==='complete'){clearTimeout(timer);chrome.tabs.onUpdated.removeListener(done);resolve();}});};
      chrome.tabs.onUpdated.addListener(done);done(tab.id,{status:'complete'});});
    bindings.delete(tab.id);
    if(old)await chrome.debugger.detach({tabId:tab.id}).catch(()=>{});
    if(!gid){await chrome.declarativeNetRequest.updateSessionRules({removeRuleIds:[tab.id]});await saveBindings();await chrome.tabs.update(tab.id,{url});return;}
    const b={gid,topUrl:url,contexts:new Map(),scripts:new Map()};bindings.set(tab.id,b);
    await guard(tab.id);await chrome.debugger.attach({tabId:tab.id},'1.3');
    const tree=await command({tabId:tab.id},'Page.getFrameTree');b.frameId=tree.frameTree.frame.id;
    await configure({tabId:tab.id},b);await saveBindings();await chrome.tabs.update(tab.id,{url});
  }catch(error){if(!await chrome.tabs.get(tab.id).catch(()=>null))return;reportError(error);await guard(tab.id,true).catch(()=>{});await chrome.tabs.update(tab.id,{url:chrome.runtime.getURL('stopped.html')}).catch(()=>{});}
  finally{moving.delete(tab.id);}
}
async function create(active,name){
  const current=await chrome.tabs.get(active.id);
  if(!/^https?:/.test(current.url))throw Error('请先选中要继承登录的普通网站标签页');
  if(bindings.has(active.id))throw Error('请从普通 Chrome 标签页创建新分组');
  const stores=await chrome.cookies.getAllCookieStores(),store=stores.find(s=>s.tabIds.includes(active.id));
  if(!store)throw Error('找不到当前 Profile Cookie 存储');
  const cookies=await chrome.cookies.getAll({storeId:store.id});
  const [captured]=await chrome.scripting.executeScript({target:{tabId:active.id},func:()=>({origin:location.origin,local:Object.fromEntries(Object.entries(localStorage)),session:Object.fromEntries(Object.entries(sessionStorage))})});
  const snapshot=captured.result,id=crypto.randomUUID().replaceAll('-','');
  const g=migrate({id,name:name||new URL(current.url).hostname,url:current.url,homeUrl:current.url,cookies,local:{[snapshot.origin]:snapshot.local},initialSession:{[snapshot.origin]:snapshot.session},sessions:{},created:Date.now()});
  groups.set(id,g);await persist();
  const result=await open(id,active.windowId);return {...result,id};
}
chrome.runtime.onMessage.addListener((message,sender,reply)=>{
  const senderPage=sender.url?.split(/[?#]/)[0];
  if(sender.id!==chrome.runtime.id||![endpoint,chrome.runtime.getURL('gate.html')].includes(senderPage))return;
  if(senderPage!==endpoint&&message.type!=='route')return;
  (async()=>{
    await ready;
    if(message.type==='route')return life.route(sender,message.url);
    if(message.type==='bind-group')return life.adopt(message.gid,message.active.id);
    if(message.type==='restore-window')return life.restore(message.gid,message.active.windowId);
    if(message.type==='history-open')return life.openHistory(message.gid,message.entry,message.active.windowId);
    if(message.type==='set-home'){if(!http(message.url))throw Error('主页必须为 HTTP(S) 地址');const g=groups.get(message.gid);g.homeUrl=message.url;await persist();return {};}
    if(message.type==='status')return {groups:[...groups.values()].map(publicGroup),current:bindings.get(message.active?.id)?.gid||null,error:lastError,pending:[...pending.values()],trace};
    if(message.type==='headers')return enqueue(message.gid,async()=>{
      const g=groups.get(message.gid);if(!g)throw Error('分组不存在');
      const config=normalizeHeaders(message.config);resourceCache.invalidate(g.id);g.headers=config;await persist();lastError='';return config;
    });
    if(message.type==='stop'){
      if(!bindings.has(message.active.id))throw Error('该页不属于受管会话');
      await stopTab(message.active.id);await chrome.debugger.detach({tabId:message.active.id}).catch(()=>{});return {};
    }
    if(message.type==='create')return create(message.active,message.name);
    if(message.type==='new-tab')return open(message.gid,message.active.windowId,message.url);
    if(message.type==='open'){
      const stored=groups.get(message.gid);if(!stored)throw Error('分组不存在');
      const tabs=await chrome.tabs.query({});const home=tabs.find(t=>bindings.get(t.id)?.gid===stored.id&&t.url===stored.homeUrl);
      if(home){await chrome.windows.update(home.windowId,{focused:true});await chrome.tabs.update(home.id,{active:true});return {};}
      return open(message.gid,message.active.windowId);
    }
    if(message.type==='close'){
      await queues.get(message.gid);await life.close(message.gid);lastError='';return {};
    }
    if(message.type==='delete'){
      const g=groups.get(message.gid);if(publicGroup(g).tabs.length)throw Error('请先关闭分组');groups.delete(g.id);resourceCache.drop(g.id);await persist();return {};
    }
    throw Error('未知操作');
  })().then(result=>reply({ok:true,result}),error=>{reportError(error);reply({ok:false,error:error.message});});return true;
});
chrome.tabs.onRemoved.addListener(id=>{for(const[key,tabId]of popupTabs)if(tabId===id||key.startsWith(id+':'))popupTabs.delete(key);for(const key of networkRecords.keys())if(key.startsWith(id+':'))networkRecords.delete(key);chrome.declarativeNetRequest.updateSessionRules({removeRuleIds:[id]}).catch(()=>{});if(bindings.has(id)){bindings.delete(id);saveBindings();}});
chrome.tabGroups.onRemoved.addListener(group=>{groupLinks.delete(group.id);saveBindings();});
