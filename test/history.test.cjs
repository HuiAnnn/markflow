const {test}=require('node:test'),assert=require('node:assert/strict'),History=require('../renderer/history.js');
test('document undo coalesces input but keeps mode boundaries and redo across saves',()=>{
 const h=new History('original');h.record('a',1000);h.record('ab',1100);h.boundary();h.record('abc',1200);
 assert.equal(h.move(-1),'ab');assert.equal(h.move(-1),'original');assert.equal(h.move(1),'ab');assert.equal(h.move(1),'abc');assert.equal(h.move(1),null);
});
test('editing after undo drops redo, and resetting a document drops prior history',()=>{
 const h=new History('first');h.record('second');h.move(-1);h.record('replacement');assert.equal(h.move(1),null);h.reset('other file');assert.equal(h.move(-1),null);
});
