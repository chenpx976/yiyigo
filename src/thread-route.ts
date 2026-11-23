// Virtual jumps remain on the straight stone-to-stone axis. A short gap at
// intervening empty intersections keeps the grid point readable; no lateral bend.
export function threadClearance(x:number,length:number){
 const point=Math.round(x);
 return length>1.9 && point>0 && point<length ? .085-Math.abs(x-point) : -1;
}
export const threadRouteGLSL=`
float threadClearance(float x,float len){
 float point=floor(x+.5);
 return len>1.9&&point>0.&&point<len?.085-abs(x-point):-1.;
}
`;
