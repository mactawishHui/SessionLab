// Stable identity belongs to the session, never to Chrome's transient group ID.
export const http=value=>{try{return /^https?:$/.test(new URL(value).protocol);}catch{return false;}};
const INVISIBLE='\u2063';
export const marker=g=>INVISIBLE+[...g.id].map(c=>String.fromCharCode(0xfe00+parseInt(c,16))).join('')+INVISIBLE;
export const groupTitle=g=>g.name+marker(g);
export function markedId(title=''){
  const hidden=/\u2063([\ufe00-\ufe0f]{32})\u2063$/.exec(title);
  if(hidden)return [...hidden[1]].map(c=>(c.charCodeAt(0)-0xfe00).toString(16)).join('');
  return / · SL:([a-f0-9]{32})$/.exec(title)?.[1]; // Read/migrate 1.1 titles.
}
export function displayTitle(title=''){return title.replace(/\u2063[\ufe00-\ufe0f]{32}\u2063$| · SL:[a-f0-9]{32}$/,'');}
export function migrate(g){g.homeUrl??=g.url;g.history??=[];g.windowTabs??=[];g.closedWindowTabs??=[];if(g.historyVersion!==2){g.legacyHistory??=g.history;const seen=new Set();g.history=g.history.filter(h=>http(h.url)&&h.kind==='closed'&&!seen.has(h.url)&&seen.add(h.url)).map(h=>({...h,tabKey:h.tabKey||[...g.windowTabs,...g.closedWindowTabs].find(p=>p.url===h.url)?.key||crypto.randomUUID(),domain:new URL(h.url).hostname}));g.historyVersion=2;}return g;}
export function lifecycle({groups,bindings,groupLinks,moving,initializing,persist,schedulePersist,saveBindings,guard,configure,command,open,moveIntoGroup,reportError,ready}){
  const pages=new Map(),batches=new Map(),closing=new Set(),routing=new Map(),timers=new Map(),halted=new Set(),transitions=new Map(),ordinaryLeases=new Map(),recovery=new Map(),recoveredGroups=new Set(),nativeAssignments=new Map(),connections=new Map(),destinations=new Map(),historyJobs=new Map();
  async function halt(id){halted.add(id);const p=pages.get(id);pages.delete(id);if(p&&groups.has(p.gid)){groups.get(p.gid).windowTabs=snapshot(p.gid);schedulePersist(p.gid);}await chrome.storage.session.set({nativeStopped:[...halted]});}
  const allowed=new Set();let allowRule=500000001,allowChain=Promise.resolve();
  // One aggregate rule avoids arithmetic collisions with Chrome's large tab
  // IDs. Relocate it if a future tab receives the reserved ID.
  function allow(id,remove=false){
    if(!remove&&bindings.has(id))ordinaryLeases.delete(id);
    if(remove)allowed.delete(id);else allowed.add(id);
    const task=allowChain.catch(()=>{}).then(async()=>{
      const rules=await chrome.declarativeNetRequest.getSessionRules();
      const old=rules.filter(r=>r.action.type==='allow'&&r.priority===10).map(r=>r.id);
      const occupied=new Set([...rules.filter(r=>!old.includes(r.id)).map(r=>r.id),...allowed,...bindings.keys()]);
      while(occupied.has(allowRule))allowRule++;
      await chrome.declarativeNetRequest.updateSessionRules({removeRuleIds:old,addRules:allowed.size?[{id:allowRule,priority:10,action:{type:'allow'},condition:{tabIds:[...allowed],urlFilter:'|http',resourceTypes:['main_frame']}}]:[]});
    });allowChain=task;return task;
  }
  function snapshot(gid){return [...pages.values()].filter(p=>p.gid===gid&&http(p.url)).sort((a,b)=>(a.windowId||0)-(b.windowId||0)||a.index-b.index).map(p=>({...p,session:structuredClone(groups.get(gid)?.sessions?.[p.tabId]||p.session||{})}));}
  function visit(g,p,kind='visit'){
    if(!http(p.url))return;
    const index=g.history.findIndex(h=>h.tabKey===p.key);
    const previous=index>=0?g.history.splice(index,1)[0]:{};
    const row={...previous,id:previous.id||crypto.randomUUID(),tabKey:p.key,url:p.url,title:p.title||p.url,domain:new URL(p.url).hostname,at:Date.now(),kind};
    if(kind==='closed')row.session=structuredClone(g.sessions?.[p.tabId]||p.session||{});else delete row.session;
    g.history.unshift(row);g.history.length=Math.min(g.history.length,150);
  }

  function track(tab,gid,record=false){
    const old=pages.get(tab.id),g=groups.get(gid);if(!g)return;
    const url=http(tab.url)?tab.url:old?.url;
    if(!url)return;
    const p={...old,gid,tabId:tab.id,key:old?.key||bindings.get(tab.id)?.pageKey||crypto.randomUUID(),url,title:tab.title||old?.title||url,index:tab.index||0,windowId:tab.windowId,active:!!tab.active,pinned:!!tab.pinned};if([...pages.values()].some(other=>other.tabId!==tab.id&&other.gid===gid&&other.key===p.key&&bindings.get(other.tabId)?.gid===gid))p.key=crypto.randomUUID();pages.set(tab.id,p);
    const b=bindings.get(tab.id);if(b&&b.pageKey!==p.key){b.pageKey=p.key;saveBindings().catch(reportError);}
    if(record)visit(g,p);
    if(!closing.has(gid)&&!batches.has(gid))g.windowTabs=snapshot(gid);
    schedulePersist(gid);
  }
  async function identify(tab){
    if(tab.groupId<0)return null;
    let gid=groupLinks.get(tab.groupId);
    if(gid&&groups.has(gid))return gid;
    const native=await chrome.tabGroups.get(tab.groupId).catch(()=>null);
    gid=markedId(native?.title);if(gid&&groups.has(gid)){recoveredGroups.add(tab.groupId);groupLinks.set(tab.groupId,gid);await saveBindings();return gid;}
    // During a cross-window move Chrome can replace the group before the new
    // title is available. Recover only if EVERY member is already owned by one
    // session; never adopt unrelated tabs merely because a title looks alike.
    const members=await chrome.tabs.query({groupId:tab.groupId});
    const owners=members.map(t=>bindings.get(t.id)?.gid||pages.get(t.id)?.gid);
    if(owners.length&&owners.every(g=>g&&g===owners[0])&&groups.has(owners[0])){
      gid=owners[0];groupLinks.set(tab.groupId,gid);await chrome.tabGroups.update(tab.groupId,{title:groupTitle(groups.get(gid))});await saveBindings();return gid;
    }
    return null;
  }
  function assertActive(id,b){if(!b||halted.has(id)||bindings.get(id)!==b)throw Error('会话接管已取消，已停止恢复');}
  async function rehome(tab,gid){
    const sibling=(await chrome.tabs.query({windowId:tab.windowId})).find(t=>t.id!==tab.id&&bindings.get(t.id)?.gid===gid&&t.groupId>=0);
    const groupId=await chrome.tabs.group({tabIds:[tab.id],...(sibling?{groupId:sibling.groupId}:{})});groupLinks.set(groupId,gid);
    await chrome.tabGroups.update(groupId,{title:groupTitle(groups.get(gid)),color:'green'});await saveBindings();
  }
  async function beforeRequest(source,p,b){
    const tab=await chrome.tabs.get(source.tabId).catch(()=>null);if(!tab||halted.has(tab.id)||bindings.get(tab.id)!==b)return false;
    const gid=await identify(tab);
    if(gid===b.gid)return true;
    if(!gid){await rehome(tab,b.gid);return bindings.get(tab.id)===b&&!halted.has(tab.id);}
    if(!transitions.has(tab.id)){
      const url=p.resourceType==='Document'?p.request.url:(http(tab.url)?tab.url:groups.get(gid).homeUrl);
      const task=connect(tab,gid,url).catch(reportError).finally(()=>transitions.delete(tab.id));transitions.set(tab.id,task);
    }
    return false;
  }
  function freeze(gid,rows){for(const key of nativeAssignments.keys())if(key.startsWith(gid+':'))nativeAssignments.delete(key);const g=groups.get(gid);recovery.set(gid,rows.map(p=>({...p,session:structuredClone(g.sessions?.[p.tabId]||p.session||g.initialSession||{})})));}
  async function recoveredSession(tab,gid,url){
    if(!recoveredGroups.has(tab.groupId))return;
    const saved=recovery.get(gid)||[];const matches=saved.filter(p=>p.url===url);
    if(!matches.length)return;
    const nativeGroups=await chrome.tabGroups.query({});const own=new Set(nativeGroups.filter(n=>(groupLinks.get(n.id)||markedId(n.title))===gid).map(n=>n.id));
    const native=(await chrome.tabs.query({})).filter(t=>own.has(t.groupId)).sort((a,b)=>a.windowId-b.windowId||a.index-b.index);
    const effective=t=>{const value=t.pendingUrl||t.url||'';return value.startsWith(chrome.runtime.getURL('gate.html')+'#')?value.slice(value.indexOf('#')+1):value;};
    const siblings=native.filter(t=>effective(t)===url);const rank=siblings.findIndex(t=>t.id===tab.id);
    const key=gid+':'+url;let assigned=nativeAssignments.get(key);if(!assigned)nativeAssignments.set(key,assigned=new Map());
    if(assigned.has(tab.id))return matches[assigned.get(tab.id)];
    const used=new Set(assigned.values());let index=rank>=0&&rank<matches.length&&!used.has(rank)?rank:matches.findIndex((p,i)=>!used.has(i));
    if(index<0)return;assigned.set(tab.id,index);return matches[index];
  }
  async function settleDocument(id){
    for(let i=0;i<200;i++){
      const t=await chrome.tabs.get(id);const value=t.pendingUrl||t.url||'';
      if(value.startsWith(chrome.runtime.getURL('gate.html')+'#'))destinations.set(id,value.slice(value.indexOf('#')+1));
      if(t.status==='complete'&&(t.url==='about:blank'||t.url?.startsWith(chrome.runtime.getURL('gate.html'))))return;
      await new Promise(resolve=>setTimeout(resolve,15));
    }
    throw Error('新标签页尚未就绪，请重新打开会话');
  }
  async function navigateLatest(id,fallback){
    for(;;){
      const live=await chrome.tabs.get(id);const pending=live.pendingUrl||live.url||'';
      if(pending.startsWith(chrome.runtime.getURL('gate.html')+'#'))destinations.set(id,pending.slice(pending.indexOf('#')+1));
      else if(http(live.pendingUrl))destinations.set(id,live.pendingUrl);
      const url=destinations.get(id)||fallback;const b=bindings.get(id);assertActive(id,b);
      await chrome.tabs.update(id,{url});
      if(!destinations.has(id)||destinations.get(id)===url)return;
    }
  }
  async function connect(tab,gid,url,session){
    if(!destinations.has(tab.id))destinations.set(tab.id,url);
    if(connections.has(tab.id)){await connections.get(tab.id);return;}
    const operation=connectNow(tab,gid,url,session);connections.set(tab.id,operation);
    try{return await operation;}finally{if(connections.get(tab.id)===operation){connections.delete(tab.id);destinations.delete(tab.id);}}
  }
  async function connectNow(tab,gid,url,session){
    const existing=bindings.get(tab.id);
    if(existing?.gid===gid){assertActive(tab.id,existing);await guard(tab.id);assertActive(tab.id,existing);await allow(tab.id);assertActive(tab.id,existing);track({...tab,url},gid);if(tab.url?.startsWith(chrome.runtime.getURL('gate.html')))await navigateLatest(tab.id,url);return;}
    // The gate is already an extension document, and must stay fail-closed if
    // attachment fails. No ordinary Profile request is used as a fallback.
    initializing.add(tab.id);let nextBinding;
    try{
      // Preparation blocks subresources, but documents go to the local gate:
      // a URL pasted while attaching must never hit a terminal block rule.
      await allow(tab.id,true);await guard(tab.id,'prepare');
      const live=await chrome.tabs.get(tab.id);const pending=live.pendingUrl||'';
      if(http(pending))destinations.set(tab.id,pending);
      if(live.url?.startsWith(chrome.runtime.getURL('gate.html')+'#'))destinations.set(tab.id,live.url.slice(live.url.indexOf('#')+1));
      if(!live.url?.startsWith(chrome.runtime.getURL('gate.html')))await chrome.tabs.update(tab.id,{url:'about:blank'});
      await settleDocument(tab.id);
      if(existing){bindings.delete(tab.id);moving.add(tab.id);try{await chrome.debugger.detach({tabId:tab.id});}catch{}finally{moving.delete(tab.id);}}
      const g=groups.get(gid);g.sessions??={};const recovered=await recoveredSession(tab,gid,url);g.sessions[tab.id]=structuredClone(session||g.sessions[tab.id]||recovered?.session||pages.get(tab.id)?.session||g.initialSession||{});
      const b={gid,topUrl:url,contexts:new Map(),scripts:new Map(),pageKey:recovered?.key};nextBinding=b;bindings.set(tab.id,b);
      await chrome.debugger.attach({tabId:tab.id},'1.3');
      const tree=await command({tabId:tab.id},'Page.getFrameTree');b.frameId=tree.frameTree.frame.id;
      await configure({tabId:tab.id},b);assertActive(tab.id,b);await guard(tab.id);assertActive(tab.id,b);await allow(tab.id);assertActive(tab.id,b);await saveBindings();
      assertActive(tab.id,b);track({...tab,url:destinations.get(tab.id)||url},gid);await navigateLatest(tab.id,url);
    }catch(error){reportError(error);if(!bindings.has(tab.id)||bindings.get(tab.id)===nextBinding)await guard(tab.id,true).catch(()=>{});throw error;}
    finally{initializing.delete(tab.id);}
  }
  async function reconcile(id){
    await ready();if(halted.has(id)||initializing.has(id)||moving.has(id))return;
    const tab=await chrome.tabs.get(id).catch(()=>null);if(!tab)return;
    const gid=await identify(tab),old=bindings.get(id);
    if(gid){
      if(old?.gid===gid){await allow(id);track(tab,gid);return;}
      if(tab.url?.startsWith(chrome.runtime.getURL('gate.html')))return;
      await connect(tab,gid,http(tab.url)?tab.url:groups.get(gid).homeUrl);return;
    }
    if(old){await rehome(tab,old.gid);return;
    }
  }
  function later(id){clearTimeout(timers.get(id));timers.set(id,setTimeout(()=>{timers.delete(id);reconcile(id).catch(reportError);},350));}
  async function route(sender,url){
    if(sender.frameId!==0)throw Error('恢复入口仅允许顶层标签页使用');
    if(!http(url))throw Error('无效的恢复地址');
    const id=sender.tab?.id;if(halted.has(id))throw Error('该标签页已停止，请通过插件重新打开会话');if(id===undefined)throw Error('恢复入口缺少标签页');
    destinations.set(id,url);
    if(routing.has(id))return routing.get(id);
    const task=(async()=>{
      // Let Chrome finish assigning restored group membership before deciding.
      await new Promise(resolve=>setTimeout(resolve,80));
      const tab=await chrome.tabs.get(id);const gid=await identify(tab);
      if(gid)await connect(tab,gid,url);
      else{
        const native=tab.groupId>=0?await chrome.tabGroups.get(tab.groupId):null;
        if(markedId(native?.title))throw Error('原会话已不存在，已阻止恢复为普通页面');
        if(bindings.has(id))throw Error('会话归属未确认，已停止普通页面回退');
        await allow(id);ordinaryLeases.set(id,{url:new URL(url).href.split('#')[0],requests:new Set()});await chrome.tabs.update(id,{url});
      }
      return {};
    })();routing.set(id,task);try{return await task;}finally{routing.delete(id);if(!connections.has(id))destinations.delete(id);}
  }
  function removed(id){
    const p=pages.get(id);if(!p)return;
    const g=groups.get(p.gid);if(!g){pages.delete(id);return;}
    if(!closing.has(g.id)){
      let batch=batches.get(g.id);if(!batch){batch={before:snapshot(g.id)};batches.set(g.id,batch);g.windowTabs=batch.before;}
      visit(g,p,'closed');clearTimeout(batch.timer);
      batch.timer=setTimeout(()=>{if(batches.get(g.id)!==batch)return;batches.delete(g.id);const remaining=snapshot(g.id);g.windowTabs=remaining.length?remaining:batch.before;if(!remaining.length){g.closedWindowTabs=structuredClone(batch.before);freeze(g.id,batch.before);}schedulePersist(g.id);},180);
    }
    pages.delete(id);const batch=batches.get(g.id);if(batch&&!snapshot(g.id).length){g.windowTabs=batch.before;g.closedWindowTabs=structuredClone(batch.before);freeze(g.id,batch.before);}schedulePersist(g.id);
  }
  async function adopt(gid,tabId){
    const g=groups.get(gid);if(!g)throw Error('会话不存在');
    const tab=await chrome.tabs.get(tabId);if(tab.groupId<0)throw Error('请从需要修复的 Chrome 分组内打开插件');
    const native=await chrome.tabGroups.get(tab.groupId),owner=markedId(native.title)||groupLinks.get(tab.groupId);
    if(owner&&owner!==gid)throw Error('该分组已属于另一会话，不能直接覆盖');
    const members=await chrome.tabs.query({groupId:tab.groupId});
    if(members.some(t=>bindings.has(t.id)&&bindings.get(t.id).gid!==gid))throw Error('分组含其他会话的标签页，请先分开');
    for(const t of members)await guard(t.id,true);
    groupLinks.set(tab.groupId,gid);await chrome.tabGroups.update(tab.groupId,{title:groupTitle(g)});await saveBindings();
    for(const t of members)await connect(t,gid,http(t.url)?t.url:g.homeUrl);
    return {};
  }
  function cancelBatch(gid){const batch=batches.get(gid);if(batch){clearTimeout(batch.timer);batches.delete(gid);}}
  async function close(gid){
    cancelBatch(gid);
    const g=groups.get(gid);if(!g)throw Error('分组不存在');
    closing.add(gid);
    try{
      const ids=[...bindings].filter(([,b])=>b.gid===gid).map(([id])=>id);
      for(const id of ids){const t=await chrome.tabs.get(id).catch(()=>null);if(t)track(t,gid);}
      g.windowTabs=snapshot(gid);g.closedWindowTabs=structuredClone(g.windowTabs);freeze(gid,g.windowTabs);for(const p of g.windowTabs)visit(g,p,'closed');
      await persist();await Promise.all(ids.map(id=>chrome.tabs.remove(id).catch(()=>{})));
      return {};
    }finally{closing.delete(gid);}
  }
  async function openHistory(gid,entryId,windowId){
    const g=groups.get(gid),entry=g?.history.find(h=>h.id===entryId);if(!entry)throw Error('历史记录不存在');
    const key=gid+':'+entry.tabKey;if(historyJobs.has(key))return historyJobs.get(key);
    const operation=(async()=>{
      const existing=[...pages.values()].find(p=>p.gid===gid&&p.key===entry.tabKey&&bindings.get(p.tabId)?.gid===gid);
      if(existing){const tab=await chrome.tabs.get(existing.tabId).catch(()=>null);if(tab){await chrome.windows.update(tab.windowId,{focused:true});await chrome.tabs.update(tab.id,{active:true});return {tabId:tab.id,groupId:tab.groupId};}}
      const saved=[...g.closedWindowTabs,...g.windowTabs].find(p=>p.key===entry.tabKey);
      return open(gid,windowId,entry.url,undefined,{session:entry.session||g.sessions?.[saved?.tabId]||saved?.session,pageKey:entry.tabKey});
    })();historyJobs.set(key,operation);try{return await operation;}finally{historyJobs.delete(key);}
  }
  async function restore(gid,windowId){
    cancelBatch(gid);
    const g=groups.get(gid);if(!g)throw Error('分组不存在');
    if([...bindings.values()].some(b=>b.gid===gid))throw Error('分组已打开；请从历史记录恢复单个页面');
    const window=g.closedWindowTabs.length?g.closedWindowTabs:g.windowTabs;
    const saved=structuredClone(window.length?window:[{url:g.homeUrl}]);
    // open() updates the live snapshot, so preserve the closed snapshot first.
    let active;for(const p of saved){const result=await open(gid,windowId,p.url,undefined,{session:p.session,pageKey:p.key});if(p.active)active=result.tabId;}
    if(active)await chrome.tabs.update(active,{active:true});return {};
  }
  async function start(){
    for(const id of (await chrome.storage.session.get('nativeStopped')).nativeStopped||[])halted.add(id);
    for(const g of groups.values()){migrate(g);freeze(g.id,g.windowTabs.length?g.windowTabs:g.closedWindowTabs);}
    for(const native of await chrome.tabGroups.query({})){
      const gid=groupLinks.get(native.id)||markedId(native.title);
      if(groups.has(gid)){if(!groupLinks.has(native.id))recoveredGroups.add(native.id);groupLinks.set(native.id,gid);await chrome.tabGroups.update(native.id,{title:groupTitle(groups.get(gid))});}
    }
    for(const tab of await chrome.tabs.query({})){
      if(tab.url?.split(/[?#]/)[0]===chrome.runtime.getURL('stopped.html')){await halt(tab.id);await guard(tab.id,true);continue;}
      if(halted.has(tab.id))continue;
      const gid=await identify(tab);
      if(gid&&bindings.get(tab.id)?.gid===gid){track(tab,gid);await allow(tab.id);}
      else if(gid){if(!tab.url?.startsWith(chrome.runtime.getURL('gate.html')))await connect(tab,gid,http(tab.url)?tab.url:groups.get(gid).homeUrl);}
      // Ordinary tabs do not receive a long-lived main-frame allow. Each new
      // navigation must pass the declarative gate again to detect regrouping.
    }
    await persist();await saveBindings();
  }
  chrome.tabs.onUpdated.addListener((id,change,tab)=>{
    if(connections.has(id)){if(http(change.url))destinations.set(id,change.url);else if(change.url?.startsWith(chrome.runtime.getURL('gate.html')+'#'))destinations.set(id,change.url.slice(change.url.indexOf('#')+1));}
    const b=bindings.get(id);if(b&&(http(tab.url)||pages.has(id)))track(tab,b.gid,!!change.url||!!change.title||change.status==='complete');
    if(change.groupId!==undefined||change.status==='complete')later(id);
  });
  chrome.tabs.onCreated.addListener(tab=>{if(tab.groupId>=0)later(tab.id);});
  async function refreshWindow(windowId){for(const t of await chrome.tabs.query({windowId})){const b=bindings.get(t.id);if(b)track(t,b.gid);}}
  chrome.tabs.onMoved.addListener((id,info)=>{refreshWindow(info.windowId).catch(reportError);later(id);});
  chrome.tabs.onDetached.addListener((id,info)=>{refreshWindow(info.oldWindowId).catch(reportError);});
  chrome.tabs.onAttached.addListener((id,info)=>{refreshWindow(info.newWindowId).catch(reportError);later(id);});
  chrome.tabs.onActivated.addListener(async({tabId,windowId})=>{for(const t of await chrome.tabs.query({windowId})){const b=bindings.get(t.id);if(b)track(t,b.gid);}});
  chrome.tabGroups.onMoved.addListener(async group=>{for(const t of await chrome.tabs.query({groupId:group.id}))later(t.id);});
  chrome.tabGroups.onUpdated.addListener(group=>{const gid=groupLinks.get(group.id)||markedId(group.title);if(!groups.has(gid))return;
    if(!groupLinks.has(group.id))recoveredGroups.add(group.id);groupLinks.set(group.id,gid);const g=groups.get(gid);
    if(!group.title.endsWith(marker(g))){g.name=displayTitle(group.title)||g.name;schedulePersist(gid);chrome.tabGroups.update(group.id,{title:groupTitle(g)}).catch(reportError);}
    else{const label=displayTitle(group.title);if(label&&label!==g.name){g.name=label;schedulePersist(gid);}}
    chrome.tabs.query({groupId:group.id}).then(tabs=>tabs.forEach(t=>later(t.id))).catch(reportError);
  });
  chrome.webRequest.onBeforeRequest.addListener(details=>{const lease=ordinaryLeases.get(details.tabId);if(details.type==='main_frame'&&lease&&details.url===lease.url)lease.requests.add(details.requestId);},{urls:['http://*/*','https://*/*']});
  const release=details=>{const lease=ordinaryLeases.get(details.tabId);if(details.type==='main_frame'&&!bindings.has(details.tabId)&&lease?.requests.has(details.requestId)){ordinaryLeases.delete(details.tabId);allow(details.tabId,true).catch(reportError);}};
  chrome.webRequest.onCompleted.addListener(release,{urls:['http://*/*','https://*/*']});
  chrome.webRequest.onErrorOccurred.addListener(release,{urls:['http://*/*','https://*/*']});
  chrome.tabs.onRemoved.addListener(id=>{destinations.delete(id);connections.delete(id);ordinaryLeases.delete(id);halted.delete(id);chrome.storage.session.set({nativeStopped:[...halted]}).catch(()=>{});removed(id);allow(id,true).catch(()=>{});});
  return {start,route,allow,track,removed,close,restore,openHistory,pages,snapshot,halt,adopt,beforeRequest,assertActive,isHalted:id=>halted.has(id),syncSnapshots(){for(const gid of groups.keys())if(!closing.has(gid)&&!batches.has(gid)){const live=snapshot(gid);if(live.length)groups.get(gid).windowTabs=live;}}};
}
