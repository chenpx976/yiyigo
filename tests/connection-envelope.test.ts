import test from 'node:test';
import assert from 'node:assert/strict';
import { attachmentRoot, wholeConnectionSection as section } from '../src/connection-envelope';
test('tiny landing/captured endpoints never invert their production cross-section',()=>{
 for(const life of [.002,.01,.03,.1,.3,.7,1])for(const solid of [true,false])for(const length of solid?[1]:[Math.SQRT2,2,3]){
  const root=attachmentRoot(solid)*life;
  let previous=Infinity;
  for(let i=0;i<=200;i++){
   const s=section(root+(length/2-root)*i/200,length,solid,.5,life,1);
   assert.ok(s.width>0 && s.halfHeight>0 && s.centerHeight>s.halfHeight);
   assert.ok(s.width<=previous+1e-10);previous=s.width;
  }
 }
});
test('actual connected material has a broad saddle while virtual necks stay subordinate',()=>{
 const solid=section(.5,1,true);
 assert.ok(solid.width>=.20 && solid.centerHeight+solid.halfHeight>=.22);
 for(const length of [Math.SQRT2,2,3]){
  const virtual=section(length/2,length,false,.7);
  assert.ok(solid.width>virtual.width*6);
  assert.ok(solid.halfHeight>virtual.halfHeight*4);
 }
});
