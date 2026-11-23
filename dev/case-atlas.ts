import { Go, gameFromKifu, type Kifu } from '../src/engine';
export interface AtlasCase { id:string; name:string; kifu:Kifu }
export interface Placement { item:AtlasCase; map:(i:number)=>number; bounds:[number,number,number,number] }
export interface AtlasBoard { placements:Placement[]; reserved:number[]; presentationOnly?:true }
const edgeCount=(x:number,y:number,n:number)=>Number(x>0)+Number(y>0)+Number(x<n-1)+Number(y<n-1);
const edgeDistance=(p:number,n:number)=>Math.min(3,p%n,Math.floor(p/n),n-1-p%n,n-1-Math.floor(p/n));
const separation=(p:number,q:number)=>Math.max(Math.abs(p%19-q%19),Math.abs(Math.floor(p/19)-Math.floor(q/19)));

function prepare(item:AtlasCase){
 const {n}=item.kifu;
 if(!Number.isInteger(n)||n<2||n>19)throw new Error('案例棋盘尺寸无效：'+item.id);
 const game=gameFromKifu(item.kifu);
 const points=[...new Set([...game.board.flatMap((c,i)=>c?[i]:[]),...item.kifu.moves.flatMap(m=>m.i===null?[]:[m.i])])];
 // Validate every move before reserving its place. Ignoring an illegal move
 // would make the future-move clearance and the atlas comparison false.
 for(const move of item.kifu.moves){const error=game.play(move.i,move.color);if(error)throw new Error(`案例 ${item.id} 含非法着手：${error}`);}
 if(!points.length)return {item,points,layouts:[]};
 const layouts:{map:(i:number)=>number; bounds:[number,number,number,number]; points:number[]}[]=[];
 const seen=new Set<string>();
 for(const sx of [1,-1])for(const sy of [1,-1]){
  const xs=points.map(i=>(i%n)*sx),ys=points.map(i=>Math.floor(i/n)*sy);
  const minX=Math.min(...xs),minY=Math.min(...ys),w=Math.max(...xs)-minX,h=Math.max(...ys)-minY;
  for(let y=0;y+h<19;y++)for(let x=0;x+w<19;x++){
   const map=(i:number)=>(Math.floor(i/n)*sy-minY+y)*19+(i%n)*sx-minX+x;
   const moved=points.map(map);
   if(points.some((p,k)=>edgeDistance(p,n)!==edgeDistance(moved[k],19)))continue;
   if(points.some((p,k)=>edgeCount(p%n,Math.floor(p/n),n)!==edgeCount(moved[k]%19,Math.floor(moved[k]/19),19)))continue;
   // Equal liberty counts alone are insufficient: a left-edge case cannot
   // become a top-edge case without rotating its neighbourhood as well.
   if(points.some(p=>game.neighbors(p).some(q=>{
    const mapped=map(q),origin=map(p);
    return mapped<0||mapped>=361||Math.abs(mapped%19-origin%19)+Math.abs(Math.floor(mapped/19)-Math.floor(origin/19))!==1;
   })))continue;
   const key=moved.join(',');if(seen.has(key))continue;seen.add(key);
   layouts.push({map,bounds:[x,y,x+w,y+h],points:moved});
  }
 }
 // First-fit strip packing, with difficult/larger cases placed first. There is
 // no case-count cap; geometry and future-move clearance determine capacity.
 layouts.sort((a,b)=>a.bounds[1]-b.bounds[1]||a.bounds[0]-b.bounds[0]);
 return {item,points,layouts};
}
export function packCases(items:AtlasCase[]):AtlasBoard[]{
 if(new Set(items.map(i=>i.id)).size!==items.length)throw new Error('案例 ID 重复');
 const prepared=items.map(prepare);
 const area=(p:ReturnType<typeof prepare>)=>{const b=p.layouts[0]?.bounds;return b?(b[2]-b[0]+4)*(b[3]-b[1]+4):0;};
 prepared.sort((a,b)=>area(b)-area(a)||a.layouts.length-b.layouts.length);
 const boards:AtlasBoard[]=[];
 for(const {item,points,layouts} of prepared){
  if(!points.length){
   // An empty-board / pass-only case remains a visible case of its own.
   boards.push({placements:[{item,map:i=>i,bounds:[0,0,18,18]}],reserved:Array.from({length:361},(_,i)=>i)});
   continue;
  }
  if(!layouts.length)throw new Error('无法保留边角条件排布案例：'+item.id);
  let placed=false;
  for(const board of [...boards,{placements:[],reserved:[]} as AtlasBoard]){
   const fit=layouts.find(layout=>!layout.points.some(p=>board.reserved.some(q=>separation(p,q)<4)));
   if(!fit)continue;
   board.placements.push({item,map:fit.map,bounds:fit.bounds});board.reserved.push(...fit.points);
   if(!boards.includes(board))boards.push(board);
   placed=true;break;
  }
  if(!placed)throw new Error('无法安全排布案例：'+item.id);
 }
 return boards;
}
export function atlasPosition(board:AtlasBoard,stage:boolean|number=false){
 if(board.presentationOnly)throw new Error("视觉案例必须独立计算规则，不能合并成对局");
 if(typeof stage==='number'&&(!Number.isInteger(stage)||stage<0))throw new Error('案例手数必须是非负整数');
 const game=new Go(19);
 for(const {item,map} of board.placements){
  const source=gameFromKifu(item.kifu);
  const count=stage===true?item.kifu.moves.length:stage===false?0:stage;
  for(const move of item.kifu.moves.slice(0,count)){
   const error=source.play(move.i,move.color);if(error)throw new Error(`案例 ${item.id} 含非法着手：${error}`);
  }
  source.board.forEach((color,i)=>{
   if(!color)return;
   const mapped=map(i);
   if(!Number.isInteger(mapped)||mapped<0||mapped>=361)throw new Error('案例映射超出棋盘：'+item.id);
   if(game.board[mapped])throw new Error('案例棋子重叠：'+item.id);
   game.board[mapped]=color;
  });
 }
 return game;
}

/** Dense visual atlas, not a legal combined Go position. Each case must be
 * evaluated on its original board; only its rendered primitives are moved.
 * Width/height include a one-grid gutter beyond the occupied/future bbox.
 * Rectangles are only translated, so renderer normals and thread handedness
 * require no rotations or reflections. */
export function packVisualCases(items:AtlasCase[]):AtlasBoard[]{
 if(new Set(items.map(i=>i.id)).size!==items.length)throw new Error('案例 ID 重复');
 type Rect={x:number;y:number;width:number;height:number};
 type VisualBin={board:AtlasBoard;free:Rect[]};
 const rectangles=items.map(item=>{
  const {points}=prepare(item),n=item.kifu.n;
  const xs=points.length?points.map(p=>p%n):[0],ys=points.length?points.map(p=>Math.floor(p/n)):[0];
  const left=Math.min(...xs),top=Math.min(...ys),spanX=Math.max(...xs)-left,spanY=Math.max(...ys)-top;
  return {item,points,left,top,spanX,spanY,width:Math.min(19,spanX+2),height:Math.min(19,spanY+2)};
 });
 rectangles.sort((a,b)=>Math.max(b.width,b.height)-Math.max(a.width,a.height)||b.width*b.height-a.width*a.height);
 const bins:VisualBin[]=[];
 for(const tile of rectangles){
  let chosen:{bin:VisualBin;rect:Rect;score:number}|undefined;
  for(const bin of bins)for(const rect of bin.free){
   if(rect.width<tile.width||rect.height<tile.height)continue;
   const spareX=rect.width-tile.width,spareY=rect.height-tile.height;
   const score=Math.min(spareX,spareY)*100+Math.max(spareX,spareY);
   if(!chosen||score<chosen.score)chosen={bin,rect,score};
  }
  if(!chosen){
   const bin:VisualBin={board:{placements:[],reserved:[],presentationOnly:true},free:[{x:0,y:0,width:19,height:19}]};
   bins.push(bin);chosen={bin,rect:bin.free[0],score:0};
  }
  const {bin,rect}=chosen,used={x:rect.x,y:rect.y,width:tile.width,height:tile.height};
  const map=(i:number)=>(Math.floor(i/tile.item.kifu.n)-tile.top+used.y)*19+i%tile.item.kifu.n-tile.left+used.x;
  bin.board.placements.push({item:tile.item,map,bounds:[used.x,used.y,used.x+tile.spanX,used.y+tile.spanY]});
  bin.board.reserved.push(...tile.points.map(map));
  const split:Rect[]=[];
  for(const r of bin.free){
   if(used.x>=r.x+r.width||used.x+used.width<=r.x||used.y>=r.y+r.height||used.y+used.height<=r.y){split.push(r);continue;}
   if(used.x>r.x)split.push({...r,width:used.x-r.x});
   if(used.x+used.width<r.x+r.width)split.push({...r,x:used.x+used.width,width:r.x+r.width-used.x-used.width});
   if(used.y>r.y)split.push({...r,height:used.y-r.y});
   if(used.y+used.height<r.y+r.height)split.push({...r,y:used.y+used.height,height:r.y+r.height-used.y-used.height});
  }
  bin.free=split.filter((a,i)=>!split.some((b,j)=>j!==i&&b.x<=a.x&&b.y<=a.y&&b.x+b.width>=a.x+a.width&&b.y+b.height>=a.y+a.height&&(j<i||b.x<a.x||b.y<a.y||b.width>a.width||b.height>a.height)));
 }
 return bins.map(b=>b.board);
}
