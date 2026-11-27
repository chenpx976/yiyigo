import { attachmentRoot, wholeConnectionSection } from './connection-envelope';
import type { WholeConnection } from './connection-envelope';
import { cutEnvelope } from './connection-motion';
import { stoneProfile } from './stone-profile';

// Exact upper intersection of the existing elliptical section with a vertical
// ray. This changes the intersection algorithm, not the field or its roots.
export function connectionTopAt(point: readonly [number, number], edge: WholeConnection, breath = 1): number | null {
  const lifeA = edge.lifeA ?? 1, lifeB = edge.lifeB ?? 1, visibility = edge.visibility ?? 1;
  if (Math.min(lifeA, lifeB, visibility) < .001) return null;
  const dx = edge.b[0] - edge.a[0], dy = edge.b[1] - edge.a[1], length = Math.hypot(dx, dy);
  if (!length) return null;
  const qx = point[0] - edge.a[0], qy = point[1] - edge.a[1];
  const x = (qx * dx + qy * dy) / length, across = (-qx * dy + qy * dx) / length;
  const root = attachmentRoot(edge.solid, visibility);
  if (x < root * lifeA || x > length - root * lifeB) return null;
  const section = wholeConnectionSection(x, length, edge.solid, edge.strength ?? 1, lifeA, lifeB, visibility, edge.pressure ?? 0);
  const offset = x - (edge.cut ?? .5) * length;
  const sever = edge.solid ? { neck: 1, opening: 0 } : cutEnvelope(edge.gap ?? 0, offset, length);
  if (!edge.solid && sever.opening > 0 && sever.opening - Math.abs(offset) - .015 > 0) return null;
  let crossingNeck = 1;
  for (const c of edge.solid ? [] : edge.crossings ?? []) {
    const delta = Math.abs(x - c.t * length), amount = Math.max(0, Math.min(1, c.amount));
    if (.025 * amount * amount - delta > 0) return null;
    crossingNeck = Math.min(crossingNeck, 1 - amount * Math.exp(-((delta / .11) ** 2)));
  }
  const endpoint = x <= length / 2 ? lifeA : lifeB, local = Math.min(x, length - x);
  const u = Math.max(0, Math.min(1, (local - root * endpoint) / Math.max(.00001, length / 2 - root * endpoint)));
  const scale = Math.max(.001, 1 - u * u * (3 - 2 * u) * (1 - sever.neck * crossingNeck));
  const width = section.width * scale * breath, halfHeight = section.halfHeight * scale;
  const square = 1 - (across / width) ** 2;
  return square < 0 ? null : section.centerHeight + halfHeight * Math.sqrt(square);
}

export const verticalSurfaceGLSL = `
float verticalSurfaceHeight(vec2 point,vec2 range){
 float top=-1.;
 for(int k=0;k<int(range.y);k++){
  int id=int(record(int(range.x)+k).x);
  vec4 info=record(id+1),location=record(id);
  if(info.x<.5){
   float life=nodeLife(id);if(life<.001)continue;
   vec2 q=(point-location.xy)/(${stoneProfile.radius}*life);
   float square=1.-dot(q,q);
   if(square>=0.)top=max(top,${stoneProfile.height / 2}*life*(1.+sqrt(square)));
   continue;
  }
  float lifeA=nodeLife(int(info.z)),lifeB=nodeLife(int(info.w));
  if(min(lifeA,lifeB)<.001)continue;
  vec4 state=record(id+4);
  float ease=connectionEase((uTime-state.x)/.7,state.z>.5);
  vec4 tone=mix(record(id+2),record(id+3),ease);
  bool solid=info.x<1.5;
  float visibility=solid?tone.x:tone.z;if(visibility<.001)continue;
  vec2 delta=location.zw-location.xy;float len=length(delta);vec2 axis=delta/len;
  vec2 q=point-location.xy;float x=dot(q,axis),root=attachmentRoot(solid,visibility);
  if(x<root*lifeA||x>len-root*lifeB)continue;
  float across=dot(q,vec2(-axis.y,axis.x));
  // Maximum root width bounds all narrower sections (including breathing).
  if(abs(across)>.3)continue;
  vec3 section=wholeConnectionSection(x,len,solid,tone.x,lifeA,lifeB,visibility,tone.y);
  float endpoint=x<=len*.5?lifeA:lifeB,local=min(x,len-x);
  float influence=smoothstep(0.,1.,(local-root*endpoint)/max(.00001,len*.5-root*endpoint));
  float cutOffset=x-mix(state.w,state.y,ease)*len;
  vec2 sever=solid?vec2(1,0):cutEnvelope(tone.w,cutOffset,len);
  if(!solid&&sever.y>0.&&sever.y-abs(cutOffset)-.015>0.)continue;
  vec2 crossing=solid?vec2(1.,-1.):crossingEnvelope(id,x,len);
  if(crossing.y>0.)continue;
  float scale=max(.001,1.-influence*(1.-sever.x*crossing.x));
  float seed=dot(location.xy+location.zw,vec2(.17,.31));
  float breath=solid?1.:1.+.045*sin(uTime*1.65+seed)*uMotion*influence;
  float width=section.x*scale*breath;
  float square=1.-pow(across/width,2.);
  if(square>=0.)top=max(top,section.z+section.y*scale*sqrt(square));
 }
 return top;
}
`;
