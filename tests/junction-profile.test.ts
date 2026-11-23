import test from 'node:test';
import assert from 'node:assert/strict';
import {shoulderCrowding} from '../src/junction-profile';
const direction=(angle:number):[number,number]=>[Math.cos(angle),Math.sin(angle)];
const pull=(angle:number,visibility=1)=>({axis:direction(angle),visibility});
test('junctions distinguish a crowded fan from opposing or sparse pulls',()=>{
 const axis: [number,number]=[1,0];
 assert.equal(shoulderCrowding(axis,[pull(0)],1),0);
 assert.equal(shoulderCrowding(axis,[pull(0),pull(Math.PI)],1),0);
 const right=shoulderCrowding(axis,[pull(0),pull(Math.PI/2)],1);
 const close=shoulderCrowding(axis,[pull(0),pull(Math.PI/4)],1);
 assert.ok(right>0&&close>right+.4);
});
test('angular shoulder allocation is rotation invariant and continuous on undo',()=>{
 for(const rotation of [0,.3,1.7,3.1]){
  const expected=shoulderCrowding(direction(0),[pull(0),pull(.7),pull(-1.2)],1);
  assert.ok(Math.abs(shoulderCrowding(direction(rotation),[pull(rotation),pull(rotation+.7),pull(rotation-1.2)],1)-expected)<1e-12);
 }
 let previous=0;
 for(let i=0;i<=1000;i++){
  const current=shoulderCrowding(direction(0),[pull(0),pull(.7,i/1000)],1);
  assert.ok(current>=previous&&current-previous<.003);
  previous=current;
 }
});
test('angular moment kernel equals direct neighbouring-sector competition',()=>{
 const angles=[0,.7,1.4,2.8,3.7,5.2],weights=[1,.5,.7,.2,1,.8];
 for(let index=0;index<angles.length;index++){
  const axis=direction(angles[index]);
  let mass=0,x=0,y=0,x2=0,y2=0;
  angles.forEach((a,i)=>{mass+=weights[i];x+=weights[i]*Math.cos(a);y+=weights[i]*Math.sin(a);x2+=weights[i]*Math.cos(2*a);y2+=weights[i]*Math.sin(2*a)});
  const energy=.375*mass+.5*(axis[0]*x+axis[1]*y)+.125*(Math.cos(2*angles[index])*x2+Math.sin(2*angles[index])*y2)-weights[index];
  const t=Math.max(0,Math.min(1,(energy-.12)/.93));
  assert.ok(Math.abs(t*t*(3-2*t)-shoulderCrowding(axis,angles.map((a,i)=>pull(a,weights[i])),weights[index]))<1e-12);
 }
});
