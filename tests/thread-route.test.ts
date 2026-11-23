import test from 'node:test';
import assert from 'node:assert/strict';
import {threadClearance} from '../src/thread-route';
import {wholeConnectionDistance} from '../src/connection-envelope';
test('straight jumps keep short clear windows at each intervening intersection',()=>{
 for(const length of [2,3])for(let x=1;x<length;x++){
  assert.equal(threadClearance(x,length),.085);
  for(const z of [.01,.03,.08,.12])assert.ok(wholeConnectionDistance([x,0,z],{a:[0,0],b:[length,0],solid:false})>0);
 }
});
test('virtual geometry is symmetric about its straight axis and has no lateral route',()=>{
 for(const length of [Math.SQRT2,2,3])for(let x=.45;x<length-.45;x+=.07)for(const y of [.02,.06,.12]){
  const edge={a:[0,0] as [number,number],b:[length,0] as [number,number],solid:false};
  assert.ok(Math.abs(wholeConnectionDistance([x,y,.04],edge)-wholeConnectionDistance([x,-y,.04],edge))<1e-12);
 }
 assert.equal(threadClearance(.5,Math.SQRT2),-1);
});
