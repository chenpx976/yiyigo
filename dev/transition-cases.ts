import { Go, links } from '../src/engine';
import type { Kifu } from '../src/engine';
import { updateConnections } from '../src/connection-state';
import type { ConnectionState } from '../src/connection-state';
export function transitionCases(kifu:Kifu,presentationOnly=false){
 const game=new Go(kifu.n),found=new Map();
 for(const [index,move] of kifu.moves.entries()){
  const states=new Map<string,ConnectionState>();
  updateConnections(game,states,0,false);
  const prior=new Map([...states].map(([key,state])=>[key,state.toVisibility ?? Number(state.to[0]>0)]));
  game.play(move.i,move.color);
  updateConnections(game,states,1,true);
  const active=new Set(links(game).map(l=>`${l.color}:${l.i}:${l.j}`));
  for(const [id,state] of states){
   const presentation=state.link.kind==='small'&&active.has(id)&&prior.has(id)?prior.get(id)===0&&state.toVisibility===1?'reveal':prior.get(id)===1&&state.toVisibility===0?'hide':null:null;
   const kind=presentationOnly?presentation:state.merging?'merge':state.to[3]===1?'cut':state.to[1]===1&&state.from[1]<1&&state.to[0]>0?'atari':null;
   if(!kind||(!presentationOnly&&state.from[0]===0))continue;
   const key=`${state.link.color}:${kind}`;
   if(!found.has(key))found.set(key,{key,move:index+1,kind,color:state.link.color,i:state.link.i,j:state.link.j});
  }
 }
 return [...found.values()];
}
