import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Go,parseSGF,links} from '../src/engine';
import {sampleConnection,sampleCut} from '../src/connection-state';
import type {ConnectionState} from '../src/connection-state';
import {surfaceModel} from '../src/surface-model';
import {sampleSurface} from '../src/surface-transition';
import type {SurfaceTransition} from '../src/surface-transition';
import {transitionCases} from '../dev/transition-cases';
test('rapid cut / undo / replay preserves visible state and leaves no retired volume',()=>{
 const kifu=parseSGF(readFileSync('public/games/gu.sgf','utf8'));
 for(const c of transitionCases(kifu)){
  const g=new Go(19),cs=new Map<string,ConnectionState>(),ss=new Map<string,SurfaceTransition>();
  for(const m of kifu.moves.slice(0,c.move-1))g.play(m.i,m.color);
  surfaceModel(g,-1,[],false,0,false,cs,ss);
  const baseline=g.board.slice(),move=kifu.moves[c.move-1];
  for(let step=0;step<20;step++){
   const time=1+step*.07;
   const tones=new Map([...cs].map(([key,s])=>[key,{tone:sampleConnection(s,time),cut:sampleCut(s,time)}]));
   const sizes=new Map([...ss].map(([key,s])=>[key,sampleSurface(s,time)]));
   if(step%2===0)assert.equal(g.play(move.i,move.color),null);else g.undo();
   surfaceModel(g,-1,[],true,time,true,cs,ss);
   for(const [key,s] of cs)if(tones.has(key)){
    assert.deepEqual(sampleConnection(s,time),tones.get(key)!.tone);
    if(tones.get(key)!.tone[3]>0)assert.equal(sampleCut(s,time),tones.get(key)!.cut);
   }
   for(const [key,s] of ss)if(sizes.has(key))assert.equal(sampleSurface(s,time),sizes.get(key));
  }
  assert.deepEqual(g.board,baseline);
  surfaceModel(g,-1,[],false,4,true,cs,ss);
  assert.equal(ss.size,g.board.filter(Boolean).length+links(g).filter(l=>l.kind==='solid').length);
  assert.ok([...ss.values()].every(s=>sampleSurface(s,4)===1));
  assert.equal(cs.size,links(g).filter(l=>l.kind!=='solid').length);
  assert.ok([...cs.values()].every(s=>sampleConnection(s,4)[3]===0));
 }
});
test('retiring cut retargets to merge when another rapid move joins its endpoints',()=>{
 const g=new Go(19),cs=new Map<string,ConnectionState>(),ss=new Map<string,SurfaceTransition>();
 g.board[180]=g.board[182]=2;surfaceModel(g,-1,[],false,0,false,cs,ss);
 g.board[181]=1;surfaceModel(g,-1,[],true,1,true,cs,ss);
 const key='2:180:182',old=cs.get(key)!;
 const before=sampleConnection(old,1.2);
 // A second route connects the endpoints while the original gap stays occupied.
 for(const p of [161,162,163])g.board[p]=2;
 surfaceModel(g,-1,[],true,1.2,true,cs,ss);
 assert.deepEqual(sampleConnection(cs.get(key)!,1.2),before);
 assert.equal(cs.get(key)!.merging,true);
 assert.equal(cs.get(key)!.to[3],0);
 surfaceModel(g,-1,[],false,2.1,true,cs,ss);
 assert.equal(cs.has(key),false);
});
