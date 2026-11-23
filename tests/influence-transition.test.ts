import test from 'node:test';
import assert from 'node:assert/strict';
import { Go } from '../src/engine';
import { InfluenceTransition } from '../src/influence-transition';
const sample = (s: InfluenceTransition, time: number) => Array.from(s.from, (v,i) => v+(s.to[i]-v)*s.amount(time));
test('influence retargets rapid invasion and undo from the currently displayed two channels', () => {
  const game=new Go(19); game.board[9*19+7]=1; game.board[9*19+11]=2;
  const state=new InfluenceTransition(); state.update(game,0,false);
  const initial=sample(state,0);
  const invasion=9*19+9; game.board[invasion]=2;
  state.update(game,1,true);
  assert.deepEqual(sample(state,1),initial);
  const interrupted=sample(state,1.12); game.board[invasion]=0;
  state.update(game,1.12,true);
  assert.ok(sample(state,1.12).every((v,i)=>Math.abs(v-interrupted[i])<1e-7));
  const start=state.start; assert.equal(state.update(game,1.24,false),false);
  assert.equal(state.start,start,'focus-only redraw must not restart or complete the field transition');
  assert.deepEqual(sample(state,2),initial,'rapid undo leaves no residual influence');
});
test('seeks and board size changes replace influence without mixing incompatible intersections', () => {
  const state=new InfluenceTransition(),game=new Go(19); game.board[90]=1;
  state.update(game,0,false);game.board[91]=2;state.update(game,1,true);
  game.board[120]=2;state.update(game,1.1,false);
  assert.deepEqual(state.from,state.to);
  const smaller=new Go(9);smaller.board[40]=2;state.update(smaller,1.2,true);
  assert.equal(state.n,9);assert.equal(state.to.length,81*4);assert.deepEqual(state.from,state.to);
});

test('reduced motion settles the influence and does not resume an obsolete transition', () => {
  const state=new InfluenceTransition(),game=new Go(19);state.update(game,0,false);
  game.board[180]=1;state.update(game,1,true);state.settle(1.2);
  assert.equal(state.amount(1.2),1);assert.deepEqual(state.from,state.to);
  assert.equal(state.update(game,1.2,false),false);assert.equal(state.amount(1.3),1);
});
