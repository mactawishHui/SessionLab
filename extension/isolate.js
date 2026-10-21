// Runs in the site's main world before any of its scripts. It never renders or mirrors the page.
export function isolate(config) {
  if(globalThis.__sessionLabNative)return;
  Object.defineProperty(globalThis,'__sessionLabNative',{value:true});
  const origin=location.origin, prefix='__session_lab_'+config.id+'__';
  const emit=(op,data)=>globalThis.__sessionLabBinding(JSON.stringify({op,...data,url:location.href}));
  const dictionary=seed=>Object.assign(Object.create(null),seed||{});
  const dictionaries={local:dictionary(config.local[origin]),session:dictionary(config.session[origin])};
  const makeStorage=kind=>{
    const methods={getItem:key=>dictionaries[kind][String(key)]??null,
      setItem:(key,value)=>{key=String(key);value=String(value);const oldValue=dictionaries[kind][key]??null;if(oldValue===value)return;dictionaries[kind][key]=value;emit('storage',{kind,key,value,oldValue});},
      removeItem:key=>{key=String(key);const oldValue=dictionaries[kind][key]??null;if(oldValue===null)return;delete dictionaries[kind][key];emit('storage',{kind,key,value:null,oldValue});},
      clear:()=>{if(!Object.keys(dictionaries[kind]).length)return;dictionaries[kind]=dictionary();emit('storage',{kind,key:null,value:null,oldValue:null});},
      key:index=>Object.keys(dictionaries[kind])[Number(index)]??null};
    return new Proxy(Object.create(Storage.prototype),{
      get:(_,key)=>key==='length'?Object.keys(dictionaries[kind]).length:key===Symbol.toStringTag?'Storage':key in methods?methods[key]:dictionaries[kind][key],
      set:(_,key,value)=>{methods.setItem(key,value);return true;},
      deleteProperty:(_,key)=>{methods.removeItem(key);return true;},
      ownKeys:()=>Object.keys(dictionaries[kind]),
      getOwnPropertyDescriptor:(_,key)=>key in dictionaries[kind]?{value:dictionaries[kind][key],writable:true,enumerable:true,configurable:true}:undefined,
      has:(_,key)=>key in methods||key in dictionaries[kind]});
  };
  const local=makeStorage('local'),session=makeStorage('session');
  Object.defineProperty(window,'localStorage',{get:()=>local,configurable:false});
  Object.defineProperty(window,'sessionStorage',{get:()=>session,configurable:false});
  let cookies=config.cookies.filter(c=>!c.httpOnly);
  const matches=c=>{
    const domain=c.domain.replace(/^\./,'');
    return (c.hostOnly?location.hostname===domain:location.hostname===domain||location.hostname.endsWith('.'+domain))&&
      (!c.secure||location.protocol==='https:')&&(!c.expirationDate||c.expirationDate>Date.now()/1000)&&
      (location.pathname===(c.path||'/')||location.pathname.startsWith((c.path||'/').replace(/\/?$/,'/')));
  };
  Object.defineProperty(Document.prototype,'cookie',{configurable:false,get:()=>cookies.filter(matches).sort((a,b)=>b.path.length-a.path.length).map(c=>c.name+'='+c.value).join('; '),set:text=>{
    // Synchronous read-after-write; the background validates and distributes the canonical cookie.
    const parts=String(text).split(';'),pair=parts.shift(),i=pair.indexOf('=');
    if(i<1)return;
    const cookie={name:pair.slice(0,i).trim(),value:pair.slice(i+1).trim(),domain:location.hostname,hostOnly:true,path:location.pathname.slice(0,location.pathname.lastIndexOf('/'))||'/'};
    let forbidden=false;
    for(const p of parts){const [k,...values]=p.trim().split('='),v=values.join('=');
      if(k.toLowerCase()==='domain'){cookie.domain=v.replace(/^\./,'');cookie.hostOnly=false;if(!(location.hostname===cookie.domain||location.hostname.endsWith('.'+cookie.domain)))forbidden=true;}
      if(k.toLowerCase()==='path'&&v.startsWith('/'))cookie.path=v;
      if(k.toLowerCase()==='httponly')forbidden=true;
      if(k.toLowerCase()==='secure')cookie.secure=true;
      if(k.toLowerCase()==='max-age')cookie.expirationDate=Date.now()/1000+Number(v);
      if(k.toLowerCase()==='expires'&&!cookie.expirationDate)cookie.expirationDate=Date.parse(v)/1000;
    }
    if(forbidden)return;
    cookies=cookies.filter(c=>!(c.name===cookie.name&&c.domain.replace(/^\./,'')===cookie.domain&&c.path===cookie.path));cookies.push(cookie);
    emit('cookie',{text:String(text)});
  }});
  Object.defineProperty(window,'__sessionLabUpdate',{value:change=>{
    if(change.op==='cookies'){cookies=change.cookies.filter(c=>!c.httpOnly);return;}
    if(change.op!=='storage'||change.kind!=='local'||change.origin!==origin)return;
    if(change.key===null)dictionaries.local=dictionary();else if(change.value===null)delete dictionaries.local[change.key];else dictionaries.local[change.key]=change.value;
    window.dispatchEvent(new StorageEvent('storage',{key:change.key,oldValue:change.oldValue,newValue:change.value,url:change.url}));
  }});
  const idb=indexedDB,open=idb.open.bind(idb),remove=idb.deleteDatabase.bind(idb),dbs=idb.databases?.bind(idb);
  idb.open=(name,...args)=>open(prefix+name,...args);idb.deleteDatabase=name=>remove(prefix+name);
  if(dbs)idb.databases=async()=>(await dbs()).filter(d=>d.name.startsWith(prefix)).map(d=>({...d,name:d.name.slice(prefix.length)}));
  if(globalThis.caches){const store=caches;
    for(const method of ['open','has','delete']){const fn=store[method].bind(store);store[method]=name=>fn(prefix+name);}
    const keys=store.keys.bind(store);store.keys=async()=>(await keys()).filter(n=>n.startsWith(prefix)).map(n=>n.slice(prefix.length));
    store.match=async(request,options={})=>{if(options.cacheName)return(await store.open(options.cacheName)).match(request,options);for(const name of await store.keys()){const result=await(await store.open(name)).match(request,options);if(result)return result;}};
  }
  if(globalThis.BroadcastChannel){const Native=BroadcastChannel;globalThis.BroadcastChannel=class extends Native{constructor(name){super(prefix+name);}};}
  const unsupported=feature=>{throw new DOMException('Session Lab Native 暂不支持 '+feature,'NotSupportedError');};
  // Never let a popup make its first request in Chrome's ordinary Cookie jar.
  // The background creates an about:blank tab, attaches this group's session,
  // and only then navigates. A small handle supports common async login flows
  // which first open a blank tab and later set popup.location / location.href.
  const popups=new Map(),popupTokens=new WeakMap();
  const popupURL=value=>{
    const url=new URL(value==null||value===''?'about:blank':String(value),location.href);
    if(!['http:','https:'].includes(url.protocol)&&url.href!=='about:blank')unsupported('此新标签页协议');
    return url.href;
  };
  window.open=(value='',target='_blank')=>{
    const url=popupURL(value),name=String(target||'_blank');
    if(['_self','_top','_parent'].includes(name.toLowerCase())){location.assign(url);return window;}
    if(name!=='_blank'&&popups.has(name)&&!popups.get(name).closed){const handle=popups.get(name);handle.location=url;handle.focus();return handle;}
    const token=crypto.randomUUID();let href=url,closed=false;
    const navigate=value=>{if(closed)return;href=popupURL(value);emit('popup-navigate',{token,target:href});};
    const destination={get href(){return href;},set href(value){navigate(value);},assign:navigate,replace:navigate,toString:()=>href};
    const handle={get closed(){return closed;},get location(){return destination;},set location(value){navigate(value);},
      focus:()=>{if(!closed)emit('popup-focus',{token});},
      close:()=>{if(!closed){closed=true;emit('popup-close',{token});}}};
    popups.set(name==='_blank'?token:name,handle);
    popupTokens.set(handle,token);
    emit('popup-open',{token,target:url});
    return handle;
  };
  const openNewWindow=event=>{
    if(event.defaultPrevented||event.type==='auxclick'&&event.button!==1)return;
    const link=event.target.closest?.('a[href]');
    if(link&&!link.hasAttribute('download')&&((link.target&&!['_self','_top','_parent'].includes(link.target.toLowerCase()))||event.metaKey||event.ctrlKey||event.shiftKey||event.type==='auxclick')){
      event.preventDefault();window.open(link.href,link.target||'_blank');
    }
  };
  document.addEventListener('click',openNewWindow);document.addEventListener('auxclick',openNewWindow);
  const nativeSubmit=HTMLFormElement.prototype.submit;
  const submitNewWindow=(form,submitter)=>{
    const target=submitter?.formTarget||form.target;
    if(!target||['_self','_top','_parent'].includes(target.toLowerCase()))return false;
    const action=popupURL(submitter?.hasAttribute('formaction')?submitter.formAction:form.action||location.href);
    if(!/^https?:/.test(action))unsupported('非 HTTP 表单');
    const method=(submitter?.getAttribute('formmethod')||form.method||'get').toUpperCase();
    if(!['GET','POST'].includes(method))unsupported('此表单方法');
    const data=new FormData(form,submitter||undefined),entries=[...data.entries()];
    if(entries.some(([,v])=>v instanceof File))unsupported('新标签页文件上传表单');
    const url=new URL(action);let body='',contentType='';
    if(method==='GET')url.search=new URLSearchParams(entries).toString();
    else{
      const encoding=submitter?.getAttribute('formenctype')||form.enctype;
      if(encoding==='multipart/form-data'){
        const boundary='----SessionLab'+crypto.randomUUID().replaceAll('-','');
        body=entries.map(([key,value])=>'--'+boundary+'\r\nContent-Disposition: form-data; name="'+key.replace(/[\r\n"]/g,'_')+'"\r\n\r\n'+value+'\r\n').join('')+'--'+boundary+'--\r\n';
        contentType='multipart/form-data; boundary='+boundary;
      }else if(encoding==='text/plain'){body=entries.map(([key,value])=>key+'='+value+'\r\n').join('');contentType='text/plain';}
      else{body=new URLSearchParams(entries).toString();contentType='application/x-www-form-urlencoded';}
    }
    const handle=window.open('',target);
    emit('popup-submit',{token:popupTokens.get(handle),target:url.href,method,body,contentType});
    return true;
  };
  HTMLFormElement.prototype.submit=function(){if(submitNewWindow(this))return;return nativeSubmit.call(this);};
  document.addEventListener('submit',event=>{
    if(!event.defaultPrevented&&submitNewWindow(event.target,event.submitter))event.preventDefault();
  });
  // Shared workers, service workers and WebSocket handshakes can bypass per-tab Fetch interception.
  // Disable these paths instead of silently using the daily profile's identity.
  if(globalThis.Worker)globalThis.Worker=function(){unsupported('Worker');};
  if(globalThis.SharedWorker)globalThis.SharedWorker=function(){unsupported('SharedWorker');};
  if(globalThis.WebSocket)globalThis.WebSocket=function(){unsupported('WebSocket');};
  if(navigator.serviceWorker){navigator.serviceWorker.register=()=>Promise.reject(new DOMException('Session Lab 禁用 Service Worker','NotSupportedError'));navigator.serviceWorker.getRegistrations=async()=>[];navigator.serviceWorker.getRegistration=async()=>undefined;
    Object.defineProperty(navigator.serviceWorker,'controller',{get:()=>null});Object.defineProperty(navigator.serviceWorker,'ready',{get:()=>new Promise(()=>{})});}
  if(globalThis.cookieStore)Object.defineProperty(window,'cookieStore',{value:undefined});
  emit('ready',{});
}
