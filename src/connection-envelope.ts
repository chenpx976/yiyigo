import { ellipsoidDistance, stoneProfile } from './stone-profile';
import { threadClearance } from './thread-route';
import { cutEnvelope } from './connection-motion';

// One edge owns its entire volume. Both endpoints meet the SAME waist; node
// lifecycle values only affect the corresponding root and the shared waist.
const clamp=(v:number)=>Math.max(0,Math.min(1,v));
const smooth=(v:number)=>{const t=clamp(v);return t*t*(3-2*t)};
const rootWidth=Math.sqrt(stoneProfile.radius**2-.36**2);
const rootSlope=-.36/rootWidth;
function taper(start:number,end:number,slope:number,span:number,u:number){
 const ratio=-slope*span/Math.max(1e-8,start-end);
 const denominator=ratio<1?(1+(ratio/2-1)*u)**2:1+(ratio-2)*u;
 return end+(start-end)*(1-u)**2/Math.max(1e-8,denominator);
}
export interface ConnectionSection {width:number;halfHeight:number;centerHeight:number}
export function wholeConnectionSection(x:number,length:number,solid:boolean,strength=1,lifeA=1,lifeB=1):ConnectionSection{
 const endpoint=x<=length/2?lifeA:lifeB,local=x<=length/2?x:length-x;
 const waistLife=Math.min(lifeA,lifeB),root=(solid?.36:.25)*endpoint;
 const span=Math.max(.00001,length/2-root),u=clamp((local-root)/span);
 if(!solid){
  const flare=Math.exp(-Math.pow(Math.max(0,local-.30*endpoint)/Math.max(.00001,.17*endpoint),2))*(1-smooth(u))**2,waist=(.010+.016*strength)*waistLife;
  return {width:waist+(.18*endpoint-waist)*flare,
   halfHeight:.020*waistLife+(.055*endpoint-.020*waistLife)*flare,
   centerHeight:.048*waistLife+(.128*endpoint-.048*waistLife)*flare};
 }
 const half=stoneProfile.height/2,height=half*rootWidth/stoneProfile.radius;
 const verticalSlope=half*rootSlope/stoneProfile.radius;
 const top=taper((half+height)*endpoint,.23*waistLife,verticalSlope,span,u);
 const bottomRaw=(2*u*u*u-3*u*u+1)*(half-height)*endpoint+(u*u*u-2*u*u+u)*span*(-verticalSlope)*Math.exp(-span*u/.08)+(-2*u*u*u+3*u*u)*.05*waistLife;
 const bottom=Math.min(bottomRaw,top-Math.max(.000002,.045*waistLife));
 return {width:taper(rootWidth*endpoint,.19*waistLife,rootSlope,span,u),halfHeight:(top-bottom)/2,centerHeight:(top+bottom)/2};
}
// Retained for the existing diagnostic caller; this now samples the actual
// whole-edge section rather than a separate prototype approximation.
export function envelopeSection(x:number,length:number,solid:boolean,strength=1){return wholeConnectionSection(x,length,solid,strength)}
export interface WholeConnection {
 a:[number,number]; b:[number,number]; solid:boolean; strength?:number;
 lifeA?:number;lifeB?:number;visibility?:number;pressure?:number;gap?:number;cut?:number;
}
export function wholeConnectionDistance(p:[number,number,number],edge:WholeConnection,n=19){
 const aLife=edge.lifeA??1,bLife=edge.lifeB??1,visibility=edge.visibility??1;
 if(Math.min(aLife,bLife,visibility)<.001)return 5;
 const dx=edge.b[0]-edge.a[0],dy=edge.b[1]-edge.a[1],len=Math.hypot(dx,dy);
 const ax=dx/len,ay=dy/len,qx=p[0]-edge.a[0],qy=p[1]-edge.a[1];
 const x=qx*ax+qy*ay,root=edge.solid?.36:.25;
 if(x<root*aLife||x>len-root*bLife)return 5;
 const s=wholeConnectionSection(x,len,edge.solid,edge.strength??1,aLife,bLife);
 const t=x/len,cutOffset=(t-(edge.cut??.5))*len,sever=edge.solid?{neck:1,opening:0}:cutEnvelope(edge.gap??0,cutOffset,len);
 const waist=4*t*(1-t),scale=visibility*(edge.solid?1:(1-.25*(edge.pressure??0)*waist)*sever.neck);
 const across=-qx*ay+qy*ax;
 let d=ellipsoidDistance(0,across,p[2]-s.centerHeight,s.width*Math.max(.001,scale),s.width*Math.max(.001,scale),s.halfHeight*Math.max(.001,scale));
 if(!edge.solid&&len>1.9)d=Math.max(d,threadClearance(x,len));
 if(!edge.solid&&sever.opening>0)d=Math.max(d,sever.opening-Math.abs(cutOffset)-.015);
 return d;
}
function union(a:number,b:number,k:number){const h=Math.max(k-Math.abs(a-b),0)/k;return Math.min(a,b)-h*h*k*.25}
export function wholeSurfaceDistance(p:[number,number,number],stones:{at:[number,number];life?:number}[],edges:WholeConnection[]){
 let body=5,life=1,attachments=5;
 for(const stone of stones){const l=stone.life??1;if(l<.001)continue;const d=ellipsoidDistance(p[0]-stone.at[0],p[1]-stone.at[1],p[2]-.175*l,.455*l,.455*l,.175*l);if(d<body){body=d;life=l}}
 for(const edge of edges)attachments=Math.min(attachments,wholeConnectionDistance(p,edge));
 const blend=.035*life*(1-smooth((p[2]-.19*life)/(.06*life)));
 return union(body,attachments,Math.max(.00001,blend));
}

export const connectionEnvelopeGLSL=`
float edgeTaper(float start,float end,float slope,float span,float u){
 float ratio=-slope*span/max(.00000001,start-end);
 float denominator=ratio<1.?pow(1.+(ratio*.5-1.)*u,2.):1.+(ratio-2.)*u;
 return end+(start-end)*pow(1.-u,2.)/max(.00000001,denominator);
}
vec3 wholeConnectionSection(float x,float len,bool solid,float strength,float lifeA,float lifeB){
 float endpoint=x<=len*.5?lifeA:lifeB,local=x<=len*.5?x:len-x;
 float waistLife=min(lifeA,lifeB),root=(solid?.36:.25)*endpoint;
 float span=max(.00001,len*.5-root),u=clamp((local-root)/span,0.,1.);
 if(!solid){
  float flare=exp(-pow(max(0.,local-.30*endpoint)/max(.00001,.17*endpoint),2.))*pow(1.-u*u*(3.-2.*u),2.),waist=(.010+.016*strength)*waistLife;
  return vec3(waist+(.18*endpoint-waist)*flare,.020*waistLife+(.055*endpoint-.020*waistLife)*flare,.048*waistLife+(.128*endpoint-.048*waistLife)*flare);
 }
 float width=${rootWidth},slope=${rootSlope},halfHeight=${stoneProfile.height/2};
 float height=halfHeight*width/${stoneProfile.radius},verticalSlope=halfHeight*slope/${stoneProfile.radius};
 float top=edgeTaper((halfHeight+height)*endpoint,.23*waistLife,verticalSlope,span,u);
 float rawBottom=(2.*u*u*u-3.*u*u+1.)*(halfHeight-height)*endpoint+(u*u*u-2.*u*u+u)*span*(-verticalSlope)*exp(-span*u/.08)+(-2.*u*u*u+3.*u*u)*.05*waistLife;
 float bottom=min(rawBottom,top-max(.000002,.045*waistLife));
 return vec3(edgeTaper(width*endpoint,.19*waistLife,slope,span,u),(top-bottom)*.5,(top+bottom)*.5);
}
float nodeLife(int id){
 if(id<0)return 0.;
 return mix(record(id+2).x,record(id+3).x,smoothstep(0.,.7,uTime-record(id+4).x));
}
vec2 solidField(vec3 p,vec2 range){
 vec2 bodies=vec2(5.),attachments=vec2(5.),bodyLife=vec2(1.);
 for(int k=0;k<int(range.y);k++){
  int id=int(record(int(range.x)+k).x);
  vec4 info=record(id+1),location=record(id);
  int color=int(info.y)-1;
  if(info.x<.5){
   float life=nodeLife(id);if(life<.001)continue;
   float halfHeight=${stoneProfile.height}*.5*life;
   float body=ellipsoid(p-vec3(location.xy,halfHeight),vec3(${stoneProfile.radius}*life,${stoneProfile.radius}*life,halfHeight));
   if(body<bodies[color]){bodies[color]=body;bodyLife[color]=life;}
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
  vec2 q=p.xy-location.xy;float x=dot(q,axis),root=solid?.36:.25;
  if(x<root*lifeA||x>len-root*lifeB)continue;
  vec3 section=wholeConnectionSection(x,len,solid,tone.x,lifeA,lifeB);
  float t=x/len,waist=4.*t*(1.-t);
  float cutPosition=mix(state.w,state.y,connectionEase((uTime-state.x)/.7,state.z>.5));
  float cutOffset=(t-cutPosition)*len;
  vec2 sever=solid?vec2(1,0):cutEnvelope(tone.w,cutOffset,len);
  float scale=visibility*(solid?1.:(1.-.25*tone.y*waist)*sever.x);
  section.xy*=max(.001,scale);
  float across=dot(q,vec2(-axis.y,axis.x));
  float seed=dot(location.xy+location.zw,vec2(.17,.31));
  float breath=solid?1.:1.+.045*sin(uTime*1.65+seed)*uMotion*waist;
  float d=ellipsoid(vec3(0,across,p.z-section.z),vec3(section.x,section.x*breath,section.y));
  if(!solid&&len>1.9)d=max(d,threadClearance(x,len));
  if(!solid&&sever.y>0.)d=max(d,sever.y-abs(cutOffset)-.015);
  attachments[color]=min(attachments[color],d);
 }
 vec2 result;
 for(int color=0;color<2;color++){
  float life=bodyLife[color];
  float blend=.035*life*(1.-smoothstep(.19*life,.25*life,p.z));
  result[color]=unionDistance(bodies[color],attachments[color],max(.00001,blend));
 }
 return result;
}
`;
