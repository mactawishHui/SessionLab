// Fictitious Chrome model: a pending native-close batch must not overwrite an explicit close.
import assert from 'node:assert/strict';
import {lifecycle,migrate} from '../extension/lifecycle.js';
const event=()=>({addListener(){},removeListener(){}});
const tabs=new Map(),bindings=new Map(),groups=new Map();
const gid='11111111111111111111111111111111',g=migrate({id:gid,name:'A',url:'http://example.test/home',sessions:{},cookies:[]});groups.set(gid,g);
let life;
globalThis.chrome={runtime:{getURL:p=>'chrome-extension://fictitious/'+p},storage:{session:{set:async()=>{},get:async()=>({})}},declarativeNetRequest:{getSessionRules:async()=>[],updateSessionRules:async()=>{}},tabs:{query:async()=>[...tabs.values()],get:async id=>tabs.get(id),remove:async id=>{tabs.delete(id);bindings.delete(id);life.removed(id)},onUpdated:event(),onCreated:event(),onMoved:event(),onDetached:event(),onAttached:event(),onActivated:event(),onRemoved:event()},tabGroups:{onMoved:event(),onUpdated:event()},webRequest:{onBeforeRequest:event(),onCompleted:event(),onErrorOccurred:event()}};
life=lifecycle({groups,bindings,groupLinks:new Map(),moving:new Set(),initializing:new Set(),persist:async()=>{},schedulePersist:()=>{},saveBindings:async()=>{},guard:async()=>{},configure:async()=>{},command:async()=>{},open:async()=>{},moveIntoGroup:async()=>{},reportError:console.error,ready:async()=>{}});
function add(id){const t={id,url:'http://example.test/'+id,title:'tab'+id,index:id,active:true};tabs.set(id,t);bindings.set(id,{gid});life.track(t,gid)}
add(1);add(2);
tabs.delete(1);bindings.delete(1);life.removed(1); // starts native-close batching
add(3); // new page within 180ms batching period
await life.close(gid);
assert.deepEqual(g.closedWindowTabs.map(p=>p.url),['http://example.test/2','http://example.test/3']);
await new Promise(r=>setTimeout(r,220));
assert.deepEqual(g.closedWindowTabs.map(p=>p.url),['http://example.test/2','http://example.test/3']);
console.log('PASS: explicit close snapshot survives an earlier native-close batch timer');

// Copied/native-restored pages may carry an existing logical key. Each actual
// live tab must still have a distinct history identity.
const first={id:101,url:'http://example.test/same',title:'one',index:0};
const second={id:102,url:'http://example.test/same',title:'two',index:1};
bindings.set(101,{gid,pageKey:'copied-key'});bindings.set(102,{gid,pageKey:'copied-key'});
life.track(first,gid,true);life.track(second,gid,true);
assert.notEqual(life.pages.get(101).key,life.pages.get(102).key);
assert.equal(g.history.filter(h=>h.url==='http://example.test/same').length,2);
console.log('PASS: two real live tabs cannot collapse into one history identity after copied/native metadata');
