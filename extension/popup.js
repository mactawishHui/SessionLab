const $=id=>document.getElementById(id);let active,current;
async function call(message){const r=await chrome.runtime.sendMessage(message);if(!r?.ok)throw Error(r?.error||'插件操作失败');return r.result;}
function headerEditor(group){
  const details=document.createElement('details');details.className='group-headers';
  const summary=document.createElement('summary');
  const controls=document.createElement('div');controls.className='header-controls';
  const rows=document.createElement('div');rows.className='header-rules';
  const add=document.createElement('button');add.className='header-add';add.textContent='添加 Header';
  const status=document.createElement('div');status.className='header-status';status.setAttribute('role','status');
  let revision=0;
  const title=()=>{const count=[...rows.children].filter(row=>row.querySelector('.header-enabled').checked&&row.querySelector('.header-name').value.trim()).length;
    summary.textContent='Header 设置'+(rows.children.length?' · '+count+' 条启用':'');};title();
  const save=async()=>{
    const version=++revision;title();
    const rules=[...rows.children].map(row=>({enabled:row.querySelector('.header-enabled').checked,operation:'set',name:row.querySelector('.header-name').value,value:row.querySelector('.header-value').value})).filter(rule=>rule.name||rule.value);
    status.textContent='正在保存…';
    try{await call({type:'headers',gid:group.id,config:{rules}});if(version===revision)status.textContent='已自动保存';}
    catch(error){if(version===revision)status.textContent=error.message;}
  };
  const addRow=(rule={enabled:true,name:'',value:''})=>{
    const row=document.createElement('div');row.className='header-row';
    const enabled=document.createElement('input');enabled.type='checkbox';enabled.className='header-enabled';enabled.setAttribute('aria-label','使用此 Header');enabled.checked=rule.enabled!==false;
    const name=document.createElement('input');name.className='header-name';name.placeholder='Header 名称';name.setAttribute('aria-label','Header 名称');name.value=rule.name;
    const value=document.createElement('input');value.className='header-value';value.placeholder='Header 值';value.setAttribute('aria-label','Header 值');value.value=rule.value;
    const remove=document.createElement('button');remove.textContent='×';remove.className='header-remove';remove.setAttribute('aria-label','删除此 Header');
    const appearance=()=>row.classList.toggle('inactive',!enabled.checked);appearance();
    enabled.onchange=()=>{appearance();save();};name.oninput=save;value.oninput=save;remove.onclick=()=>{row.remove();save();};
    row.append(enabled,name,value,remove);rows.append(row);title();return name;
  };
  for(const rule of group.headers?.rules||[])if(rule.operation==='set')addRow(rule);
  add.onclick=()=>addRow().focus();
  controls.append(rows,add,status);details.append(summary,controls);return details;
}
function historyEditor(group){
  const details=document.createElement('details');details.className='session-history';
  const summary=document.createElement('summary');summary.textContent='标签页历史 · '+group.history.length;
  const search=document.createElement('input');search.placeholder='搜索本会话的标题或网址';search.setAttribute('aria-label','搜索本会话历史');
  const list=document.createElement('div');list.className='history-list';
  const draw=()=>{list.replaceChildren();const query=search.value.toLowerCase();
    const entries=group.history.filter(h=>(h.title+' '+h.url).toLowerCase().includes(query)).slice(0,40);
    if(!entries.length){const empty=document.createElement('p');empty.textContent='暂无历史记录';list.append(empty);}
    for(const h of entries){const row=document.createElement('div');row.className='history-item';
      const button=document.createElement('button');button.textContent=h.title||h.url;button.title=h.url;button.onclick=()=>act({type:'history-open',gid:group.id,entry:h.id,active});
      const icon=document.createElement('img');icon.className='history-favicon';icon.alt='';const image=new URL(chrome.runtime.getURL('/_favicon/'));image.searchParams.set('pageUrl',h.url);image.searchParams.set('size','32');icon.src=image.href;icon.onerror=()=>{icon.onerror=null;icon.src='icons/16.png';};
      const text=document.createElement('div');text.className='history-text';
      const domain=document.createElement('div');domain.className='history-domain';domain.textContent=h.domain||new URL(h.url).hostname;
      const caption=document.createElement('small');caption.textContent=(h.kind==='closed'?'已关闭 · ':'最近访问 · ')+new Date(h.at).toLocaleString();
      text.append(button,domain,caption);row.append(icon,text);list.append(row);
    }
  };search.oninput=draw;draw();details.append(summary,search,list);return details;
}
async function refresh(){try{
  [active]=await chrome.tabs.query({active:true,currentWindow:true});
  const result=await call({type:'status',active});current=result.current;
  if(new URL(location.href).searchParams.has('timings')){
    document.body.replaceChildren();
    for(const g of result.groups){
      const title=document.createElement('h3');title.textContent=g.name;document.body.append(title);
      for(const [stage,row] of Object.entries(g.performance||{})){
        const line=document.createElement('p');line.textContent=stage+': '+JSON.stringify(row);document.body.append(line);
      }
      const line=document.createElement('p');line.textContent='cache: '+JSON.stringify(g.cache);document.body.append(line);
    }return;
  }
  $('source').textContent=current?'当前页面属于独立会话分组':'当前网站：'+(/^https?:/.test(active.url||'')?new URL(active.url).hostname:'请切到网站标签页');
  $('create').disabled=!current&&!/^https?:/.test(active.url||'');$('create').textContent=current?'在本组新开原生页面':'新建分组 · 继承当前登录';
  $('name').disabled=!!current;$('name').value=current?result.groups.find(g=>g.id===current)?.name||'':(/^https?:/.test(active.url||'')?new URL(active.url).hostname+' · 新账号':'');
  $('status').textContent=result.error||'';$('list').replaceChildren();
  for(const g of result.groups){
    const group=document.createElement('section');group.className='group';group.dataset.gid=g.id;
    const row=document.createElement('div');row.className='row';const name=document.createElement('span');name.className='name';name.textContent=g.name;
    const open=document.createElement('button');open.textContent=g.tabs.length?'主页':'打开主页';open.onclick=()=>act({type:'open',gid:g.id,active});
    const close=document.createElement('button');close.textContent='关闭保存';close.disabled=!g.tabs.length;close.onclick=()=>act({type:'close',gid:g.id});
    const remove=document.createElement('button');remove.textContent='删除';remove.disabled=!!g.tabs.length;remove.onclick=()=>act({type:'delete',gid:g.id});
    const home=document.createElement('div');home.className='session-home';
    const address=document.createElement('span');address.textContent='主页：'+g.homeUrl;address.title=g.homeUrl;
    const setHome=document.createElement('button');setHome.textContent='将当前页设为主页';setHome.disabled=!/^https?:/.test(active.url||'');
    setHome.onclick=()=>act({type:'set-home',gid:g.id,url:active.url});
    const restore=document.createElement('button');restore.className='restore-window';restore.textContent='恢复上次全部页面'+(g.windowTabs.length?'（'+g.windowTabs.length+'）':'');restore.disabled=!!g.tabs.length||!g.windowTabs.length;
    restore.onclick=()=>act({type:'restore-window',gid:g.id,active});
    const bind=document.createElement('button');bind.className='bind-current';bind.textContent='绑定当前 Chrome 分组';bind.disabled=!!current||!(active.groupId>=0);
    bind.title='修复旧版未绑定分组：请先切到该组内页面，再在原会话下点击此按钮。不会复制普通 Profile 的登录态。';
    bind.onclick=()=>act({type:'bind-group',gid:g.id,active});
    home.append(address,setHome,restore,bind);
    row.append(name,open,close,remove);group.append(row,home,headerEditor(g),historyEditor(g));$('list').append(group);
  }
}catch(error){$('status').textContent=error.message;}}
async function act(message){try{await call(message);await refresh();}catch(error){$('status').textContent=error.message;}}
$('create').onclick=async()=>{try{$('create').disabled=true;$('status').textContent='正在建立原生分组会话…';
  await call(current?{type:'new-tab',gid:current,active}:{type:'create',name:$('name').value,active});
}catch(error){$('status').textContent=error.message;}finally{$('create').disabled=false;}};
refresh();
