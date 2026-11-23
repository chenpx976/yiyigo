import test from 'node:test';
import assert from 'node:assert/strict';
import { wholeConnectionDistance, wholeConnectionSection } from '../src/connection-envelope';
test('ordinary jumps are continuous and narrow at empty intersections, without punched gaps',()=>{
 for(const length of [2,3])for(let x=.46;x<=length-.46;x+=.02){
  const section=wholeConnectionSection(x,length,false,.6);
  const edge={a:[0,0] as [number,number],b:[length,0] as [number,number],solid:false,strength:.6};
  assert.ok(wholeConnectionDistance([x,0,section.centerHeight],edge)<0);
  if(Math.abs(x-Math.round(x))<.03)assert.ok(section.width<.045,'an empty point must not acquire a stone-like node');
 }
});
test('virtual geometry is symmetric about its direct axis and never detours sideways',()=>{
 for(const length of [Math.SQRT2,2,3])for(let x=.45;x<length-.45;x+=.07)for(const y of [.02,.06,.12]){
  const edge={a:[0,0] as [number,number],b:[length,0] as [number,number],solid:false};
  assert.ok(Math.abs(wholeConnectionDistance([x,y,.04],edge)-wholeConnectionDistance([x,-y,.04],edge))<1e-12);
 }
});
