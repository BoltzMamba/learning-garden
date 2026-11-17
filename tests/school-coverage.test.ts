import assert from 'node:assert/strict';
import {test} from 'node:test';
import {OceanSim,mulberry32} from '../src/scripts/ocean-sim.ts';

function fixture(){
 const s=new OceanSim({width:1200,height:900,cell:12,cellH:17,rng:mulberry32(3),count:20});
 const counts=new Int32Array(12).fill(12);counts[8]=0;
 s.observeSchoolCoverage(counts,new Float32Array(20).fill(1));
 s.fish.forEach((f,i)=>{f.x=600+i*3;f.y=300;f.vx=30;f.vy=0;f.course=0;f.species=0;});
 return{s,counts};
}
test('sustained visible deficit recycles only fully departed, non-feeding fish through the edge',()=>{
 const {s}=fixture();s.coverage.quiet[8]=4;
 for(let i=1;i<=8;i++){s.fish[i].x=1225;s.fish[i].vx=36;}
 s.fish[1].target=99;s.pellets.push({id:99,batch:1,x:1230,y:300,vy:0,amount:1,born:0,wobble:0});
 const first={...s.fish[0]};const count=s.fish.length;s.step(1/60);
 assert.equal(s.fish.length,count);assert.equal(s.coverage.recycled,7);
 assert.ok(Math.hypot(s.fish[0].x-first.x,s.fish[0].y-first.y)<2,'on-screen fish must not teleport');
 assert.ok(s.fish[1].x>1200,'feeding fish not redirected');
 for(let i=2;i<=8;i++){assert.ok(s.fish[i].x<0);assert.ok(s.fish[i].y>600&&s.fish[i].y<900);assert.ok(s.fish[i].vx>0);}
 for(let k=0;k<180;k++)s.step(1/60);
 assert.ok(s.fish.slice(2,9).some(f=>f.x>0),'fish enter by normal integration');
});
test('brief gaps and faded offscreen fish do not trigger a refill',()=>{
 const {s,counts}=fixture();s.fish[2].x=1225;s.fish[2].vx=36;
 s.step(1/60);assert.equal(s.coverage.recycled,0);
 s.coverage.quiet[8]=4;
 const presence=new Float32Array(20).fill(0);s.observeSchoolCoverage(counts,presence);
 for(let k=0;k<120;k++)s.step(1/60);
 assert.equal(s.coverage.recycled,0);
});
test('incoming schools reserve their sparse region instead of flooding it every frame',()=>{
 const {s}=fixture();s.coverage.quiet[8]=4;
 for(const f of s.fish){f.x=1225;f.vx=36;}
 s.step(1/60);const admitted=s.coverage.recycled;assert.equal(admitted,7);
 for(let k=0;k<60;k++)s.step(1/60);
 assert.equal(s.coverage.recycled,admitted);
 s.resize(390,844,8);assert.ok(s.coverage.quiet.every(n=>n===0));
});
