import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { cutEnvelope } from '../src/connection-motion';
import { Go,parseSGF } from '../src/engine';
import {sampleConnection,sampleCut,updateConnections} from '../src/connection-state';
import type {ConnectionState} from '../src/connection-state';
import { transitionCases } from '../dev/transition-cases';
test('cut pinches before opening and retracts continuously at the actual cut point',()=>{
 const initial=cutEnvelope(0,0,3),tight=cutEnvelope(.3,0,3);
 assert.equal(initial.neck,1);assert.equal(initial.opening,0);
 assert.ok(tight.neck<.15);assert.equal(tight.opening,0);
 let prior=0;for(let i=0;i<=100;i++){const c=cutEnvelope(i/100,0,3);assert.ok(c.opening>=prior);assert.ok(c.neck>0);prior=c.opening;}
 assert.ok(cutEnvelope(.3,.5,3).neck>.99,'roots remain unaffected by a local pinch');
});
test('real nineteen-line records cover both colors and all three continuous transitions',()=>{
 for(const file of ['cho','gu','lee']){
  const kifu=parseSGF(readFileSync(`public/games/${file}.sgf`,'utf8'));
  const cases=transitionCases(kifu);assert.equal(cases.length,6);
  for(const c of cases){
   const g=new Go(19);for(const m of kifu.moves.slice(0,c.move-1))assert.equal(g.play(m.i,m.color),null);
   const states=new Map<string,ConnectionState>();updateConnections(g,states,0,false);
   const key=`${c.color}:${c.i}:${c.j}`,before=sampleConnection(states.get(key)!,1);
   const m=kifu.moves[c.move-1];assert.equal(g.play(m.i,m.color),null);updateConnections(g,states,1,true);
   const current=states.get(key)!;assert.deepEqual(sampleConnection(current,1),before);
   const middle=sampleConnection(current,1.35);assert.ok(middle.every(Number.isFinite));
   if(c.kind==='cut'){assert.ok(middle[3]>0);assert.equal(current.to[3],1);}
   if(c.kind==='atari'){assert.ok(middle[0]<before[0]);assert.ok(middle[1]>before[1]);}
   if(c.kind==='merge'){assert.equal(current.merging,true);assert.equal(middle[3],0);}
   const atReverse=sampleConnection(current,1.2);g.undo();updateConnections(g,states,1.2,true);
   assert.deepEqual(sampleConnection(states.get(key)!,1.2),atReverse,'rapid undo starts at the visible state');
   assert.equal(sampleCut(states.get(key)!,1.2),sampleCut(current,1.2),'undo must not teleport an off-centre cut');
  }
 }
});
