import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Go,parseSGF,gameFromKifu,links} from '../src/engine';
import type {Color} from '../src/engine';
import {surfaceModel} from '../src/surface-model';
import {sampleConnection} from '../src/connection-state';
import type {ConnectionState} from '../src/connection-state';
import type {SurfaceTransition} from '../src/surface-transition';
interface Check {at:number;lib?:[string,number];link?:[string,string,string|null];threat?:boolean;empty?:string[];reject?:[string,string];captures?:[number,number]}
interface Case {id:string;file:string;n:number;checks:Check[]}
const cases:Case[]=JSON.parse(readFileSync('public/qi-mai/manifest.json','utf8'));
const point=(s:string,n:number)=>(s.charCodeAt(1)-97)*n+s.charCodeAt(0)-97;
function verify(g:Go,checks:Check[],at:number){
 for(const check of checks.filter(c=>c.at===at)){
  if(check.lib)assert.equal(g.group(point(check.lib[0],g.n)).liberties.size,check.lib[1]);
  if(check.link){const [a,b,kind]=check.link,i=point(a,g.n),j=point(b,g.n);const found=links(g).find(l=>l.i===Math.min(i,j)&&l.j===Math.max(i,j));assert.equal(found?.kind??null,kind);if(check.threat!==undefined)assert.equal(found?.threatened,check.threat);}
  for(const p of check.empty??[])assert.equal(g.board[point(p,g.n)],0);
  if(check.captures)assert.equal(g.captures[check.captures[0]],check.captures[1]);
  if(check.reject){const board=g.board.slice(),history=g.history.length;assert.ok(g.play(point(check.reject[1],g.n),check.reject[0]==='B'?1:2));assert.deepEqual(g.board,board);assert.equal(g.history.length,history);}
 }
}
for(const c of cases)test(`气脉 SGF: ${c.id}`,()=>{
 const kifu=parseSGF(readFileSync('public/qi-mai/'+c.file,'utf8')),g=gameFromKifu(kifu);
 const cs=new Map<string,ConnectionState>(),ss=new Map<string,SurfaceTransition>();
 verify(g,c.checks,0);surfaceModel(g,-1,[],false,0,false,cs,ss);
 for(const [index,m] of kifu.moves.entries()){
  const old=g.board.slice();assert.equal(g.play(m.i,m.color),null);verify(g,c.checks,index+1);
  const model=surfaceModel(g,-1,old,true,index+1,true,cs,ss);
  assert.ok(model.primitives.every(p=>p.data.every(Number.isFinite)));
  const current=new Map([...cs].map(([key,s])=>[key,sampleConnection(s,index+1.12)]));
  g.undo();surfaceModel(g,-1,[],true,index+1.12,true,cs,ss);
  for(const [key,s] of cs)if(current.has(key))assert.deepEqual(sampleConnection(s,index+1.12),current.get(key));
  assert.equal(g.play(m.i,m.color),null);surfaceModel(g,-1,[],true,index+1.18,true,cs,ss);
 }
 surfaceModel(g,-1,[],false,100,true,cs,ss);
 assert.equal(ss.size,g.board.filter(Boolean).length+links(g).filter(l=>l.kind==='solid').length);
 assert.equal(cs.size,links(g).filter(l=>l.kind!=='solid').length);
});
test('corpus rotations and reflections preserve liberties and link topology',()=>{
 for(const c of cases){const k=parseSGF(readFileSync('public/qi-mai/'+c.file,'utf8')),g=gameFromKifu(k);for(const m of k.moves)g.play(m.i,m.color);
  for(let transform=0;transform<8;transform++){
   const map=(i:number)=>{let x=i%g.n,y=Math.floor(i/g.n);if(transform>=4)x=g.n-1-x;for(let r=0;r<transform%4;r++)[x,y]=[g.n-1-y,x];return y*g.n+x;};
   const other=new Go(g.n);g.board.forEach((color,i)=>other.board[map(i)]=color);
   for(let i=0;i<g.board.length;i++)if(g.board[i])assert.equal(other.group(map(i)).liberties.size,g.group(i).liberties.size);
   const expected=links(g).map(l=>`${Math.min(map(l.i),map(l.j))}:${Math.max(map(l.i),map(l.j))}:${l.kind}:${l.threatened}`).sort();
   assert.deepEqual(links(other).map(l=>`${l.i}:${l.j}:${l.kind}:${l.threatened}`).sort(),expected);
  }
 }
});
test('seeded legal sequences never join opposing colors or invent solid liberties',()=>{
 let seed=121123;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed;};
 for(const n of [9,13,19]){const g=new Go(n);for(let move=0;move<120;move++){
  const candidates=g.board.flatMap((c,i)=>c?[]:[i]);let played=false;
  while(candidates.length){const k=random()%candidates.length,i=candidates.splice(k,1)[0];if(!g.play(i)){played=true;break;}}
  if(!played)break;
  for(const l of links(g)){assert.equal(g.board[l.i],g.board[l.j]);assert.ok(g.board[l.i]);if(l.kind==='solid'){assert.ok(g.neighbors(l.i).includes(l.j));assert.ok(g.group(l.i).stones.has(l.j));}else assert.ok(!g.group(l.i).stones.has(l.j));}
  for(let i=0;i<g.board.length;i++)if(g.board[i]){const group=g.group(i);assert.ok(group.liberties.size);for(const p of group.liberties){assert.equal(g.board[p],0);assert.ok([...group.stones].some(q=>g.neighbors(q).includes(p)));}}
 }}
});
test('SGF setup is validated and the first move can be undone back to it',()=>{
 const k=parseSGF('(;SZ[19]AB[jj]AW[kk]PL[W];W[lj])'),g=gameFromKifu(k),initial=g.board.slice();assert.equal(g.turn,2);g.play(k.moves[0].i,k.moves[0].color);g.undo();assert.deepEqual(g.board,initial);assert.equal(g.turn,2);
 for(const text of ['(;SZ[9]AB[jj])','(;AB[aa]AW[aa])','(;AB[aa:cc])','(;PL[X])','(;AB[aa];AE[aa])'])assert.throws(()=>parseSGF(text));
});
