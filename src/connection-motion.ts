// Shape envelopes act only on connection material, never on the rigid stone.
const smooth = (a:number,b:number,x:number) => {
 const t=Math.max(0,Math.min(1,(x-a)/(b-a)));return t*t*(3-2*t);
};
export function connectionEase(progress:number,merging=false){
 return smooth(merging?.22:0,1,progress);
}
export function cutEnvelope(gap:number,offset:number,length:number){
 const pinch=smooth(0,.36,gap);
 return {
  neck:1-.96*pinch*Math.exp(-Math.pow(offset/.16,2)),
  opening:smooth(.35,1,gap)*length*.45,
 };
}
export const connectionMotionGLSL = `
float connectionEase(float progress,bool merging){return smoothstep(merging?.22:0.,1.,progress);}
vec2 cutEnvelope(float gap,float offset,float len){
 return vec2(1.-.96*smoothstep(0.,.36,gap)*exp(-pow(offset/.16,2.)),smoothstep(.35,1.,gap)*len*.45);
}
`;
