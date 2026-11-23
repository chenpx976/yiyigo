import { Go, gameFromKifu } from '../src/engine';
import { surfaceModel, type SurfacePrimitive } from '../src/surface-model';
import { createSurfaceFromModel } from '../src/living-stones';
import type { AtlasBoard } from './case-atlas';
export function visualAtlasModel(board:AtlasBoard,after=false){
 const game=new Go(19),primitives:SurfacePrimitive[]=[];
 for(const placement of board.placements){
  const source=gameFromKifu(placement.item.kifu);
  if(after)for(const move of placement.item.kifu.moves)source.play(move.i,move.color);
  const model=surfaceModel(source,-1,[],false,0,false,new Map(),new Map());
  // Atlas packer currently uses translations; map(0) can be outside the board,
  // so derive shifts from an actual in-bounds source point to avoid modulo wrap.
  const anchor=source.board.findIndex(Boolean),fallback=placement.item.kifu.moves.find(m=>m.i!==null)?.i??0;
  const i=anchor>=0?anchor:fallback,target=placement.map(i),dx=target%19-i%source.n,dy=Math.floor(target/19)-Math.floor(i/source.n);
  const shift=(x:number,y:number):[number,number]=>[x+dx,y+dy];
  source.board.forEach((color,p)=>{if(color){const mapped=placement.map(p);if(game.board[mapped])throw Error('案例重叠');game.board[mapped]=color}});
  for(const primitive of model.primitives){
   const data=[...primitive.data];[data[0],data[1]]=shift(data[0],data[1]);[data[2],data[3]]=shift(data[2],data[3]);
   const [l,t,r,b]=primitive.bounds;
   primitives.push({data,bounds:[l+dx,t+dy,r+dx,b+dy]});
  }
 }
 const bins=Array.from({length:361},(_,i)=>primitives.flatMap((p,k)=>{const x=i%19,y=Math.floor(i/19),[l,t,r,b]=p.bounds;return l<=x+.5&&r>=x-.5&&t<=y+.5&&b>=y-.5?[k]:[]}));
 return {game,model:{primitives,bins}};
}
export function visualAtlasSurface(board:AtlasBoard,after=false){const {game,model}=visualAtlasModel(board,after);return {game,live:createSurfaceFromModel(19,model,0,false),now:0};}
