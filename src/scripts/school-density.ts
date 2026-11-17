/** Display-only density envelope; fish entities and their behaviour are persistent. */
export class SchoolDensity {
  visibleLarge = 2;
  readonly alpha: Float32Array;
  private readonly rank: Float32Array;

  constructor(count: number) {
    this.alpha = new Float32Array(count).fill(1);
    this.rank = new Float32Array(count);
    // Spread fading members across schools, rather than removing one complete school.
    for (let i=0;i<count;i++) this.rank[i] = (i*.61803398875)%1;
  }

  step(dt: number, visible: number, fish: readonly {target: number}[]) {
    this.visibleLarge += (visible-this.visibleLarge)*(1-Math.exp(-dt/5));
    const population = this.visibleLarge<=2 ? 1 : Math.max(.64,1-(this.visibleLarge-2)*.18);
    const blend = 1-Math.exp(-dt/2.5);
    for(let i=0;i<this.alpha.length;i++) {
      const t = Math.max(0,Math.min(1,(population-this.rank[i])/.12));
      // Seeking fish remain readable; the existing feeding state is read, never changed.
      const target = fish[i]?.target>=0 ? 1 : t*t*(3-2*t);
      this.alpha[i] += (target-this.alpha[i])*blend;
    }
  }
}
