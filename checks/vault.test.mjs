import test from 'node:test';
import assert from 'node:assert/strict';
import {SessionVault} from '../extension/vault.js';
const password='fictitious-password-123';
const groups=[{id:'localhost-fixture',cookies:[{name:'fixture',value:'fictional-secret-cookie'}],headers:[{name:'X-Fixture',value:'fictional-header'}]}];
function area(initial={}){return {data:structuredClone(initial),async get(keys){return Object.fromEntries((Array.isArray(keys)?keys:[keys]).filter(k=>Object.hasOwn(this.data,k)).map(k=>[k,structuredClone(this.data[k])]));},async set(values){Object.assign(this.data,structuredClone(values));},async remove(keys){for(const key of Array.isArray(keys)?keys:[keys])delete this.data[key];}};}
function fixture(initial={}){const local=area(initial),session=area();return {local,session,vault:typeof SessionVault==='function'?new SessionVault(local,session):null};}
test('vault module exports SessionVault',()=>assert.equal(typeof SessionVault,'function'));
test('setup migrates legacy data and persists only ciphertext; cold start locks',async()=>{
 const {local,session,vault}=fixture({nativeGroups:groups});assert.deepEqual(await vault.initialize(),null);assert.deepEqual(vault.status(),{configured:false,unlocked:false,legacy:true});
 assert.deepEqual(await vault.setup(password),groups);assert.deepEqual(vault.status(),{configured:true,unlocked:true,legacy:false});
 assert.deepEqual(Object.keys(local.data),['nativeVault']);const disk=JSON.stringify(local.data);
 for(const secret of [password,'fictional-secret-cookie','fictional-header',session.data.nativeVaultSession.key])assert.ok(!disk.includes(secret));
 assert.equal(local.data.nativeVault.iterations,600000);assert.equal(atob(local.data.nativeVault.salt).length,16);assert.equal(atob(local.data.nativeVault.iv).length,12);
 const cold=new SessionVault(local,area());assert.equal(await cold.initialize(),null);assert.deepEqual(await cold.unlock(password),groups);
});
test('session key restores worker state and binds to the current encrypted envelope',async()=>{
 const {local,session,vault}=fixture({nativeGroups:groups});await vault.initialize();await vault.setup(password);
 assert.deepEqual(await new SessionVault(local,session).initialize(),groups);
 const previous=structuredClone(session.data);await vault.save([{id:'changed'}]);
 const stale=new SessionVault(local,area(previous));assert.equal(await stale.initialize(),null);assert.equal(stale.status().unlocked,false);
 session.data.nativeVaultSession.key=btoa('x'.repeat(32));assert.equal(await new SessionVault(local,session).initialize(),null);
});
test('wrong password and authenticated ciphertext tampering fail without changing local data',async()=>{
 const {local,vault}=fixture({nativeGroups:groups});await vault.initialize();await vault.setup(password);
 const locked=new SessionVault(local,area());await locked.initialize();const before=structuredClone(local.data);
 await assert.rejects(locked.unlock('wrong-password-long'),/Unable to unlock/);assert.deepEqual(local.data,before);assert.equal(locked.status().unlocked,false);
 const bytes=Uint8Array.from(atob(local.data.nativeVault.ciphertext),c=>c.charCodeAt(0));bytes[0]^=1;local.data.nativeVault.ciphertext=btoa(String.fromCharCode(...bytes));
 await assert.rejects(locked.unlock(password),/Unable to unlock/);assert.equal(locked.status().unlocked,false);
});
test('fresh nonces and call-time snapshots serialize saves even after a failed write',async()=>{
 const {local,vault}=fixture();await vault.initialize();await vault.setup(password);const ivs=[local.data.nativeVault.iv];
 const original=local.set.bind(local);let active=0,max=0,calls=0;
 local.set=async values=>{active++;max=Math.max(max,active);await new Promise(r=>setTimeout(r,15));try{if(++calls===2)throw Error('fixture disk failure');await original(values);ivs.push(values.nativeVault.iv);}finally{active--;}};
 const snapshot=[{id:'first'}],first=vault.save(snapshot);snapshot[0].id='mutated';
 const failed=vault.save([{id:'second'}]);const last=vault.save([{id:'last'}]);
 await first;await assert.rejects(failed,/fixture disk failure/);await last;assert.equal(max,1);assert.equal(new Set(ivs).size,ivs.length);
 const cold=new SessionVault(local,area());await cold.initialize();assert.deepEqual(await cold.unlock(password),[{id:'last'}]);
});
test('failed migration write preserves legacy and retries safely',async()=>{
 const {local,vault}=fixture({nativeGroups:groups});await vault.initialize();const original=local.set.bind(local);local.set=async()=>{throw Error('fixture write failure');};
 await assert.rejects(vault.setup(password));assert.deepEqual(local.data,{nativeGroups:groups});assert.equal(vault.status().configured,false);
 local.set=original;assert.deepEqual(await vault.setup(password),groups);
});
test('encrypted authority survives failed legacy cleanup and is never replaced by setup',async()=>{
 const {local,vault}=fixture({nativeGroups:groups});await vault.initialize();local.remove=async()=>{throw Error('fixture removal failure');};
 assert.deepEqual(await vault.setup(password),groups);assert.ok(local.data.nativeGroups);const envelope=structuredClone(local.data.nativeVault);
 const cold=new SessionVault(local,area());await cold.initialize();await assert.rejects(cold.setup(password));assert.deepEqual(local.data.nativeVault,envelope);
 local.data.nativeGroups=[{id:'stale'}];local.remove=area().remove.bind(local);assert.deepEqual(await cold.unlock(password),groups);assert.ok(!Object.hasOwn(local.data,'nativeGroups'));
});
test('session caching failure preserves encrypted data and requires unlock after recycle',async()=>{
 const {local,session,vault}=fixture({nativeGroups:groups});await vault.initialize();session.set=async()=>{throw Error('fixture session quota');};
 assert.deepEqual(await vault.setup(password),groups);assert.ok(local.data.nativeVault);assert.ok(!local.data.nativeGroups);assert.equal(await new SessionVault(local,session).initialize(),null);
});
test('rejects malformed envelopes, invalid group snapshots and password bounds without overwrites',async()=>{
 for(const nativeVault of [{version:99},{version:1,ciphertext:'!'},null]){
  const {local,vault}=fixture({nativeVault,nativeGroups:groups});assert.equal(await vault.initialize(),null);assert.equal(vault.status().configured,true);await assert.rejects(vault.setup(password));await assert.rejects(vault.unlock(password),/Unable to unlock/);assert.deepEqual(local.data.nativeGroups,groups);
 }
 const {local,vault}=fixture();await vault.initialize();await assert.rejects(vault.save(groups));await assert.rejects(vault.setup('short'));await assert.rejects(vault.setup('x'.repeat(1025)));assert.deepEqual(local.data,{});
 await vault.setup(password);const before=structuredClone(local.data);for(const invalid of [{},[null],[{id:'x',value:BigInt(1)}]])await assert.rejects(vault.save(invalid));assert.deepEqual(local.data,before);
});
test('setup reentry is serialized and cannot replace an existing encrypted vault',async()=>{
 const {local,vault}=fixture({nativeGroups:groups});const first=vault.setup(password),second=vault.setup('other-fictional-password');
 assert.deepEqual(await first,groups);await assert.rejects(second,/already configured/);
 const cold=new SessionVault(local,area());assert.deepEqual(await cold.unlock(password),groups);
});
test('interruption during read-back keeps legacy recoverable until authenticated unlock',async()=>{
 const {local,vault}=fixture({nativeGroups:groups});await vault.initialize();const get=local.get.bind(local);let interrupt=false;
 const set=local.set.bind(local);local.set=async values=>{await set(values);interrupt=true;};
 local.get=async keys=>{if(interrupt)throw Error('fixture interrupted verification');return get(keys);};
 await assert.rejects(vault.setup(password),/interrupted/);assert.ok(local.data.nativeVault);assert.deepEqual(local.data.nativeGroups,groups);
 local.get=get;const cold=new SessionVault(local,area());assert.equal(await cold.initialize(),null);assert.deepEqual(await cold.unlock(password),groups);assert.ok(!local.data.nativeGroups);
});
test('session restore removes stale legacy only after authentication succeeds',async()=>{
 const {local,session,vault}=fixture({nativeGroups:groups});await vault.setup(password);local.data.nativeGroups=[{id:'stale'}];
 const invalid=area(structuredClone(session.data));invalid.data.nativeVaultSession.key=btoa('z'.repeat(32));assert.equal(await new SessionVault(local,invalid).initialize(),null);assert.ok(local.data.nativeGroups);
 assert.deepEqual(await new SessionVault(local,session).initialize(),groups);assert.ok(!local.data.nativeGroups);
});
test('save uses its call-time immutable snapshot',async()=>{
 const {local,vault}=fixture();await vault.setup(password);const input=[{id:'before',cookies:[]}];const saving=vault.save(input);input[0].id='after';input[0].cookies.push({name:'later'});await saving;
 assert.deepEqual(await new SessionVault(local,area()).unlock(password),[{id:'before',cookies:[]}]);
});
test('metadata and IV tampering cannot unlock or erase the encrypted record',async()=>{
 const {local,vault}=fixture({nativeGroups:groups});await vault.setup(password);const original=structuredClone(local.data.nativeVault);
 for(const patch of [{version:2},{iterations:1},{kdf:'none'},{salt:btoa('q'.repeat(16))},{iv:btoa('q'.repeat(12))},{iv:'a'.repeat(100000)},{ciphertext:'not base64'}]){
  local.data.nativeVault={...original,...patch};const before=structuredClone(local.data);const cold=new SessionVault(local,area());assert.equal(await cold.initialize(),null);await assert.rejects(cold.unlock(password),/Unable to unlock/);assert.deepEqual(local.data,before);
 }
});
test('large valid snapshots remain decryptable without regex stack exhaustion',async()=>{
 const {local,vault}=fixture();await vault.setup(password);const large=[{id:'large-fixture',body:'f'.repeat(1024*1024)}];await vault.save(large);
 const restored=await new SessionVault(local,area()).unlock(password);assert.equal(restored[0].body.length,1024*1024);
});
test('save retries pending plaintext legacy cleanup after encryption succeeds',async()=>{
 const {local,vault}=fixture({nativeGroups:groups});const remove=local.remove.bind(local);local.remove=async()=>{throw Error('fixture cleanup failure');};
 await vault.setup(password);assert.deepEqual(vault.status(),{configured:true,unlocked:true,legacy:true});assert.ok(local.data.nativeGroups);
 await vault.save([{id:'first-save'}]);assert.equal(vault.status().legacy,true);assert.ok(local.data.nativeGroups);
 local.remove=remove;await vault.save([{id:'cleaned-save'}]);assert.deepEqual(vault.status(),{configured:true,unlocked:true,legacy:false});assert.ok(!local.data.nativeGroups);
 assert.deepEqual(await new SessionVault(local,area()).unlock(password),[{id:'cleaned-save'}]);
});
