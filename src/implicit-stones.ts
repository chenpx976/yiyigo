import * as THREE from 'three';
import { connectionEnvelopeGLSL } from './connection-envelope';
import { threadRouteGLSL } from './thread-route';
import { connectionMotionGLSL } from './connection-motion';

// Orthographic ray/solid intersection. Crowns and connections are evaluated as
// ONE 3D field, so no overlapping shells or painted seam normals are needed.
export const implicitFieldGLSL = `
uniform sampler2D uData;
uniform float uTime;
uniform float uMotion;
uniform float uBoardSize;
${connectionMotionGLSL}
${threadRouteGLSL}
vec4 record(int i){return texelFetch(uData,ivec2(i%1024,i/1024),0);}
float unionDistance(float a,float b,float k){float h=max(k-abs(a-b),0.)/k;return min(a,b)-h*h*k*.25;}
float ellipsoid(vec3 p,vec3 radii){
 float k0=length(p/radii),k1=length(p/(radii*radii));
 if(k0<.000001)return -min(radii.x,min(radii.y,radii.z));
 return k0*(k0-1.)/max(k1,.00001);
}
${connectionEnvelopeGLSL}
float sceneDistance(vec3 p,vec2 range){vec2 d=solidField(p,range);return min(d.x,d.y);}
`;

export function createImplicitStones(geometry: THREE.BufferGeometry, uniforms: Record<string, {value: unknown}>) {
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
    vec3 p=vec3(vPoint,.50);float d=1.;bool hit=false;
    for(int stepIndex=0;stepIndex<64;stepIndex++){
     d=sceneDistance(p,vRange);
     if(d<.00025){hit=true;break;}
     p+=uRay*max(.00015,d*.65);
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
