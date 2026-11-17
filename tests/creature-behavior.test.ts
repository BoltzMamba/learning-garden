import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CreatureWorld } from '../src/scripts/creatures/creatures.ts';
import { DEFAULT_LINEUP } from '../src/scripts/creatures/shapes.ts';
import { OceanSim, mulberry32, type Pellet } from '../src/scripts/ocean-sim.ts';

function setup(kind: typeof DEFAULT_LINEUP[number]['kind'] = 'classic') {
  const w = new CreatureWorld(1.2, mulberry32(234)); w.seed([], 1800, 1000);
  const c = w.make(1, kind, 300, 400, 180, 0);
  w.creatures = [c]; return { w, c };
}
function pellet(x: number, y: number): Pellet {
  return { id: 1, x, y, amount: 1, born: 0, vy: 6, wobble: 0 };
}

test('each opening species approaches and eats sinking food with its head, then recovers', () => {
  for (const { kind } of DEFAULT_LINEUP) {
    const { w, c } = setup(kind); const p = pellet(500, kind === 'sunfish' ? 180 : 200);
    if (kind === 'sunfish') p.vy = 2;
    let feeding = false;
    for (let i = 0; i < 1200; i++) {
      const before = p.amount, hx = c.nodes[0], hy = c.nodes[1], heading = c.heading;
      w.step(1/60, [p]); p.y += p.vy / 60;
      assert.ok(Math.hypot(c.nodes[0]-hx,c.nodes[1]-hy) < 1, `${kind}: teleport`);
      assert.ok(Math.abs(c.heading-heading) < .015, `${kind}: abrupt turn`);
      if (p.amount < before) {
        feeding = true;
        assert.ok(Math.hypot(p.x-hx,p.y-p.vy/60-hy) < 14, `${kind}: not mouth contact`);
      }
    }
    assert.ok(feeding, `${kind}: never ate`);
    assert.ok(c.eaten > .3, `${kind}: insufficient feeding`);
    assert.equal(c.target,-1);
    assert.ok(Math.cos(c.heading-c.course) > .8, `${kind}: did not resume course`);
  }
});

test('rear food starts a bounded turn but tail contact does not consume', () => {
  const { w, c } = setup(); const p = pellet(160,180);
  for(let i=0;i<180;i++)w.step(1/60,[p]);
  assert.equal(p.amount,1); assert.equal(c.target,1); assert.ok(Math.abs(c.heading)<.9);
});

test('close fast-sinking food never forces a violent turn or stretched body', () => {
  for (const length of [206, 516]) {
    const {w}=setup('whaleshark');w.creatures=[w.make(1,'whaleshark',length,400,180,0)];
    const p=pellet(465,198);p.vy=11;
    let heading = 0;
    for(let i=0;i<1200;i++){
      w.step(1/60,[p]);p.y+=p.vy/60;
      const c = w.creatures[0];
      assert.ok(Math.abs(c.heading-heading) < .005);
      assert.ok(Math.abs(Math.hypot(c.nodes[0]-c.nodes[38],c.nodes[1]-c.nodes[39])-length)<.01);
      heading = c.heading;
    }
    assert.equal(w.creatures[0].target,-1, 'unreachable food must be released');
  }
});

test('offscreen entrants are not recycled back to the wrong edge', () => {
  const {w,c}=setup();
  for(let k=0;k<20;k++)c.nodes[k*2]-=1000;
  const x=c.nodes[0];
  w.step(1/60);
  assert.equal(c.passage,0);assert.ok(c.nodes[0]>x&&c.nodes[0]-x<1);
});

test('shared food is actually consumed and removed targets recover', () => {
  const { w, c } = setup();
  const sim = new OceanSim({width:1800,height:1000,cell:12,rng:mulberry32(3),count:0});
  sim.feed(510,195);
  for(let i=0;i<1000;i++) { w.step(1/60,sim.pellets); sim.step(1/60); }
  assert.ok(c.eaten > .1);
  w.step(1/60,[]); assert.equal(c.target,-1);
});

test('at most two large creatures commit to food, and empty water releases targets', () => {
  const {w}=setup();
  w.creatures=Array.from({length:5},(_,i)=>w.make(i+1,'classic',200,400,160+i*8,0));
  const p=pellet(520,190);
  for(let i=0;i<120;i++) {
    w.step(1/60,[p]);
    assert.ok(w.creatures.filter(c=>c.target>=0).length<=2);
  }
  assert.ok(w.creatures.some(c=>c.target>=0));
  w.step(1/60,[]);
  assert.ok(w.creatures.every(c=>c.target===-1));
});

test('30-second migration has substantial displacement without circling', () => {
  for (const {kind} of DEFAULT_LINEUP) {
    const {w,c}=setup(kind); const x=c.nodes[0],y=c.nodes[1];let distance=0;
    for(let i=0;i<1800;i++) {const px=c.nodes[0],py=c.nodes[1];w.step(1/60);distance+=Math.hypot(c.nodes[0]-px,c.nodes[1]-py);}
    assert.ok(Math.hypot(c.nodes[0]-x,c.nodes[1]-y)/distance>.9,kind);
    assert.ok(c.nodes[0]-x>350,kind);
  }
});

test('the complete desktop and mobile rosters finish passages with profile avoidance', () => {
  for (const [width,height] of [[1440,1000],[390,1040]]) {
    const w=new CreatureWorld(1.2,mulberry32(234));
    w.avoid={cx:width/2,cy:height/2,rx:width<640?185:240,ry:230};
    w.seed(DEFAULT_LINEUP,width,height);
    for(let i=0;i<180*60;i++) w.step(1/60);
    for(const c of w.creatures)assert.ok(c.passage>=1,`${width}: ${c.kind} never crossed`);
  }
});

test('re-entry occurs only while the full silhouette is offscreen, preserving all joints', () => {
  const {w,c}=setup();w.width=700;let wrapped=false;
  for(let i=0;i<6000;i++) {
    const old=[...c.nodes],passage=c.passage;w.step(1/60);
    if(c.passage!==passage) {
      wrapped=true;
      assert.ok(Math.min(...old.filter((_,i)=>i%2===0))>w.width+100);
      assert.ok(Math.max(...c.nodes.filter((_,i)=>i%2===0))<0);
      for(let k=1;k<20;k++) assert.ok(Math.abs(Math.hypot(c.nodes[k*2]-c.nodes[k*2-2],c.nodes[k*2+1]-c.nodes[k*2-1])-300/19)<.01);
      break;
    }
  }
  assert.ok(wrapped);
});


test('three distinct meals recover through cooldown and never reacquire a served batch', () => {
  const {w,c}=setup(); w.width=10000; w.height=10000;
  for(let batch=1;batch<=3;batch++) {
    const p={...pellet(c.nodes[0]+Math.cos(c.heading)*80,c.nodes[1]+Math.sin(c.heading)*80),id:batch,batch,born:w.time,vy:0};
    const eaten=c.eaten;
    for(let i=0;i<900 && p.amount>.001;i++)w.step(1/60,[p]);
    assert.ok(c.eaten>eaten+.99,`meal ${batch}`);
    assert.equal(c.target,-1);assert.equal(c.targetBatch,-1);
    const next={...p,id:batch+100,amount:1};
    for(let i=0;i<360;i++)w.step(1/60,[next]);
    assert.equal(c.target,-1,'same batch is not immediately hunted again');
    assert.ok(w.time>=c.fullUntil);
  }
});

test('vanished target releases, then a fresh rear batch is acquired without target thrashing', () => {
  const {w,c}=setup(); const first={...pellet(510,180),batch:1};
  for(let i=0;i<60;i++)w.step(1/60,[first]);
  assert.equal(c.target,1);w.step(1/60,[]);assert.equal(c.target,-1);
  for(let i=0;i<120;i++)w.step(1/60);
  const rear={...pellet(c.nodes[0]-100,c.nodes[1]-20),id:2,batch:2,born:w.time,vy:0};
  const competing={...rear,id:3,batch:3,x:c.nodes[0]+80};
  for(let i=0;i<60;i++)w.step(1/60,[rear]);
  assert.equal(c.target,2);
  const initial=c.heading;
  for(let i=0;i<600;i++) {
    const old=c.heading;w.step(1/60,[rear,competing]);
    assert.equal(c.target,2);assert.ok(Math.abs(c.heading-old)<.0051);
  }
  assert.ok(Math.abs(c.heading-initial)>1.5,'rear target causes a slow committed turn');
});

test('parallel large bodies gradually separate with bounded speed changes', () => {
  const {w,c}=setup(); const other=w.make(2,'classic',300,405,185,0);w.creatures.push(other);
  for(let i=0;i<900;i++) {
    const speeds=w.creatures.map(f=>f.speed);w.step(1/60);
    w.creatures.forEach((f,j)=>assert.ok(Math.abs(f.speed-speeds[j])<.3));
  }
  assert.ok(Math.hypot(c.nodes[0]-other.nodes[0],c.nodes[1]-other.nodes[1])>50);
});



test('a new batch waits for satiety cooldown, then becomes eligible', () => {
  const {w,c}=setup(); c.fullUntil=3; c.noticeAt=3;
  const p={...pellet(570,180),id:9,batch:9,vy:0};
  for(let i=0;i<170;i++){w.step(1/60,[p]);assert.equal(c.target,-1);}
  for(let i=0;i<30;i++)w.step(1/60,[p]);
  assert.equal(c.target,9);
});
