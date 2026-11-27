// Frozen pre-optimization reference (2026-11-27). Development comparison only.
import * as THREE from 'three';
import { attachmentHeightBounds, connectionEnvelopeGLSL } from '../connection-envelope';
import { connectionMotionGLSL } from '../connection-motion';
import { stoneProfile } from '../stone-profile';

// CPU reference for diagnostics, paired with the GLSL body intersection below.
// The origin is outside the ellipsoid, as on the renderer's ray-entry plane.
// Directions need not be normalized: the hit is origin + t * ray.
export function rayEllipsoidIntersection(
 origin: readonly [number, number, number], ray: readonly [number, number, number],
 center: readonly [number, number, number], radii: readonly [number, number, number],
): number | null {
 const ox=(origin[0]-center[0])/radii[0],oy=(origin[1]-center[1])/radii[1],oz=(origin[2]-center[2])/radii[2];
 const dx=ray[0]/radii[0],dy=ray[1]/radii[1],dz=ray[2]/radii[2];
 const a=dx*dx+dy*dy+dz*dz,closestTime=-(ox*dx+oy*dy+oz*dz)/a;
 const x=ox+closestTime*dx,y=oy+closestTime*dy,z=oz+closestTime*dz;
 const remaining=1-(x*x+y*y+z*z);
 if(remaining<0)return null;
 const distance=closestTime-Math.sqrt(remaining/a);
 return distance>=0?distance:null;
}

// Orthographic ray/solid intersection. Crowns and connections are evaluated as
// ONE 3D field, so no overlapping shells or painted seam normals are needed.
export const implicitFieldGLSL = `
uniform sampler2D uData;
uniform sampler2D uCrossings;
uniform float uTime;
uniform float uMotion;
${connectionMotionGLSL}
vec4 record(int i){return texelFetch(uData,ivec2(i%1024,i/1024),0);}
float ellipsoid(vec3 p,vec3 radii){
 float k0=length(p/radii),k1=length(p/(radii*radii));
 if(k0<.000001)return -min(radii.x,min(radii.y,radii.z));
 return k0*(k0-1.)/max(k1,.00001);
}
${connectionEnvelopeGLSL}
float sceneDistance(vec3 p,vec2 range){vec2 d=solidField(p,range);return min(d.x,d.y);}
// The body field's zero set is an ellipsoid. Solve it once per ray instead of
// evaluating every body at every march step. y bounds all attachment tops:
// taper stays between root and waist, cuts shrink z, and breathing changes y only.
vec2 surfaceRayLimits(vec3 origin,vec3 ray,vec2 range){
 float nearest=1.e20,top=-1.;
 for(int k=0;k<int(range.y);k++){
  int id=int(record(int(range.x)+k).x);
  vec4 info=record(id+1);
  if(info.x>.5){
   top=max(top,info.x<1.5?${attachmentHeightBounds.solid}:${attachmentHeightBounds.virtual});
   continue;
  }
  float life=nodeLife(id);if(life<.001)continue;
  float halfHeight=${stoneProfile.height / 2}*life;
  vec3 radii=vec3(${stoneProfile.radius}*life,${stoneProfile.radius}*life,halfHeight);
  vec3 offset=(origin-vec3(record(id).xy,halfHeight))/radii,direction=ray/radii;
  float a=dot(direction,direction),closestTime=-dot(offset,direction)/a;
  vec3 closest=offset+closestTime*direction;
  float remaining=1.-dot(closest,closest);
  if(remaining<0.)continue;
  float distance=closestTime-sqrt(remaining/a);
  if(distance>=0.&&origin.z+ray.z*distance>=.001)nearest=min(nearest,distance);
 }
 return vec2(nearest,top);
}
`;

export function createReferenceImplicitStones(geometry: THREE.BufferGeometry, uniforms: Record<string, {value: unknown}>) {
 const ray = {value: new THREE.Vector3(0,0,-1)};
 uniforms = {...uniforms, uRay:ray};
 const material = new THREE.ShaderMaterial({
  uniforms,
  vertexShader: `attribute vec2 aPoint;attribute vec2 aRange;
   varying vec2 vPoint;varying vec2 vRange;
   void main(){vPoint=aPoint;vRange=aRange;vec3 p=position;p.z=.5*uSpacing+.5;gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.);}`.replace('attribute vec2 aPoint;', 'uniform float uSpacing;attribute vec2 aPoint;'),
  fragmentShader: `precision highp float;
   varying vec2 vPoint;varying vec2 vRange;
   uniform float uSpacing;uniform vec3 uBlack;uniform vec3 uWhite;
   uniform mat4 projectionMatrix;uniform vec3 uRay;
   #include <packing>
   ${implicitFieldGLSL}
   void main(){
    vec3 origin=vec3(vPoint,.50),p=origin;bool hit=false;
    vec2 limits=surfaceRayLimits(origin,uRay,vRange);
    float travel=0.;
    if(limits.y<0.){
     if(limits.x==1.e20)discard;
     p=origin+uRay*limits.x;hit=true;
    }else{
     if(uRay.z<0.)travel=max(0.,(origin.z-limits.y-.00025)/-uRay.z);
     if(limits.x<=travel){p=origin+uRay*limits.x;hit=true;}
     else p=origin+uRay*travel;
    }
    for(int stepIndex=0;stepIndex<64;stepIndex++){
     if(hit)break;
     float d=attachmentDistance(p,vRange);
     if(d<.00025){hit=true;break;}
     travel+=max(.00015,d*.65);
     if(travel>=limits.x){p=origin+uRay*limits.x;hit=true;break;}
     p=origin+uRay*travel;
     if(p.z<.001)break;
    }
    if(!hit)discard;
    vec4 view=viewMatrix*vec4(50.+p.x*uSpacing,-50.-p.y*uSpacing,p.z*uSpacing+.5,1.);
    vec4 clip=projectionMatrix*view;
    gl_FragDepth=clip.z/clip.w*.5+.5;
    #ifdef SHADOW_PASS
      gl_FragColor=packDepthToRGBA(gl_FragDepth);
      return;
    #endif
    float e=.0015;
    vec3 normal=normalize(vec3(
     sceneDistance(p+vec3(e,0,0),vRange)-sceneDistance(p-vec3(e,0,0),vRange),
     sceneDistance(p+vec3(0,e,0),vRange)-sceneDistance(p-vec3(0,e,0),vRange),
     sceneDistance(p+vec3(0,0,e),vRange)-sceneDistance(p-vec3(0,0,e),vRange)));
    vec2 colors=solidField(p,vRange);float white=step(colors.y,colors.x);
    vec3 albedo=mix(uBlack,uWhite,white);
    vec3 light=normalize(vec3(-.65,-.75,1.1));
    float diffuse=pow(max(0.,dot(normal,light)),1.5);
    float fill=max(0.,dot(normal,normalize(vec3(.7,.3,.6))));
    // Broad form shading does the work; white has less specular energy, not more.
    float sheen=pow(max(0.,dot(normal,normalize(light+vec3(0,0,1)))),16.);
    float occlusion=clamp(sceneDistance(p+normal*.035,vRange)/.035,.65,1.);
    vec3 color=albedo*(.14*occlusion+.94*diffuse+.08*fill)+vec3(sheen*mix(.035,.006,white));
    gl_FragColor=vec4(color,1.);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
   }`,
  depthTest: true,
  depthWrite: true,
 });
 const depth = new THREE.ShaderMaterial({
  uniforms, vertexShader:material.vertexShader, fragmentShader:material.fragmentShader,
  defines:{SHADOW_PASS:1}, side:THREE.DoubleSide,
 });
 material.shadowSide=THREE.DoubleSide;
 const mesh = new THREE.Mesh(geometry,material);
 const setRay = (camera: THREE.Camera) => {
  camera.getWorldDirection(ray.value);
  ray.value.y *= -1;
 };
 mesh.onBeforeRender = (_renderer,_scene,camera) => setRay(camera);
 mesh.onBeforeShadow = (_renderer,_object,_camera,shadowCamera) => setRay(shadowCamera);
 mesh.customDepthMaterial=depth;
 mesh.castShadow=true;
 mesh.frustumCulled=false;
 mesh.renderOrder=2;
 return {mesh,material,depth};
}
