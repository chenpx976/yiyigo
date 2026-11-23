import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseSGF,gameFromKifu,links} from '../src/engine';
import {packVisualCases} from '../dev/case-atlas';
import {visualAtlasModel} from '../dev/visual-atlas-model';
import {surfaceModel} from '../src/surface-model';
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

test('dense atlas preserves independent display suppression without inventing competition across cases',()=>{
 let inspected=0;
 for(const board of packVisualCases(items)){
  const {model}=visualAtlasModel(board);
  for(const p of board.placements){
   const source=gameFromKifu(p.item.kifu),original=surfaceModel(source,-1,[],false,0,false,new Map(),new Map());
   for(const primitive of original.primitives.filter(p=>p.data[4]===2)){
    const d=primitive.data,i=p.map(d[1]*source.n+d[0]),j=p.map(d[3]*source.n+d[2]);
    const mapped=model.primitives.find(p=>p.data[4]===2&&p.data[5]===d[5]&&p.data[1]*19+p.data[0]===i&&p.data[3]*19+p.data[2]===j);
    assert.ok(mapped,p.item.id+' retains its virtual edge');
    assert.deepEqual(mapped.crossings??[],primitive.crossings??[],p.item.id+' crossing belongs only to its original case');
    if(p.item.id.startsWith('opposed-crossing')){
     assert.equal(mapped.crossings?.length,0);
     assert.equal(mapped.data[14],0,'opposed crossings remain cached but hidden by default');
     assert.ok(mapped.data[12]>0,'presentation does not zero tactical strength');
     inspected++;
    }
   }
  }
 }
 assert.equal(inspected,4,'both virtual links remain in each color variant');
});
