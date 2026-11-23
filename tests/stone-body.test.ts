import test from 'node:test';
import assert from 'node:assert/strict';
import { stoneProfile as stone, ellipsoidDistance, stretchedSection, stretchedDistance, attachmentStart } from '../src/stone-profile';
import { Go } from '../src/engine';
import { createLivingSurface } from '../src/living-stones';
import { Mesh, ShaderMaterial } from 'three';

test('attachments preserve the rigid crown, rear and side silhouette',()=>{
 for(const length of [1,Math.SQRT2,2,3])for(const solid of [true,false]){
  for(const [x,y,z] of [[.25,0,.30],[-.448,0,stone.height/2],[0,.455,stone.height/2],[0,0,stone.height]]){
   const original=ellipsoidDistance(x,y,z-stone.height/2,stone.radius,stone.radius,stone.height/2);
   assert.ok(Math.abs(stretchedDistance(x,y,z,length,solid)-original)<1e-8);
  }
  assert.ok(stretchedDistance(length/2,0,stretchedSection(length/2,length,solid).centerHeight,length,solid)<0);
 }
});
test('attachment matches the rigid side section and its tangent without a seam',()=>{
 for(const solid of [true,false])for(const length of solid?[1]:[Math.SQRT2,2,3])for(const strength of [.2,.5,.9]){
  const root=attachmentStart(solid),e=1e-6;
  const width=Math.sqrt(stone.radius**2-root**2),slope=-root/width;
  const halfHeight=stone.height/2*width/stone.radius;
  const a=stretchedSection(root,length,solid,strength),b=stretchedSection(root+e,length,solid,strength);
  assert.ok(Math.abs(a.width-width)<1e-9);
  assert.ok(Math.abs(a.halfHeight-halfHeight)<1e-9);
  assert.ok(Math.abs(a.centerHeight-stone.height/2)<1e-9);
  assert.ok(Math.abs((b.width-a.width)/e-slope)<.001);
  assert.ok(Math.abs((b.centerHeight+b.halfHeight-a.centerHeight-a.halfHeight)/e-slope*stone.height/2/stone.radius)<.001);
  assert.ok(Math.abs((b.centerHeight-b.halfHeight-a.centerHeight+a.halfHeight)/e+slope*stone.height/2/stone.radius)<.001);
  for(let i=0;i<=100;i++){
   const section=stretchedSection(root+(length/2-root)*i/100,length,solid,strength);
   assert.ok(section.halfHeight>0,'long jumps must never invert their section');
   assert.ok(section.centerHeight-section.halfHeight>0,'attachment stays above the board');
   assert.ok(section.centerHeight+section.halfHeight<.29,'attachment cannot invade the crown');
  }
 }
});
test('attachment sections taper monotonically to a smooth, volumetric waist',()=>{
 for(const length of [Math.SQRT2,2,3]){
  for(const strength of [.2,.5,.9]){
   let previous: number=stone.radius;
   for(let i=0;i<=100;i++){
    const s=stretchedSection(length*.5*i/100,length,false,strength);
    assert.ok(s.width<=previous+1e-9);
    assert.ok(s.halfHeight>0&&s.centerHeight>=s.halfHeight);
    previous=s.width;
   }
   const mid=stretchedSection(length/2,length,false,strength);
   const near=stretchedSection(length/2-1e-5,length,false,strength);
   assert.ok(Math.abs((mid.width-near.width)/1e-5)<.001);
   assert.ok(mid.width<stone.radius*.15);
  }
 }
});
test('edge records describe attachments; only nodes own visible volume and both passes share it',()=>{
 const game=new Go(19);game.board[180]=game.board[182]=1;
 const live=createLivingSurface(game,[],false,0,true,new Map(),new Map());
 assert.equal(live.mesh.children.length,1);
 const mesh=live.mesh.children[0] as Mesh;
 const color=mesh.material as ShaderMaterial,shadow=mesh.customDepthMaterial as ShaderMaterial;
 assert.equal(color.fragmentShader,shadow.fragmentShader);
 assert.equal(color.uniforms.uData,shadow.uniforms.uData);
 const data=color.uniforms.uData.value.image.data as Float32Array;
 assert.equal(data[10],1,'first stone has its own pull adjacency');
 assert.ok(data[data[9]*4]>=0,'pull record exists in packed texture');
 live.setTime(1.35);assert.equal(shadow.uniforms.uTime.value,1.35);
 live.dispose();
});

test('virtual material has broad shoulders, a flattened waist and a lowered centre',()=>{
 for(const length of [Math.SQRT2,2,3])for(const strength of [.2,.5,.9]){
  const root=attachmentStart(false),span=length/2-root;
  const shoulder=stretchedSection(root+span*.4,length,false,strength);
  const waist=stretchedSection(length/2,length,false,strength);
  assert.ok(shoulder.width>waist.width*1.3 && stretchedSection(root,length,false,strength).width>waist.width*4,'narrow shoulders must still taper from a broad attached root to a thin waist');
  assert.ok(shoulder.centerHeight>waist.centerHeight+.025,'centre visibly sags below shoulders');
  assert.ok(waist.halfHeight<waist.width*.6,'waist is a thin sheet with real thickness');
 }
});

test('landing roots remain attached to the scaled body throughout growth',()=>{
 for(const life of [.05,.2,.5,.8,1]){
  const root=attachmentStart(true),s=stretchedSection(root,1/life,true);
  const physicalX=root*life,physicalWidth=s.width*life;
  const bodyWidth=Math.sqrt((stone.radius*life)**2-physicalX**2);
  assert.ok(Math.abs(physicalWidth-bodyWidth)<1e-9);
  assert.ok(Math.abs(s.centerHeight*life-stone.height*.5*life)<1e-9);
  assert.ok(Math.abs(s.halfHeight*life-stone.height*.5*bodyWidth/stone.radius)<1e-9);
 }
});

test('tiny landing/captured endpoints cannot invert an elongated attachment section',()=>{
 for(const life of [.002,.01,.03,.1,.3,.7,1])for(const solid of [true,false])for(const length of solid?[1]:[Math.SQRT2,2,3]){
  const localLen=length/life,root=attachmentStart(solid);
  for(let i=0;i<=200;i++){
   const section=stretchedSection(root+(localLen/2-root)*i/200,localLen,solid,.5);
   assert.ok(section.halfHeight>0,'no reversed vertical radius / spiked implicit surface');
   assert.ok(section.width>0&&section.centerHeight-section.halfHeight>=0);
  }
 }
});


test('crowded shoulders contract without moving the body seam or shared waist',()=>{
 for(const length of [Math.SQRT2,2,3])for(const strength of [.2,.5,.9]){
  const root=attachmentStart(false),span=length/2-root;
  for(const crowding of [0,.25,.5,.75,1]){
   assert.deepEqual(stretchedSection(root,length,false,strength,crowding),stretchedSection(root,length,false,strength));
   const mid=stretchedSection(length/2,length,false,strength,crowding),original=stretchedSection(length/2,length,false,strength);
   assert.ok(Math.abs(mid.width-original.width)<1e-12);
   for(let i=1;i<100;i++){
    const x=root+span*i/100,s=stretchedSection(x,length,false,strength,crowding),wide=stretchedSection(x,length,false,strength);
    assert.ok(s.width<=wide.width&&s.halfHeight>0);
    assert.ok(s.centerHeight-s.halfHeight>0);
    assert.ok(s.centerHeight+s.halfHeight<=wide.centerHeight+wide.halfHeight);
   }
  }
  const x=root+span/2;
  assert.ok(stretchedSection(x,length,false,strength,1).width<stretchedSection(x,length,false,strength).width*.6);
 }
 // Real connected stones retain their existing solid material.
 assert.deepEqual(stretchedSection(.45,1,true,1,1),stretchedSection(.45,1,true,1,0));
});
