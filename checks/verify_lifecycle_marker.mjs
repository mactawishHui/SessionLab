// Fictitious IDs only: the durable marker must round-trip while staying outside the display label.
import assert from 'node:assert/strict';
import {marker,groupTitle,markedId,displayTitle,migrate} from '../extension/lifecycle.js';
const ids=['0123456789abcdef0123456789abcdef','ffffffffffffffff0000000000000000'];
for(const id of ids){
 const g={id,name:'Clean 中文 name'};
 const suffix=marker(g);assert.equal(suffix.length,34);assert.match(suffix,/^\u2063[\ufe00-\ufe0f]{32}\u2063$/);
 assert.equal(markedId(groupTitle(g)),id);assert.equal(displayTitle(groupTitle(g)),g.name);
 assert.equal(groupTitle(g).replace(/[\u2063\ufe00-\ufe0f]/g,''),g.name);
 assert.equal(markedId('Legacy · SL:'+id),id);assert.equal(displayTitle('Legacy · SL:'+id),'Legacy');
 assert.equal(markedId('Corrupt\u2063'+suffix.slice(1,-2)+'\u2063'),undefined);
}
const old=[{id:'v',kind:'visit',url:'https://example.test/old'},{id:'c',kind:'closed',url:'https://example.test/closed',session:{'https://example.test':{slot:'fake'}}}];
const g=migrate({id:ids[0],url:'https://example.test/',history:structuredClone(old)});
assert.deepEqual(g.legacyHistory,old);assert.equal(g.history.length,1);assert.equal(g.history[0].domain,'example.test');assert.ok(g.history[0].tabKey);
const migrated=structuredClone(g);migrate(g);assert.deepEqual(g,migrated);
console.log('PASS: hidden markers round-trip, legacy titles remain readable, malformed markers fail, and history migration archives old entries once');
