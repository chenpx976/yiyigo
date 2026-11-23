import { ellipsoidDistance, stoneProfile } from './stone-profile';
import { cutEnvelope } from './connection-motion';

// Fixed stone bodies; a connection extends the exact side cross-section and
// tangent. One whole edge owns its waist, even during unequal endpoint growth.
const clamp = (v: number) => Math.max(0, Math.min(1, v));
export const attachmentRoot = (solid: boolean, visibility=1) => {
 const base=solid ? .36 : .42;
 return base+(stoneProfile.radius-.0001-base)*(1-clamp(visibility))**2;
};
// All lifecycle/visibility values are in [0,1]. Taper remains between its root
// and waist heights; cuts shrink the section, and breathing affects width only.
export const attachmentHeightBounds = Object.freeze({
 solid: stoneProfile.height / 2 * (1 + Math.sqrt(1 - (attachmentRoot(true) / stoneProfile.radius) ** 2)),
 virtual: stoneProfile.height / 2 * (1 + Math.sqrt(1 - (attachmentRoot(false) / stoneProfile.radius) ** 2)),
});
const smooth=(u:number)=>{const t=clamp(u);return t*t*(3-2*t)};
export const neckProfile = Object.freeze({ solidWidth: .205, solidTop: .225, solidBottom: .045, virtualWidth: .012, virtualStrength: .022 });
function taper(start: number, end: number, slope: number, span: number, u: number) {
 const ratio = -slope * span / Math.max(1e-8, start-end);
 const denominator = ratio < 1 ? (1+(ratio/2-1)*u)**2 : 1+(ratio-2)*u;
 return end+(start-end)*(1-u)**2/Math.max(1e-8, denominator);
}
export interface ConnectionSection { width: number; halfHeight: number; centerHeight: number }
export function wholeConnectionSection(x: number, length: number, solid: boolean, strength=1, lifeA=1, lifeB=1, visibility=1, pressure=0): ConnectionSection {
 const endpoint = x <= length/2 ? lifeA : lifeB;
 const local = x <= length/2 ? x : length-x;
 const waistLife = Math.min(lifeA, lifeB), root = attachmentRoot(solid,visibility);
 const span = Math.max(.00001, length/2-root*endpoint), u = clamp((local-root*endpoint)/span);
 const half = stoneProfile.height/2, width = Math.sqrt(stoneProfile.radius**2-root**2);
 const slope = -root/width, height = half*width/stoneProfile.radius, verticalSlope = half*slope/stoneProfile.radius;
 const waist = (solid ? neckProfile.solidWidth : (neckProfile.virtualWidth+neckProfile.virtualStrength*strength)*(1-.25*pressure))*waistLife*visibility;
 const waistTop = solid ? neckProfile.solidTop*waistLife*visibility : .018*waistLife*visibility+waist*.96;
 const waistBottom = (solid ? neckProfile.solidBottom : .018)*waistLife*visibility;
 const top = taper((half+height)*endpoint, waistTop, verticalSlope, span, u);
 // A short, tangent-matched rise at the lower root joins a positive, sagging
 // section. Exponential damping prevents inverted bellies on long/landing edges.
 const rawBottom = (2*u*u*u-3*u*u+1)*(half-height)*endpoint
  +(u*u*u-2*u*u+u)*span*(-verticalSlope)*Math.exp(-span*u/Math.max(.00001,.065*endpoint))
  +(-2*u*u*u+3*u*u)*waistBottom;
 const bottom = Math.min(rawBottom, top-Math.max(.000002,waist*.35));
 return { width: taper(width*endpoint,waist,slope,span,u), halfHeight: (top-bottom)/2, centerHeight: (top+bottom)/2 };
}
export interface WholeConnection {
 a:[number,number]; b:[number,number]; solid:boolean; strength?:number;
 lifeA?:number;lifeB?:number;visibility?:number;pressure?:number;gap?:number;cut?:number;
 crossings?: { t:number; amount:number }[];
}
export function wholeConnectionDistance(p:[number,number,number],edge:WholeConnection){
 const aLife=edge.lifeA??1,bLife=edge.lifeB??1,visibility=edge.visibility??1;
 if(Math.min(aLife,bLife,visibility)<.001)return 5;
 const dx=edge.b[0]-edge.a[0],dy=edge.b[1]-edge.a[1],len=Math.hypot(dx,dy);
 const ax=dx/len,ay=dy/len,qx=p[0]-edge.a[0],qy=p[1]-edge.a[1];
 const x=qx*ax+qy*ay,root=attachmentRoot(edge.solid,visibility);
 if(x<root*aLife||x>len-root*bLife)return 5;
 const s=wholeConnectionSection(x,len,edge.solid,edge.strength??1,aLife,bLife,visibility,edge.pressure??0);
 const t=x/len,cutOffset=(t-(edge.cut??.5))*len,sever=edge.solid?{neck:1,opening:0}:cutEnvelope(edge.gap??0,cutOffset,len);
 const endpoint=x<=len/2?aLife:bLife,local=x<=len/2?x:len-x;
 const influence=smooth((local-root*endpoint)/Math.max(.00001,len/2-root*endpoint));
 let crossingOpening=-1,crossingNeck=1;
 for(const crossing of edge.solid?[]:(edge.crossings??[])){
  const offset=Math.abs(x-crossing.t*len),amount=clamp(crossing.amount);
  crossingNeck=Math.min(crossingNeck,1-amount*Math.exp(-((offset/.11)**2)));
  crossingOpening=Math.max(crossingOpening,.025*amount*amount-offset);
 }
 const scale=1-influence*(1-sever.neck*crossingNeck);
 const across=-qx*ay+qy*ax;
 let d=ellipsoidDistance(0,across,p[2]-s.centerHeight,s.width*Math.max(.001,scale),s.width*Math.max(.001,scale),s.halfHeight*Math.max(.001,scale));
 if(!edge.solid&&sever.opening>0)d=Math.max(d,sever.opening-Math.abs(cutOffset)-.015);
 return Math.max(d,crossingOpening);
}
export function wholeSurfaceDistance(p:[number,number,number],stones:{at:[number,number];life?:number}[],edges:WholeConnection[]){
 let body=5,attachments=5;
 for(const stone of stones){const l=stone.life??1;if(l<.001)continue;const d=ellipsoidDistance(p[0]-stone.at[0],p[1]-stone.at[1],p[2]-.175*l,.455*l,.455*l,.175*l);body=Math.min(body,d)}
 for(const edge of edges)attachments=Math.min(attachments,wholeConnectionDistance(p,edge));
 // Exact tangency supplies the join: a smoothing radius would add a collar.
 return Math.min(body,attachments);
}

export const connectionEnvelopeGLSL=`
float edgeTaper(float start,float end,float slope,float span,float u){
 float ratio=-slope*span/max(.00000001,start-end);
 float denominator=ratio<1.?pow(1.+(ratio*.5-1.)*u,2.):1.+(ratio-2.)*u;
 return end+(start-end)*pow(1.-u,2.)/max(.00000001,denominator);
}
float attachmentRoot(bool solid,float visibility){
 float base=solid?${attachmentRoot(true)}:${attachmentRoot(false)};
 return base+(${stoneProfile.radius}-.0001-base)*pow(1.-clamp(visibility,0.,1.),2.);
}
vec3 wholeConnectionSection(float x,float len,bool solid,float strength,float lifeA,float lifeB,float visibility,float pressure){
 float endpoint=x<=len*.5?lifeA:lifeB,local=x<=len*.5?x:len-x;
 float waistLife=min(lifeA,lifeB),root=attachmentRoot(solid,visibility);
 float span=max(.00001,len*.5-root*endpoint),u=clamp((local-root*endpoint)/span,0.,1.);
 float halfHeight=${stoneProfile.height/2},radius=${stoneProfile.radius};
 float width=sqrt(radius*radius-root*root),slope=-root/width;
 float height=halfHeight*width/radius,verticalSlope=halfHeight*slope/radius;
 float waist=(solid?${neckProfile.solidWidth}:(${neckProfile.virtualWidth}+${neckProfile.virtualStrength}*strength)*(1.-.25*pressure))*waistLife*visibility;
 float waistTop=solid?${neckProfile.solidTop}*waistLife*visibility:.018*waistLife*visibility+waist*.96;
 float waistBottom=(solid?${neckProfile.solidBottom}:.018)*waistLife*visibility;
 float top=edgeTaper((halfHeight+height)*endpoint,waistTop,verticalSlope,span,u);
 float rawBottom=(2.*u*u*u-3.*u*u+1.)*(halfHeight-height)*endpoint
  +(u*u*u-2.*u*u+u)*span*(-verticalSlope)*exp(-span*u/max(.00001,.065*endpoint))
  +(-2.*u*u*u+3.*u*u)*waistBottom;
 float bottom=min(rawBottom,top-max(.000002,waist*.35));
 return vec3(edgeTaper(width*endpoint,waist,slope,span,u),(top-bottom)*.5,(top+bottom)*.5);
}
vec4 crossingRecord(int i){return texelFetch(uCrossings,ivec2(i%1024,i/1024),0);}
// Opposing potential paths compete for a point. Their separate tapered ends
// yield at that crossing; a normal empty intersection never receives this mask.
vec2 crossingEnvelope(int id,float x,float len){
 vec4 header=crossingRecord(id/5);float neck=1.,opening=-1.;
 for(int k=0;k<int(header.y);k++){
  vec4 state=crossingRecord(int(header.x)+k);
  float amount=mix(state.y,state.z,smoothstep(0.,.7,uTime-state.w));
  float offset=abs(x-state.x*len);
  neck=min(neck,1.-amount*exp(-pow(offset/.11,2.)));
  opening=max(opening,.025*amount*amount-offset);
 }
 return vec2(neck,opening);
}
float nodeLife(int id){
 if(id<0)return 0.;
 return mix(record(id+2).x,record(id+3).x,smoothstep(0.,.7,uTime-record(id+4).x));
}
vec2 surfaceField(vec3 p,vec2 range,bool includeBodies){
 vec2 bodies=vec2(5.),attachments=vec2(5.);
 for(int k=0;k<int(range.y);k++){
  int id=int(record(int(range.x)+k).x);
  vec4 info=record(id+1);
  if(info.x<.5&&!includeBodies)continue;
  vec4 location=record(id);
  int color=int(info.y)-1;
  if(info.x<.5){
   float life=nodeLife(id);if(life<.001)continue;
   float halfHeight=${stoneProfile.height}*.5*life;
   float body=ellipsoid(p-vec3(location.xy,halfHeight),vec3(${stoneProfile.radius}*life,${stoneProfile.radius}*life,halfHeight));
   bodies[color]=min(bodies[color],body);
   continue;
  }
  // Each edge appears only once in a tile's primitive list. Endpoint references
  // supply lifecycle; they do not independently generate half connections.
  float lifeA=nodeLife(int(info.z)),lifeB=nodeLife(int(info.w));
  if(min(lifeA,lifeB)<.001)continue;
  vec4 state=record(id+4);
  vec4 tone=mix(record(id+2),record(id+3),connectionEase((uTime-state.x)/.7,state.z>.5));
  bool solid=info.x<1.5;
  float visibility=solid?tone.x:tone.z;if(visibility<.001)continue;
  vec2 delta=location.zw-location.xy;float len=length(delta);vec2 axis=delta/len;
  vec2 q=p.xy-location.xy;float x=dot(q,axis),root=attachmentRoot(solid,visibility);
  if(x<root*lifeA||x>len-root*lifeB)continue;
  vec3 section=wholeConnectionSection(x,len,solid,tone.x,lifeA,lifeB,visibility,tone.y);
  float t=x/len,endpoint=x<=len*.5?lifeA:lifeB,local=x<=len*.5?x:len-x;
  float influence=smoothstep(0.,1.,(local-root*endpoint)/max(.00001,len*.5-root*endpoint));
  float cutPosition=mix(state.w,state.y,connectionEase((uTime-state.x)/.7,state.z>.5));
  float cutOffset=(t-cutPosition)*len;
  vec2 sever=solid?vec2(1,0):cutEnvelope(tone.w,cutOffset,len);
  vec2 crossing=solid?vec2(1.,-1.):crossingEnvelope(id,x,len);
  float scale=1.-influence*(1.-sever.x*crossing.x);
  section.xy*=max(.001,scale);
  float across=dot(q,vec2(-axis.y,axis.x));
  float seed=dot(location.xy+location.zw,vec2(.17,.31));
  float breath=solid?1.:1.+.045*sin(uTime*1.65+seed)*uMotion*influence;
  float d=ellipsoid(vec3(0,across,p.z-section.z),vec3(section.x,section.x*breath,section.y));
  if(!solid&&sever.y>0.)d=max(d,sever.y-abs(cutOffset)-.015);
  attachments[color]=min(attachments[color],max(d,crossing.y));
 }
 // Tangent continuation, with no additive blend collar or accumulated volume.
 return min(bodies,attachments);
}
vec2 solidField(vec3 p,vec2 range){return surfaceField(p,range,true);}
float attachmentDistance(vec3 p,vec2 range){vec2 d=surfaceField(p,range,false);return min(d.x,d.y);}
`;
