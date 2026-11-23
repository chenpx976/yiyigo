import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseSGF,gameFromKifu,links} from '../src/engine';
import {packVisualCases} from '../dev/case-atlas';
import {visualAtlasModel} from '../dev/visual-atlas-model';
const items=JSON.parse(readFileSync('public/qi-mai/manifest.json','utf8')).map((item:any)=>({...item,kifu:parseSGF(readFileSync('public/qi-mai/'+item.file,'utf8'))}));
test('dense atlas renders only each independent case’s stones and real/virtual edges',()=>{
 for(const board of packVisualCases(items))for(const after of [false,true]){
  const {game,model}=visualAtlasModel(board,after);
  const expected:string[]=[];let stoneCount=0;
  for(const p of board.placements){
   const source=gameFromKifu(p.item.kifu);if(after)for(const move of p.item.kifu.moves)assert.equal(source.play(move.i,move.color),null);
   stoneCount+=source.board.filter(Boolean).length;
   for(const edge of links(source))expected.push(`${p.map(edge.i)}:${p.map(edge.j)}:${edge.kind==='solid'?1:2}:${edge.color}`);
  }
  assert.equal(game.board.filter(Boolean).length,stoneCount);
  assert.equal(model.primitives.filter(p=>p.data[4]===0).length,stoneCount);
  const actual=model.primitives.filter(p=>p.data[4]>0).map(({data:d})=>`${d[1]*19+d[0]}:${d[3]*19+d[2]}:${d[4]}:${d[5]}`);
  assert.deepEqual(actual.sort(),expected.sort(),'neighbouring examples must not create synthetic rule edges');
 }
});
