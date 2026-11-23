import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Go,parseSGF} from '../src/engine';
import {updateConnections,sampleVisibility} from '../src/connection-state';
import type {ConnectionState} from '../src/connection-state';
import {transitionCases} from '../dev/transition-cases';
test('real nineteen-line hide/reveal uses the entire timeline and survives rapid reversals',()=>{
 const colors=new Set<number>(),kinds=new Set<string>();let count=0;
 for(const file of ['cho','gu','lee']){
  const k=parseSGF(readFileSync(`public/games/${file}.sgf`,'utf8'));
  for(const c of transitionCases(k,true)){
   count++;colors.add(c.color);kinds.add(c.kind);
   const g=new Go(19);for(const move of k.moves.slice(0,c.move-1))g.play(move.i,move.color);
   const states=new Map<string,ConnectionState>();updateConnections(g,states,0,false);
   const key=`${c.color}:${c.i}:${c.j}`,start=sampleVisibility(states.get(key)!,1),m=k.moves[c.move-1];
   assert.equal(g.play(m.i,m.color),null);updateConnections(g,states,1,true);
   const state=states.get(key)!;assert.equal(sampleVisibility(state,1),start);
   let prior=start;
   for(let f=1;f<100;f++){
    const value=sampleVisibility(state,1+.7*f/100);
    assert.ok(value>0&&value<1,'no early saturation or invisible tail');
    assert.ok(c.kind==='hide'?value<prior:value>prior);prior=value;
   }
   assert.equal(sampleVisibility(state,1.7),c.kind==='hide'?0:1);
   for(let j=0;j<12;j++){
    const time=1.08+j*.04,current=sampleVisibility(states.get(key)!,time);
    if(j%2===0)g.undo();else assert.equal(g.play(m.i,m.color),null);
    updateConnections(g,states,time,true);
    assert.equal(sampleVisibility(states.get(key)!,time),current);
   }
  }
 }
 assert.ok(count>=6);assert.equal(colors.size,2);assert.equal(kinds.size,2);
});
