import test from 'node:test';
import assert from 'node:assert/strict';
import {envelopeSection} from '../src/connection-envelope';
import {stoneProfile} from '../src/stone-profile';
test('prototype virtual attachments keep positive thickness below unchanged stone crowns',()=>{
 for(const life of [.002,.05,.3,1])for(const length of [Math.SQRT2,2,3])for(const strength of [0,.3,1]){
  const localLength=length/life;
  let previous=Infinity;
  for(let i=0;i<=200;i++){
   const s=envelopeSection(.25+(localLength/2-.25)*i/200,localLength,false,strength);
   assert.ok(s.width>0&&s.halfHeight>0&&s.centerHeight>s.halfHeight);
   assert.ok(s.centerHeight+s.halfHeight<stoneProfile.height*.6,'no material over the rounded crown');
   assert.ok(s.width<=previous+1e-12,'no extra shoulder bulge');previous=s.width;
  }
 }
});
test('prototype virtual attachments have a short broad root and smooth thin shared waist',()=>{
 for(const length of [Math.SQRT2,2,3]){
  const a=envelopeSection(.25,length,false,.7),b=envelopeSection(length/2,length,false,.7);
  assert.ok(a.width>b.width*5);assert.ok(a.centerHeight>b.centerHeight*2);
  const near=envelopeSection(length/2-1e-5,length,false,.7);
  assert.ok(Math.abs(near.width-b.width)<1e-7);
 }
});
