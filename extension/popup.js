const $=id=>document.getElementById(id);let active,current,vaultState;
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
async function refresh(){try{
  [active]=await chrome.tabs.query({active:true,currentWindow:true});
  const result=await call({type:'status',active});current=result.current;vaultState=result.vault;
  if(showVault(vaultState))return;
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
  $('status').textContent=result.vault?.legacy?'旧版明文副本尚未清理完成。请关闭保存分组后重新加载并解锁重试；当前磁盘保护尚不完整。':result.error||'';$('list').replaceChildren();
  for(const g of result.groups){
    const group=document.createElement('section');group.className='group';group.dataset.gid=g.id;
    const row=document.createElement('div');row.className='row';const name=document.createElement('span');name.className='name';name.textContent=g.name;
    const open=document.createElement('button');open.textContent=g.tabs.length?'定位':'打开';open.onclick=()=>act({type:'open',gid:g.id,active});
    const close=document.createElement('button');close.textContent='关闭保存';close.disabled=!g.tabs.length;close.onclick=()=>act({type:'close',gid:g.id});
    const remove=document.createElement('button');remove.textContent='删除';remove.disabled=!!g.tabs.length;remove.onclick=()=>act({type:'delete',gid:g.id});
    row.append(name,open,close,remove);group.append(row,headerEditor(g));$('list').append(group);
  }
}catch(error){$('status').textContent=error.message;}}
async function act(message){try{await call(message);await refresh();}catch(error){$('status').textContent=error.message;}}
$('create').onclick=async()=>{try{$('create').disabled=true;$('status').textContent='正在建立原生分组会话…';
  await call(current?{type:'new-tab',gid:current,active}:{type:'create',name:$('name').value,active});
}catch(error){$('status').textContent=error.message;}finally{$('create').disabled=false;}};
function showVault(state){
  const locked=!state?.unlocked,setup=!state?.configured;
  $('vault-panel').hidden=!locked;$('session-controls').hidden=locked;
  if(!locked)return false;
  $('source').textContent='会话已锁定';$('list').replaceChildren();
  $('vault-title').textContent=setup?'设置主密码':'解锁已保存的会话';
  $('vault-description').textContent=setup?(state?.legacy?'检测到旧版会话，设置主密码后将加密迁移。':'主密码保护本机保存的 Cookie、站点存储和 Header。'):'请输入主密码。浏览器重启或扩展重新加载后需要再次解锁。';
  $('vault-confirm-area').hidden=!setup;$('vault-confirm').required=setup;
  $('vault-consent-area').hidden=!setup;$('vault-consent').required=setup;
  $('vault-password').autocomplete=setup?'new-password':'current-password';
  $('vault-submit').textContent=setup?'设置主密码并加密':'解锁';return true;
}
$('vault-form').onsubmit=async event=>{
  event.preventDefault();const setup=!vaultState?.configured,password=$('vault-password').value;
  $('vault-error').textContent='';
  if(setup&&password!==$('vault-confirm').value){$('vault-error').textContent='两次输入的主密码不一致';return;}
  $('vault-submit').disabled=true;
  try{
    await call({type:setup?'vault-setup':'vault-unlock',password,consent:$('vault-consent').checked});
    $('vault-password').value='';$('vault-confirm').value='';await refresh();
  }catch(error){$('vault-error').textContent=error.message;}
  finally{$('vault-password').value='';$('vault-confirm').value='';$('vault-submit').disabled=false;}
};
refresh();
