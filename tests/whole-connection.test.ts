import test from 'node:test';
import assert from 'node:assert/strict';
import {wholeConnectionSection,wholeConnectionDistance,wholeSurfaceDistance,type WholeConnection} from '../src/connection-envelope';
import {ellipsoidDistance,stoneProfile} from '../src/stone-profile';
import {Go} from '../src/engine';
import {createLivingSurface} from '../src/living-stones';
import {Mesh,ShaderMaterial} from 'three';
const near=(a:number,b:number,message='')=>assert.ok(Math.abs(a-b)<1e-9,`${message}: ${a} / ${b}`);

test('whole edge is endpoint-symmetric with unequal landing and capture lifecycles',()=>{
 for(const solid of [false,true])for(const length of solid?[1]:[Math.SQRT2,2,3])for(const [lifeA,lifeB] of [[1,1],[.1,1],[.5,1],[1,.2],[.002,.7]]){
  for(let i=0;i<=100;i++){
   const x=length*i/100,a=wholeConnectionSection(x,length,solid,.65,lifeA,lifeB),b=wholeConnectionSection(length-x,length,solid,.65,lifeB,lifeA);
   near(a.width,b.width);near(a.halfHeight,b.halfHeight);near(a.centerHeight,b.centerHeight);
   assert.ok(a.width>0&&a.halfHeight>0&&a.centerHeight>=a.halfHeight);
  }
 }
});
test('unequal endpoints share a single smooth middle cross-section',()=>{
 for(const solid of [false,true])for(const length of solid?[1]:[Math.SQRT2,2,3])for(const [lifeA,lifeB] of [[.1,1],[.5,1],[1,.2]]){
  const mid=wholeConnectionSection(length/2,length,solid,.65,lifeA,lifeB);
  const left=wholeConnectionSection(length/2-1e-5,length,solid,.65,lifeA,lifeB),right=wholeConnectionSection(length/2+1e-5,length,solid,.65,lifeA,lifeB);
  for(const key of ['width','halfHeight','centerHeight'] as const){
   assert.ok(Math.abs(left[key]-mid[key])<1e-7);
   assert.ok(Math.abs(right[key]-mid[key])<1e-7);
  }
 }
});
test('full distance field remains symmetric for routes, pressure and off-centre cuts',()=>{
 for(const b of [[1,0],[1,1],[2,0],[0,3]] as [number,number][])for(const gap of [0,.4,.8]){
  const edge:WholeConnection={a:[0,0],b,solid:b[0]===1&&b[1]===0,lifeA:.35,lifeB:1,visibility:.8,pressure:.6,gap,cut:.3};
  const reversed={...edge,a:edge.b,b:edge.a,lifeA:edge.lifeB,lifeB:edge.lifeA,cut:.7};
  for(let y=-.1;y<=3.1;y+=.13)for(let x=-.1;x<=2.1;x+=.11){
   const p:[number,number,number]=[x,y,.03];
   near(wholeConnectionDistance(p,edge),wholeConnectionDistance(p,reversed),'reversed full field');
  }
 }
});
test('duplicate and permuted attachments cannot inflate a crowded hub',()=>{
 const center:[number,number]=[9,9],targets:[number,number][]=[[8,8],[10,8],[10,10],[8,10],[11,9]];
 const stones=[center,...targets].map(at=>({at}));
 const edges:WholeConnection[]=targets.map(b=>({a:center,b,solid:false,strength:.65}));
 for(let y=8.4;y<=9.6;y+=.08)for(let x=8.4;x<=9.6;x+=.08)for(const z of [.03,.1,.22,.32]){
  const p:[number,number,number]=[x,y,z],a=wholeSurfaceDistance(p,stones,edges);
  near(a,wholeSurfaceDistance(p,stones,[...edges].reverse()));
  near(a,wholeSurfaceDistance(p,stones,[...edges,...edges]));
 }
});
test('every crowded stone keeps its original rounded crown',()=>{
 const center:[number,number]=[9,9],targets:[number,number][]=[[8,8],[10,8],[10,10],[8,10],[11,9]];
 const stones=[center,...targets].map(at=>({at}));
 const edges:WholeConnection[]=targets.map(b=>({a:center,b,solid:false,strength:.65}));
 for(let angle=0;angle<Math.PI*2;angle+=.17)for(const r of [0,.1,.2,.3]){
  const x=Math.cos(angle)*r,y=Math.sin(angle)*r,z=stoneProfile.height/2*(1+Math.sqrt(1-r*r/(stoneProfile.radius**2)));
  const base=ellipsoidDistance(x,y,z-.175,.455,.455,.175);
  near(wholeSurfaceDistance([9+x,9+y,z],stones,edges),base,'crown unchanged');
 }
});
test('GPU edges reference both lifecycle owners and only use one geometry path',()=>{
 const game=new Go(19);game.board[180]=game.board[181]=2;
 const live=createLivingSurface(game,[],false,0,false,new Map(),new Map());
 const mesh=live.mesh.children[0] as Mesh,material=mesh.material as ShaderMaterial;
 const data=material.uniforms.uData.value.image.data as Float32Array;
 // Two nodes followed by their one solid edge; addresses are vec4 records.
 const link=40;
 for(const index of [link+6,link+7]){
  const node=data[index]*4;assert.equal(data[node+4],0);assert.equal(data[node+5],2);
 }
 assert.notEqual(data[link+6],data[link+7]);
 assert.ok(!material.fragmentShader.includes('legacySolidField'));
 assert.ok(!material.fragmentShader.includes('uEnvelopePrototype'));
 assert.ok(material.fragmentShader.includes('wholeConnectionSection'));
 live.dispose();
});

test('opposed competition yields at each actual crossing without manufacturing a central node',()=>{
 const edge:WholeConnection={a:[0,0],b:[3,0],solid:false,crossings:[{t:1/3,amount:1},{t:2/3,amount:1}]};
 for(const x of [1,2])for(let z=.005;z<=.15;z+=.005)assert.ok(wholeConnectionDistance([x,0,z],edge)>0);
 for(const x of [.7,1.5,2.3]){
  const s=wholeConnectionSection(x,3,false);
  assert.ok(wholeConnectionDistance([x,0,s.centerHeight],edge)<0);
 }
 const reversed={...edge,a:edge.b,b:edge.a,crossings:edge.crossings!.map(c=>({...c,t:1-c.t}))};
 for(let x=.45;x<2.55;x+=.03)near(wholeConnectionDistance([x,.01,.03],edge),wholeConnectionDistance([x,.01,.03],reversed));
});
