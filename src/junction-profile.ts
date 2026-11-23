// Directional shoulder competition (presentation only). A stone is a rigid hub;
// attachments share angular space, never inflate a common central blob.
// K(theta) = ((1 + cos(theta))/2)^2: opposite pulls do not compete,
// perpendicular pulls compete weakly, and nearby directions compete strongly.
export function shoulderCrowding(axis:[number,number], pulls:{axis:[number,number]; visibility:number}[], ownVisibility:number){
 const energy=pulls.reduce((sum,p)=>sum+p.visibility*((1+axis[0]*p.axis[0]+axis[1]*p.axis[1])/2)**2,0)-ownVisibility;
 const t=Math.max(0,Math.min(1,(energy-.12)/.93));
 return t*t*(3-2*t);
}
// The first two angular moments evaluate the same kernel without a nested
// edge loop in each raymarch sample. Input axes must be unit vectors.
export const junctionProfileGLSL=`
float shoulderCrowding(vec2 axis,float weight,float mass,vec2 firstMoment,vec2 secondMoment){
 vec2 doubled=vec2(axis.x*axis.x-axis.y*axis.y,2.*axis.x*axis.y);
 float energy=.375*mass+.5*dot(axis,firstMoment)+.125*dot(doubled,secondMoment)-weight;
 return smoothstep(.12,1.05,energy);
}
`;
