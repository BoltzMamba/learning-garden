import assert from 'node:assert/strict';
import {test} from 'node:test';
import {SchoolDensity} from '../src/scripts/school-density.ts';
import {CreatureWorld} from '../src/scripts/creatures/creatures.ts';
import {CreatureRaster,FLAG_FIN,FLAG_WHIP,type CreaturePalette} from '../src/scripts/creatures/raster.ts';
import {KINDS} from '../src/scripts/creatures/shapes.ts';
const palette={edge:[50,80,70],eye:'#123',tintStrength:0} as CreaturePalette;
test('all species retain binary heads, fins and tails at several poses and phases',()=>{
 const w=new CreatureWorld(),r=new CreatureRaster();r.resize(160,110,7,10.5);
 for(const kind of KINDS)for(const heading of [0,.65,1.7])for(const phase of [0,2]){
  const c=w.make(1,kind,320,650,550,heading);c.phase=phase;r.rasterize([c]);
  const counts=Array.from({length:4},()=>({total:0,binary:0}));
  const ctx={globalAlpha:1,fillStyle:'',fillText(g:string,x:number,y:number){
   const i=Math.floor(y/r.ch)*r.cols+Math.floor(x/r.cw);
   const along=((650-x)*Math.cos(heading)+(550-y)*Math.sin(heading))/320;
   const regions=[0];if(along<.2)regions.push(1);if(r.flag[i]===FLAG_FIN)regions.push(2);if(along>.75||r.flag[i]===FLAG_WHIP)regions.push(3);
   for(const n of regions){counts[n].total++;if(g==='0'||g==='1')counts[n].binary++;}
  }};
  r.draw(ctx as unknown as CanvasRenderingContext2D,palette,0);
  for(let i=0;i<4;i++)if(counts[i].total>5)assert.ok(counts[i].binary/counts[i].total>.85,`${kind},${heading},region ${i}: ${JSON.stringify(counts[i])}`);
 }
});
test('nearer silhouettes survive raster input order',()=>{
 const w=new CreatureWorld(),r=new CreatureRaster();r.resize(160,110,7,10.5);
 const near=w.make(1,'sunfish',320,650,550,0,1),far=w.make(2,'manta',320,650,550,0,.5);
 r.rasterize([near,far]);const first=[...r.owner];r.rasterize([far,near]);assert.deepEqual([...r.owner],first);
});
test('density fades gradually with actual visible count and recovers without rebuilding fish',()=>{
 const d=new SchoolDensity(180),fish=Array.from({length:180},()=>({target:-1}));
 const sum=()=>d.alpha.reduce((a,b)=>a+b,0);
 const run=(visible:number,seconds:number)=>{for(let i=0;i<seconds*60;i++){const before=[...d.alpha];d.step(1/60,visible,fish);d.alpha.forEach((a,j)=>assert.ok(Math.abs(a-before[j])<.007));}};
 run(1,20);const sparse=sum();run(4,30);const crowded=sum();assert.ok(crowded<sparse*.75 && crowded>sparse*.55);
 run(2,30);assert.ok(sum()>sparse*.98);
 run(4,30);fish[150].target=1;run(4,10);assert.ok(d.alpha[150]>.97);
 const baseline=d.visibleLarge;for(let i=0;i<120;i++)d.step(1/60,i%2?4:2,fish);assert.ok(Math.abs(d.visibleLarge-baseline)<.4);
 assert.equal(fish.length,180);assert.equal(fish[150].target,1);
});
