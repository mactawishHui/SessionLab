import test from 'node:test';
import assert from 'node:assert/strict';
import {SessionVault} from '../extension/vault.js';

const password='fictitious-password-123';
const initialGroups=[{id:'localhost-fixture',name:'Fixture',url:'http://localhost/',cookies:[],local:{},sessions:{}}];
let instance=0;
function area(initial={}){
  return {data:structuredClone(initial),async setAccessLevel(){},
    async get(keys){return Object.fromEntries((Array.isArray(keys)?keys:[keys]).filter(k=>Object.hasOwn(this.data,k)).map(k=>[k,structuredClone(this.data[k])]));},
    async set(values){Object.assign(this.data,structuredClone(values));},
    async remove(key){delete this.data[key];}};
}
function event(){return {listeners:[],addListener(fn){this.listeners.push(fn);}};}
function gate(){let entered,release;return {entered:new Promise(r=>entered=r),wait:new Promise(r=>release=r),signal:()=>entered(),release:()=>release()};}
async function background(local,session=area()){
  const onMessage=event();let businessReads=0;
  globalThis.chrome={
    storage:{local,session},
    runtime:{id:'fixture-extension',getURL:path=>'chrome-extension://fixture-extension/'+path,onMessage},
    declarativeNetRequest:{async getSessionRules(){return [];},async updateSessionRules(){}},
    tabs:{onRemoved:event(),onUpdated:event(),onCreated:event(),async query(){return [];},async get(){businessReads++;throw Error('Unexpected business read');}},
    tabGroups:{onRemoved:event()},
    debugger:{onEvent:event(),onDetach:event()},
    webRequest:{onHeadersReceived:event(),onBeforeRedirect:event()}
  };
  await import('../extension/background.js?background-vault-test='+ ++instance);
  const send=message=>new Promise(resolve=>{
    const kept=onMessage.listeners[0](message,{id:chrome.runtime.id,url:chrome.runtime.getURL('popup.html')},resolve);
    assert.equal(kept,true);
  });
  // The status reply also waits for the actual worker's startup promise.
  await send({type:'status'});
  return {send,get businessReads(){return businessReads;}};
}

for(const mode of ['setup','unlock'])test(mode+' keeps business access locked until groups are published',{timeout:10000},async()=>{
  const local=area({nativeGroups:initialGroups}),session=area();
  if(mode==='unlock')await new SessionVault(local,area()).setup(password);
  const app=await background(local,session),blocked=gate();
  if(mode==='setup'){
    const remove=local.remove.bind(local);
    local.remove=async key=>{blocked.signal();await blocked.wait;return remove(key);};
  }else{
    const set=session.set.bind(session);
    session.set=async values=>{if(values.nativeVaultSession){blocked.signal();await blocked.wait;}return set(values);};
  }
  const transition=app.send({type:'vault-'+mode,password,consent:true});
  await blocked.entered;
  try{
    const status=await app.send({type:'status'});
    assert.equal(status.ok,true);assert.equal(status.result.vault.unlocked,false);assert.deepEqual(status.result.groups,[]);
    for(const message of [{type:'headers',gid:initialGroups[0].id,config:{rules:[]}},{type:'create',active:{id:123},name:'New fixture'}]){
      const response=await app.send(message);assert.equal(response.ok,false);assert.match(response.error,/主密码解锁/);
    }
    assert.equal(app.businessReads,0);
  }finally{blocked.release();}
  assert.equal((await transition).ok,true);
  const status=await app.send({type:'status'});
  assert.equal(status.result.vault.unlocked,true);assert.deepEqual(status.result.groups.map(g=>g.id),initialGroups.map(g=>g.id));
  assert.deepEqual(await new SessionVault(local,area()).unlock(password),initialGroups);
});

test('already unlocked reentry preserves live changes while their disk write is pending',{timeout:10000},async()=>{
  const local=area({nativeGroups:initialGroups});
  const app=await background(local);
  assert.equal((await app.send({type:'vault-setup',password,consent:true})).ok,true);
  const blocked=gate(),set=local.set.bind(local);
  local.set=async values=>{if(values.nativeVault){blocked.signal();await blocked.wait;}return set(values);};
  const config={rules:[{enabled:true,name:'X-Fixture',operation:'set',value:'fictional-new-value'}]};
  const changing=app.send({type:'headers',gid:initialGroups[0].id,config});
  await blocked.entered;
  try{
    assert.equal((await app.send({type:'vault-unlock',password})).ok,true);
    const status=await app.send({type:'status'});
    assert.deepEqual(status.result.groups[0].headers,config);
  }finally{blocked.release();}
  assert.equal((await changing).ok,true);
  const restored=await new SessionVault(local,area()).unlock(password);
  assert.deepEqual(restored[0].headers,config);
});
