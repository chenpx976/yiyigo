import { atlasPosition, type AtlasBoard } from './case-atlas';
import { createLivingSurface } from '../src/living-stones';
import type { ConnectionState } from '../src/connection-state';
import type { SurfaceTransition } from '../src/surface-transition';
export type AtlasMode='before'|'after'|'step'|'rapid';
export function atlasPlayback(board:AtlasBoard,mode:AtlasMode,step:number,progress:number){
 const connections=new Map<string,ConnectionState>(),surfaces=new Map<string,SurfaceTransition>();
 let game=atlasPosition(board,mode==='after'?true:mode==='step'?Math.max(0,step-1):false);
 const seed=createLivingSurface(game,[],false,0,false,connections,surfaces);seed.dispose();
 const events=mode==='rapid'?[{at:1,step:1},{at:1.07,step:0},{at:1.14,step:1},{at:1.21,step:0},{at:1.28,step:1},{at:1.35,step:0}]:mode==='step'?[{at:1,step}]:[];
 const now=1+Math.max(0,Math.min(1,progress))*(mode==='rapid'?1.1:.7);
 for(const event of events)if(event.at<=now){
  const previous=game.board.slice();game=atlasPosition(board,event.step);
  const intermediate=createLivingSurface(game,previous,true,event.at,true,connections,surfaces);intermediate.dispose();
 }
 const live=createLivingSurface(game,game.board,false,now,true,connections,surfaces);live.setTime(now);
 return {game,live,now};
}
