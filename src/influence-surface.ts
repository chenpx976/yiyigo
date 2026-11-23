import * as THREE from 'three';
import type { Go } from './engine';
import { InfluenceTransition } from './influence-transition';

/** A translucent change of the wood tone below the grid, never territory paint. */
export function createInfluenceSurface() {
  const state = new InfluenceTransition();
  const makeTexture = (data: Float32Array, n: number) => {
    const texture = new THREE.DataTexture(data, n, n, THREE.RGBAFormat, THREE.FloatType);
    texture.minFilter = texture.magFilter = THREE.NearestFilter;
    texture.needsUpdate = true;
    return texture;
  };
  let origin = makeTexture(new Float32Array(4), 1), target = makeTexture(new Float32Array(4), 1);
  const material = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, toneMapped: false,
    uniforms: {
      uFrom: { value: origin }, uTo: { value: target }, uMix: { value: 1 },
      uSize: { value: 19 },
      uBlack: { value: new THREE.Color('#30352f') },
      uWhite: { value: new THREE.Color('#fff7e6') },
      uContest: { value: new THREE.Color('#898475') },
    },
    vertexShader: `varying vec2 vPoint;
      void main(){vPoint=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
    fragmentShader: `
      uniform sampler2D uFrom,uTo;
      uniform float uMix,uSize;
      uniform vec3 uBlack,uWhite,uContest;
      varying vec2 vPoint;
      vec4 weights(float f){
        float q=1.-f;
        return vec4(q*q*q,3.*f*f*f-6.*f*f+4.,-3.*f*f*f+3.*f*f+3.*f+1.,f*f*f)/6.;
      }
      vec2 channels(vec2 p){
        vec2 base=floor(p), f=fract(p);vec4 wx=weights(f.x),wy=weights(f.y);vec2 result=vec2(0.);
        for(int y=0;y<4;y++)for(int x=0;x<4;x++){
          vec2 at=(clamp(base+vec2(float(x-1),float(y-1)),vec2(0.),vec2(uSize-1.))+.5)/uSize;
          result+=mix(texture2D(uFrom,at).rg,texture2D(uTo,at).rg,uMix)*wx[x]*wy[y];
        }
        return result;
      }
      void main(){
        // A 740-unit surface includes a feathered margin beyond the 660-unit grid.
        vec2 p=(vec2(vPoint.x,1.-vPoint.y)*740.-40.)/660.*(uSize-1.);
        vec2 c=channels(p);
        float advantage=c.x-c.y, contest=2.*min(c.x,c.y);
        float b=.19*pow(max(advantage,0.),.72);
        float w=.32*pow(max(-advantage,0.),.72);
        float shared=.10*pow(contest,.8);
        float outside=max(max(-p.x,-p.y),max(p.x-uSize+1.,p.y-uSize+1.));
        float feather=1.-smoothstep(0.,.95,outside);
        float alpha=(b+w+shared)*feather;
        vec3 color=(uBlack*b+uWhite*w+uContest*shared)/max(.00001,b+w+shared);
        gl_FragColor=vec4(color,alpha);
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(740,740), material);
  mesh.position.set(380,-380,.25);
  // Below lines and game hints, but above the wood itself.
  mesh.renderOrder = -1;
  return {
    mesh,
    update(game: Go, time: number, animate: boolean, motion = true) {
      if (state.update(game, time, animate && motion)) {
        origin.dispose(); target.dispose();
        origin = makeTexture(state.from, game.n); target = makeTexture(state.to, game.n);
        material.uniforms.uFrom.value = origin; material.uniforms.uTo.value = target;
        material.uniforms.uSize.value = game.n;
      }
      if (!motion) state.settle(time);
      material.uniforms.uMix.value = motion ? state.amount(time) : 1;
    },
    setTime(time: number, motion = true) { material.uniforms.uMix.value = motion ? state.amount(time) : 1; },
    dispose() { mesh.removeFromParent(); mesh.geometry.dispose(); material.dispose(); origin.dispose(); target.dispose(); },
  };
}
