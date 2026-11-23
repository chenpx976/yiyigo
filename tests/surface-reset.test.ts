import test from 'node:test';
import assert from 'node:assert/strict';
import {Go} from '../src/engine';
import {surfaceModel,surfaceUpdateMode} from '../src/surface-model';
import {sampleConnection,sampleVisibility,type ConnectionState} from '../src/connection-state';
import {sampleSurface,type SurfaceTransition} from '../src/surface-transition';
const state=()=>({connections:new Map<string,ConnectionState>(),surfaces:new Map<string,SurfaceTransition>()});
const pair=()=>{const game=new Go(19);game.board[180]=game.board[182]=2;return game;};
function steady(s:ReturnType<typeof state>,time:number){
 for(const node of s.surfaces.values()){
  assert.equal(node.from,1);assert.equal(node.to,1);assert.equal(sampleSurface(node,time),1);
 }
 for(const link of s.connections.values()){
  assert.deepEqual(link.from,link.to);assert.equal(link.fromVisibility,link.toVisibility);
  assert.deepEqual(sampleConnection(link,time),link.to);assert.equal(sampleVisibility(link,time),link.toVisibility);
 }
}
test('initial non-animated seek sets stones and virtual material to steady state together',()=>{
 const game=pair(),s=state();
 assert.equal(surfaceUpdateMode(game,s.surfaces,false,true),'reset');
 const model=surfaceModel(game,-1,[],false,12,true,s.connections,s.surfaces);
 steady(s,12);assert.ok(s.connections.size);
 for(const p of model.primitives)assert.deepEqual(p.data.slice(8,12),p.data.slice(12,16));
});
test('a non-animated seek during a cut discards all previous material and does not restart virtual growth',()=>{
 const game=pair(),s=state();surfaceModel(game,-1,[],false,0,true,s.connections,s.surfaces);
 const before=game.board.slice();assert.equal(game.play(181,1),null);
 surfaceModel(game,-1,before,true,1,true,s.connections,s.surfaces);
 assert.ok([...s.connections.values()].some(c=>c.from[0]!==c.to[0]));
 const destination=new Go(19);destination.board[100]=destination.board[102]=1;
 const model=surfaceModel(destination,-1,game.board,false,1.1,true,s.connections,s.surfaces);
 steady(s,1.1);
 assert.deepEqual([...s.surfaces.values()].filter(x=>x.type===0).map(x=>x.i).sort(),[100,102]);
 assert.ok([...s.connections.values()].every(x=>x.link.i===100&&x.link.j===102));
 assert.ok(model.primitives.every(p=>p.data.slice(0,4).every(Number.isFinite)));
});
test('hover and repeated same-board sampling preserve every surviving transition origin and timestamp',()=>{
 const game=pair(),s=state();surfaceModel(game,-1,[],false,0,true,s.connections,s.surfaces);
 const old=game.board.slice();game.play(181,1);surfaceModel(game,-1,old,true,1,true,s.connections,s.surfaces);
 const connections=structuredClone([...s.connections]),surfaces=structuredClone([...s.surfaces]);
 for(const time of [1.02,1.08,1.2,1.3]){
  assert.equal(surfaceUpdateMode(game,s.surfaces,false,true),'sample');
  surfaceModel(game,180,game.board,false,time,true,s.connections,s.surfaces);
  assert.deepEqual([...s.connections],connections);assert.deepEqual([...s.surfaces],surfaces);
 }
});
test('rapid cut and undo retarget from the sampled current shape without a snap',()=>{
 const game=pair(),s=state();surfaceModel(game,-1,[],false,0,true,s.connections,s.surfaces);
 for(let step=0;step<12;step++){
  const time=1+step*.04;
  const visible=new Map([...s.connections].map(([key,c])=>[key,{tone:sampleConnection(c,time),visibility:sampleVisibility(c,time)}]));
  const bodies=new Map([...s.surfaces].map(([key,c])=>[key,sampleSurface(c,time)]));
  const previous=game.board.slice();if(step%2===0)assert.equal(game.play(181,1),null);else game.undo();
  surfaceModel(game,-1,previous,true,time,true,s.connections,s.surfaces);
  for(const [key,c] of s.connections)if(visible.has(key)){
   assert.deepEqual(sampleConnection(c,time),visible.get(key)!.tone);
   assert.equal(sampleVisibility(c,time),visible.get(key)!.visibility);
  }
  for(const [key,c] of s.surfaces)if(bodies.has(key))assert.equal(sampleSurface(c,time),bodies.get(key));
 }
 surfaceModel(game,-1,game.board,false,3,true,s.connections,s.surfaces);
 assert.equal([...s.surfaces.values()].filter(x=>x.type===0).length,2);
 assert.equal(s.connections.size,1);
});
test('explicit reset and reduced motion finish current material even when board targets are unchanged',()=>{
 const game=pair(),s=state();surfaceModel(game,-1,[],true,1,true,s.connections,s.surfaces);
 assert.ok([...s.connections.values()].some(c=>sampleVisibility(c,1)===0));
 surfaceModel(game,-1,game.board,false,1.1,true,s.connections,s.surfaces,'reset');steady(s,1.1);
 const old=game.board.slice();game.play(181,1);surfaceModel(game,-1,old,true,2,true,s.connections,s.surfaces);
 surfaceModel(game,-1,game.board,false,2.1,false,s.connections,s.surfaces);steady(s,2.1);
 assert.equal(s.connections.size,0);
});
