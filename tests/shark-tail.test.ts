import assert from 'node:assert/strict';
import {test} from 'node:test';
import {CreatureWorld} from '../src/scripts/creatures/creatures.ts';
import {CreatureRaster} from '../src/scripts/creatures/raster.ts';
import {KINDS,SHAPES} from '../src/scripts/creatures/shapes.ts';

test('forked shark fins never wrap around the clamped tail endpoint at any heading',()=>{
 const w=new CreatureWorld(),r=new CreatureRaster();r.resize(220,180,5,7.5);
 for(const kind of KINDS){const shape=SHAPES[kind];if(shape.plan!=='shark'||!shape.caudal)continue;
 for(const heading of [0,.7,Math.PI/2,Math.PI])for(const phase of [0,2]){
 const c=w.make(1,kind,350,550,650,heading);c.phase=phase;r.rasterize([c]);
 const spine=(r as unknown as {spine:Float32Array}).spine;
 const tx=spine[38]-spine[36],ty=spine[39]-spine[37],len=Math.hypot(tx,ty);
 for(let i=0;i<r.flag.length;i++)if(r.flag[i]){
 const x=(i%r.cols+.5)*r.cw,y=(Math.floor(i/r.cols)+.5)*r.ch;
 const beyond=((x-spine[38])*tx+(y-spine[39])*ty)/len;
 assert.ok(beyond<Math.hypot(r.cw,r.ch),`${kind},${heading}: circular tail cap at ${beyond}`);
 }
 // Open notch and distinct upper/lower reaches, checked in body coordinates.
 const sample=(r as unknown as {sampleShark:(...args:unknown[])=>boolean}).sampleShark.bind(r);
 assert.equal(sample(shape,.975,0,1,0,-1,350),false);
 assert.equal(sample(shape,.96,shape.caudal*350*.60,1,0,-1,350),true);
 assert.equal(sample(shape,.96,shape.caudal*350*.92,-1,0,1,350),false);
 }}
});
