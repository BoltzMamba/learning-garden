import assert from 'node:assert/strict';
import {test} from 'node:test';
import {CreatureWorld} from '../src/scripts/creatures/creatures.ts';
import {CreatureRaster, type CreaturePalette} from '../src/scripts/creatures/raster.ts';
import {DEFAULT_LINEUP} from '../src/scripts/creatures/shapes.ts';
import {mulberry32, type Pellet} from '../src/scripts/ocean-sim.ts';

const palette: CreaturePalette = {bg:[0,0,0],shadow:[50,50,50],light:[150,150,150],edge:[100,150,130],glyphOnLight:'#123',glyphOnDark:'#abc',eye:'#abc',accents:[],glint:'#fff',tintStrength:.2};
const ctx={globalAlpha:1,fillStyle:'',fillText(){}} as unknown as CanvasRenderingContext2D;

test('feeding preserves every pairwise body distance while sunfish pose turns slowly',()=>{
 for(const {kind} of DEFAULT_LINEUP){
  const w=new CreatureWorld(1.2,mulberry32(8));w.seed([],2000,1200);
  const c=w.make(1,kind,420,600,250,0);w.creatures=[c];
  const p:Pellet={id:1,x:680,y:270,amount:20,vy:6,born:0,wobble:0};
  let pose=c.pose;
  for(let i=0;i<60*35;i++){
   w.step(1/60,[p]);p.y+=.1;
   assert.ok(Math.abs(c.pose-pose)<(kind==='sunfish'?.071:.261)/60);
   assert.ok(Math.abs(c.heading-c.pose)<=.18001);
   for(let a=0;a<20;a+=3)for(let b=a+1;b<20;b+=3){
    const distance=Math.hypot(c.nodes[a*2]-c.nodes[b*2],c.nodes[a*2+1]-c.nodes[b*2+1]);
    assert.ok(Math.abs(distance-(b-a)*420/19)<.001,`${kind} body distorted`);
   }
   pose=c.pose;
  }
 }
});

test('visible counts come from surviving glyphs, not the pool or bounding boxes',()=>{
 const w=new CreatureWorld();w.seed([],1000,800);
 const inside=w.make(1,'sunfish',260,500,350,0),outside=w.make(2,'classic',300,-600,-600,0);
 w.creatures=[inside,outside];
 const r=new CreatureRaster();r.resize(100,80,10,10);
 r.rasterize(w.creatures,()=>1);r.draw(ctx,palette,0);w.observeVisibility(r.visibleCells,r.leftCells,r.rightCells);
 assert.equal(w.visibleCount,1);
 r.rasterize(w.creatures,()=>0);r.draw(ctx,palette,0);w.observeVisibility(r.visibleCells,r.leftCells,r.rightCells);
 assert.equal(w.visibleCount,0,'profile-cleared creatures must not count');
 inside.active=false;
 r.rasterize(w.creatures);r.draw(ctx,palette,0);w.observeVisibility(r.visibleCells,r.leftCells,r.rightCells);
 assert.equal(w.visibleCount,0,'waiting creatures must not render');
});

test('scheduler reserves incoming slots, varies population and visits both halves',()=>{
 for(const width of [1440,390]){
  const height=1040,w=new CreatureWorld(1.2,mulberry32(234));w.seed(DEFAULT_LINEUP,width,height);
  const r=new CreatureRaster();r.resize(Math.ceil(width/12),Math.ceil(height/18),12,18);
  let left=0,right=0;const counts=new Set<number>();
  for(let i=0;i<240*60;i++){
   w.step(1/60);
   assert.ok(w.creatures.filter(c=>c.active).length<=4);
   if(i%30)continue;
   r.rasterize(w.creatures);r.draw(ctx,palette,i/60);w.observeVisibility(r.visibleCells,r.leftCells,r.rightCells);
   assert.ok(w.visibleCount>=1 && w.visibleCount<=4, `${width}: ${w.visibleCount} visible at ${i/60}s`);counts.add(w.visibleCount);
   left+=Number(w.creatures.some(c=>c.leftCells>0));right+=Number(w.creatures.some(c=>c.rightCells>0));
  }
  assert.ok(counts.size>=2,'population stays constant');
  assert.ok(left>150&&right>150,`${width}: unbalanced traversal`);
  assert.ok(w.creatures.every(c=>c.admissions>0),'species must not be dropped');
 }
});
