import test from 'node:test';
import assert from 'node:assert/strict';
import { stoneProfile as stone, ellipsoidDistance } from '../src/stone-profile';
import { attachmentRoot, wholeConnectionSection as section, wholeSurfaceDistance } from '../src/connection-envelope';
import { Go } from '../src/engine';
import { createLivingSurface } from '../src/living-stones';
import { Mesh, ShaderMaterial } from 'three';

test('production attachment matches the body section and tangent at both roots',()=>{
 for(const solid of [true,false])for(const length of solid?[1]:[Math.SQRT2,2,3])for(const strength of [.2,.5,.9])for(const life of [.02,.2,.7,1]){
  const root=attachmentRoot(solid),x=root*life,e=1e-7*life;
  const width=Math.sqrt(stone.radius**2-root**2),slope=-root/width;
  const a=section(x,length,solid,strength,life,1),b=section(x+e,length,solid,strength,life,1);
  assert.ok(Math.abs(a.width-width*life)<1e-9);
  assert.ok(Math.abs(a.halfHeight-stone.height/2*width/stone.radius*life)<1e-9);
  assert.ok(Math.abs(a.centerHeight-stone.height/2*life)<1e-9);
  assert.ok(Math.abs((b.width-a.width)/e-slope)<.001);
  assert.ok(Math.abs((b.centerHeight+b.halfHeight-a.centerHeight-a.halfHeight)/e-slope*stone.height/2/stone.radius)<.001);
  assert.ok(Math.abs((b.centerHeight-b.halfHeight-a.centerHeight+a.halfHeight)/e+slope*stone.height/2/stone.radius)<.001);
 }
});
test('the production surface preserves the crown, back and sides of each stone',()=>{
 for(const solid of [true,false])for(const length of solid?[1]:[Math.SQRT2,2,3]){
  const edges=[{a:[0,0] as [number,number],b:[length,0] as [number,number],solid}];
  const stones=[{at:edges[0].a},{at:edges[0].b}];
  for(const [x,y,z] of [[.25,0,.30],[-.448,0,.175],[0,.455,.175],[0,0,.35]]){
   const body=ellipsoidDistance(x,y,z-.175,.455,.455,.175);
   assert.ok(Math.abs(wholeSurfaceDistance([x,y,z],stones,edges)-body)<1e-8);
  }
 }
});
test('virtual shoulders converge monotonically to a thin, lowered volumetric waist',()=>{
 for(const length of [Math.SQRT2,2,3])for(const strength of [.2,.5,.9]){
  const root=attachmentRoot(false),span=length/2-root,waist=section(length/2,length,false,strength);
  let previous=Infinity;
  for(let i=0;i<=200;i++){
   const s=section(root+span*i/200,length,false,strength);
   assert.ok(s.width<=previous+1e-9);previous=s.width;
   assert.ok(s.halfHeight>0 && s.centerHeight>s.halfHeight);
   assert.ok(s.centerHeight+s.halfHeight<.29);
  }
  assert.ok(section(root,length,false,strength).width>waist.width*5);
  assert.ok(section(root+span*.4,length,false,strength).centerHeight>waist.centerHeight+.025);
  assert.ok(waist.halfHeight<waist.width*.6);
 }
});
test('one shared 3D field supplies the colour and depth passes',()=>{
 const game=new Go(19);game.board[180]=game.board[182]=1;
 const live=createLivingSurface(game,[],false,0,true,new Map(),new Map());
 assert.equal(live.mesh.children.length,1);
 const mesh=live.mesh.children[0] as Mesh;
 const color=mesh.material as ShaderMaterial,shadow=mesh.customDepthMaterial as ShaderMaterial;
 assert.equal(color.fragmentShader,shadow.fragmentShader);
 assert.equal(color.uniforms.uData,shadow.uniforms.uData);
 live.setTime(1.35);assert.equal(shadow.uniforms.uTime.value,1.35);
 live.dispose();
});

test('pressure and fading preserve contact tangency instead of scaling a tube inside the stone',()=>{
 for(const solid of [false,true])for(const visibility of [.05,.3,.7,1])for(const pressure of [0,.5,1]){
  const length=solid?1:2,root=attachmentRoot(solid,visibility),e=1e-7;
  const width=Math.sqrt(stone.radius**2-root**2),slope=-root/width;
  const a=section(root,length,solid,.7,1,1,visibility,pressure);
  const b=section(root+e,length,solid,.7,1,1,visibility,pressure);
  assert.ok(Math.abs(a.width-width)<1e-9);
  assert.ok(Math.abs(a.centerHeight-.175)<1e-9);
  assert.ok(Math.abs((b.width-a.width)/e-slope)<.002);
  assert.ok(Math.abs((b.centerHeight+b.halfHeight-a.centerHeight-a.halfHeight)/e-slope*.175/.455)<.002);
 }
});
