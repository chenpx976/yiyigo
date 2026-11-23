// Rounded stone bodies stay fixed; the shared field blends attached material
// beneath their crowns without overlapping surface shells.
export const stoneProfile = Object.freeze({ radius: .455, height: .35 });
export const connectionProfile = Object.freeze({ blend:.025 });
export function ellipsoidDistance(x:number,y:number,z:number,rx:number,ry:number,rz:number) {
 const k0=Math.hypot(x/rx,y/ry,z/rz);
 if(k0<1e-6)return -Math.min(rx,ry,rz);
 return k0*(k0-1)/Math.hypot(x/(rx*rx),y/(ry*ry),z/(rz*rz));
}
// Match the rigid stone's cross-section AND slope at the attachment boundary.
// A rational taper stays positive even for long jumps with a steep root tangent.
function taper(start:number,end:number,slope:number,span:number,u:number) {
 const ratio=-slope*span/(start-end);
 const denominator=ratio<1?(1+(ratio/2-1)*u)**2:1+(ratio-2)*u;
 return end+(start-end)*(1-u)**2/denominator;
}
export function attachmentStart(solid:boolean){return solid?.36:.42;}
export function stretchedSection(x:number,length:number,solid:boolean,strength=1,crowding=0) {
 const root=attachmentStart(solid),span=length/2-root;
 const u=Math.min(1,Math.max(0,(x-root)/span));
 const radius=stoneProfile.radius,half=stoneProfile.height/2;
 const width=Math.sqrt(radius*radius-root*root),slope=-root/width;
 const height=half*width/radius,verticalSlope=half*slope/radius;
 const waist=solid?.19:.014+.025*strength;
 const waistHeight=solid?.09:waist*.55;
 const waistCenter=solid?.14:waistHeight+.012;
 const shoulderSpace=Math.max(0,Math.min(1,(span-.32)/.38));
 const shoulder=solid?0:Math.sin(Math.PI*u)**2*(1-u)*shoulderSpace;
 const top=.04*shoulder+taper(half+height,waistCenter+waistHeight,verticalSlope,span,u);
 const h00=2*u*u*u-3*u*u+1,h10=u*u*u-2*u*u+u,h01=-2*u*u*u+3*u*u;
 const rawBottom=h00*(half-height)+h10*span*(-verticalSlope)*Math.exp(-span*u/.08)+h01*(waistCenter-waistHeight);
 const bottom=Math.min(rawBottom,top-Math.max(.002,waistHeight*.5));
 // Contract only the attachment shoulder. Zero value and slope at both ends
 // preserve the rigid body's tangent and a shared midpoint between endpoints.
 const gather=solid?0:Math.min(1,Math.max(0,crowding))*Math.sin(Math.PI*u)**2;
 return {width:(taper(width,waist,slope,span,u)+.03*shoulder)*(1-.48*gather),halfHeight:(top-bottom)/2*(1-.22*gather),centerHeight:(top+bottom)/2-.012*gather};
}
export function stretchedDistance(x:number,y:number,z:number,length:number,solid:boolean,strength=1) {
 const base=ellipsoidDistance(x,y,z-stoneProfile.height/2,stoneProfile.radius,stoneProfile.radius,stoneProfile.height/2);
 if(x<=attachmentStart(solid))return base;
 const s=stretchedSection(x,length,solid,strength);
 const attachment=ellipsoidDistance(0,y,z-s.centerHeight,s.width,s.width,s.halfHeight)+8*Math.max(0,x-length/2)**2;
 return Math.min(base,attachment);
}
export const stretchedSectionGLSL = `
float attachmentStart(bool solid){return solid?.36:.42;}
float tangentTaper(float start,float end,float slope,float span,float u){
 float ratio=-slope*span/(start-end);
 float denominator=ratio<1.?pow(1.+(ratio*.5-1.)*u,2.):1.+(ratio-2.)*u;
 return end+(start-end)*(1.-u)*(1.-u)/denominator;
}
vec3 stretchedSection(float x,float len,bool solid,float strength,float crowding){
 float root=attachmentStart(solid),span=len*.5-root,u=clamp((x-root)/span,0.,1.);
 float radius=${stoneProfile.radius},halfHeight=${stoneProfile.height/2};
 float width=sqrt(radius*radius-root*root),slope=-root/width;
 float height=halfHeight*width/radius,verticalSlope=halfHeight*slope/radius;
 float waist=solid?.19:.014+.025*strength;
 float waistHeight=solid?.09:waist*.55,waistCenter=solid?.14:waistHeight+.012;
 float shoulder=solid?0.:pow(sin(3.14159265*u),2.)*(1.-u)*clamp((span-.32)/.38,0.,1.);
 float top=.04*shoulder+tangentTaper(halfHeight+height,waistCenter+waistHeight,verticalSlope,span,u);
 float rawBottom=(2.*u*u*u-3.*u*u+1.)*(halfHeight-height)+(u*u*u-2.*u*u+u)*span*(-verticalSlope)*exp(-span*u/.08)+(-2.*u*u*u+3.*u*u)*(waistCenter-waistHeight);
 float bottom=min(rawBottom,top-max(.002,waistHeight*.5));
 float gather=solid?0.:clamp(crowding,0.,1.)*pow(sin(3.14159265*u),2.);
 return vec3((tangentTaper(width,waist,slope,span,u)+.03*shoulder)*(1.-.48*gather),(top-bottom)*.5*(1.-.22*gather),(top+bottom)*.5-.012*gather);
}
`;
