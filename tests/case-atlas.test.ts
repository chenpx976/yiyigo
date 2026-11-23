import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseSGF,gameFromKifu,links} from '../src/engine';
import {packCases,packVisualCases,atlasPosition, type AtlasCase, type AtlasBoard} from '../dev/case-atlas';
const items:AtlasCase[]=JSON.parse(readFileSync('public/qi-mai/manifest.json','utf8')).map((item:{id:string;name:string;file:string})=>({...item,kifu:parseSGF(readFileSync('public/qi-mai/'+item.file,'utf8'))}));
const boards=packCases(items);
const fixture=(id:string,sgf:string):AtlasCase=>({id,name:id,kifu:parseSGF(sgf)});
const sorted=(values:Iterable<number>)=>[...values].sort((a,b)=>a-b);
function verify(board:AtlasBoard,stage:number){
 const game=atlasPosition(board,stage),expected:string[]=[];
 let stoneCount=0;
 for(const {item,map} of board.placements){
  const source=gameFromKifu(item.kifu);
  for(const move of item.kifu.moves.slice(0,stage))assert.equal(source.play(move.i,move.color),null);
  source.board.forEach((c,i)=>{
   if(!c)return;stoneCount++;
   assert.equal(game.board[map(i)],c,item.id);
   const actual=game.group(map(i)),original=source.group(i);
   assert.deepEqual(sorted(actual.liberties),sorted([...original.liberties].map(map)),item.id+' liberties');
   assert.deepEqual(sorted(actual.stones),sorted([...original.stones].map(map)),item.id+' connected group');
  });
  for(const l of links(source))expected.push(`${Math.min(map(l.i),map(l.j))}:${Math.max(map(l.i),map(l.j))}:${l.kind}:${l.threatened}`);
 }
 assert.equal(game.board.filter(Boolean).length,stoneCount);
 assert.deepEqual(links(game).map(l=>`${l.i}:${l.j}:${l.kind}:${l.threatened}`).sort(),expected.sort());
}
test('19-line atlas preserves every case, liberty and link at every intermediate move',()=>{
 assert.equal(boards.flatMap(b=>b.placements).length,items.length);
 assert.equal(new Set(boards.flatMap(b=>b.placements.map(p=>p.item.id))).size,items.length);
 for(const board of boards){
  const max=Math.max(...board.placements.map(p=>p.item.kifu.moves.length));
  for(let stage=0;stage<=max;stage++)verify(board,stage);
  assert.deepEqual(atlasPosition(board,false).board,atlasPosition(board,0).board);
  assert.deepEqual(atlasPosition(board,true).board,atlasPosition(board,max+10).board);
 }
});
test('future moves reserve independent four-intersection clearance, including captured positions',()=>{
 for(const board of boards){
  const spaces=board.placements.map(({item,map})=>[...new Set([...item.kifu.setup.map(p=>p.i),...item.kifu.moves.flatMap(m=>m.i===null?[]:[m.i])])].map(map));
  for(let a=0;a<spaces.length;a++)for(let b=a+1;b<spaces.length;b++)for(const p of spaces[a])for(const q of spaces[b]){
   assert.ok(Math.max(Math.abs(p%19-q%19),Math.abs(Math.floor(p/19)-Math.floor(q/19)))>=4);
  }
 }
});
test('atlas capacity follows geometry instead of a four-case limit',()=>{
 const singles=Array.from({length:12},(_,i)=>fixture('single-'+i,'(;SZ[19]AB[jj])'));
 assert.equal(packCases(singles).length,1);
 assert.ok(boards.some(b=>b.placements.length>4));
 assert.ok(boards.length<14);
});
test('empty and pass-only cases stay visible; invalid histories and duplicate IDs fail explicitly',()=>{
 assert.deepEqual(packCases([]),[]);
 const empty=fixture('empty','(;SZ[19];B[];W[])');
 const packed=packCases([empty,fixture('single','(;SZ[19]AB[jj])')]);
 assert.equal(packed.flatMap(b=>b.placements).length,2);
 const emptyBoard=packed.find(b=>b.placements.some(p=>p.item.id==='empty'))!;
 assert.equal(emptyBoard.placements.length,1);
 assert.equal(atlasPosition(emptyBoard,true).board.filter(Boolean).length,0);
 assert.throws(()=>packCases([fixture('illegal','(;SZ[19]AB[jj];W[jj])')]),/非法着手/);
 assert.throws(()=>packCases([empty,empty]),/ID 重复/);
 assert.throws(()=>packCases([{...empty,kifu:{...empty.kifu,n:20}}]),/尺寸无效/);
 for(const stage of [-1,.5,NaN,Infinity])assert.throws(()=>atlasPosition(emptyBoard,stage),/非负整数/);
});
test('atlas rejects out-of-range and overlapping hand-authored mappings',()=>{
 const item=fixture('single','(;SZ[19]AB[jj])');
 const p={item,map:()=>361,bounds:[0,0,0,0] as [number,number,number,number]};
 assert.throws(()=>atlasPosition({placements:[p],reserved:[]}),/超出棋盘/);
 const valid={...p,map:()=>180};
 assert.throws(()=>atlasPosition({placements:[valid,valid],reserved:[]}),/重叠/);
});


test('visual atlas packs the full corpus into three boards without overlapping case bboxes',()=>{
 const visual=packVisualCases(items);
 assert.equal(visual.length,3);
 assert.equal(visual.flatMap(b=>b.placements).length,items.length);
 assert.equal(new Set(visual.flatMap(b=>b.placements.map(p=>p.item.id))).size,items.length);
 for(const board of visual){
  assert.equal(board.presentationOnly,true);
  assert.throws(()=>atlasPosition(board),/独立计算规则/);
  board.placements.forEach((p,index)=>{
   const [left,top,right,bottom]=p.bounds;
   assert.ok(left>=0&&top>=0&&right<=18&&bottom<=18);
   for(const q of board.placements.slice(index+1)){
    const [l,t,r,b]=q.bounds;
    assert.ok(right+1<l||r+1<left||bottom+1<t||b+1<top,'one clear grid row/column between bboxes');
   }
   for(const point of [...p.item.kifu.setup.map(x=>x.i),...p.item.kifu.moves.flatMap(m=>m.i===null?[]:[m.i])]){
    const moved=p.map(point);assert.ok(moved%19>=left&&moved%19<=right&&Math.floor(moved/19)>=top&&Math.floor(moved/19)<=bottom);
   }
   // Pure translation must preserve primitive vectors (no hidden reflection).
   assert.equal(p.map(p.item.kifu.n+1)-p.map(0),20);
  });
 }
});

test('twenty black and white basic-shape cases fit on one nineteen-line visual board',()=>{
 const categories=new Set(['line','elbow','tee','cross','diagonal','small-jump','large-jump','three-around','four-around','crowded-hub']);
 const selected=items.filter(item=>categories.has(item.id.replace(/-swap$/,'')));
 assert.equal(selected.length,20);
 const packed=packVisualCases(selected);
 assert.equal(packed.length,1);assert.equal(packed[0].placements.length,20);
});
