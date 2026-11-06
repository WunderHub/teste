/**
 * Paints the battlefield ground on a canvas from the painted ground textures in public/assets/terreno.
 * Grass covers everything; noise-shaped patches and a trail show bare earth; rough tiles show stony ground.
 * Everything is seeded, so the same battle always gets the same ground.
 */

type Source = CanvasImageSource & { width: number; height: number };
export interface GroundTextures { grass: Source; dirt: Source; stones: Source }
export interface GroundSpec {
  width: number; height: number;
  /** Canvas pixels per world pixel. */
  resolution: number;
  /** World offset of the canvas's top-left corner. */
  originX: number; originY: number;
  /** World pixels covered by one repeat of each texture. */
  tileSize: number;
  /** World centers of the rough (stony) tiles and the hex radius. */
  rough: { x: number; y: number }[]; hexRadius: number;
  /** A worn trail as a cubic Bézier path in world coordinates: start, then [c1, c2, end] per segment. */
  trail: [number, number][];
  seed: number;
}

/** Seeded value noise with octaves, in 0..1. */
export function makeNoise(seed: number) {
  const hash = (x: number, y: number) => {
    let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 1442695041)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };
  const smooth = (t: number) => t * t * (3 - 2 * t);
  const value = (x: number, y: number) => {
    const xi = Math.floor(x), yi = Math.floor(y), xf = smooth(x - xi), yf = smooth(y - yi);
    const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
    return a + (b - a) * xf + (c - a) * yf + (a - b - c + d) * xf * yf;
  };
  return (x: number, y: number, octaves = 4) => {
    let sum = 0, amplitude = 0.5, frequency = 1, norm = 0;
    for (let i = 0; i < octaves; i++) { sum += value(x * frequency, y * frequency) * amplitude; norm += amplitude; amplitude *= 0.5; frequency *= 2; }
    return sum / norm;
  };
}
const smoothstep = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

const canvas = (width: number, height: number) => {
  const c = document.createElement('canvas'); c.width = width; c.height = height;
  return { c, ctx: c.getContext('2d')! };
};

/** World pixels per mask pixel: masks are small and get smoothed when stretched over the ground. */
const MASK_STEP = 8;

export function paintGround(ctx: CanvasRenderingContext2D, textures: GroundTextures, spec: GroundSpec) {
  const { width, height, resolution: k, originX, originY } = spec;
  const pattern = (source: Source) => {
    const p = ctx.createPattern(source, 'repeat')!;
    const scale = spec.tileSize * k / source.width;
    // Anchored to the world, so the ground stays put whatever the canvas origin.
    p.setTransform(new DOMMatrix().translate(-originX * k, -originY * k).scale(scale));
    return p;
  };
  ctx.fillStyle = pattern(textures.grass); ctx.fillRect(0, 0, width, height);

  // Masks in world space at 1/MASK_STEP resolution.
  const mw = Math.ceil(width / k / MASK_STEP) + 1, mh = Math.ceil(height / k / MASK_STEP) + 1;
  const noise = makeNoise(spec.seed), detail = makeNoise(spec.seed + 17), tone = makeNoise(spec.seed + 31);
  const trail = canvas(mw, mh);
  trail.ctx.scale(1 / MASK_STEP, 1 / MASK_STEP); trail.ctx.translate(-originX, -originY);
  trail.ctx.lineCap = 'round'; trail.ctx.lineJoin = 'round'; trail.ctx.strokeStyle = '#fff';
  const [start, ...rest] = spec.trail;
  const stroke = (lineWidth: number, alpha: number) => {
    trail.ctx.globalAlpha = alpha; trail.ctx.lineWidth = lineWidth; trail.ctx.beginPath(); trail.ctx.moveTo(...start);
    for (let i = 0; i + 2 < rest.length; i += 3) trail.ctx.bezierCurveTo(...rest[i], ...rest[i + 1], ...rest[i + 2]);
    trail.ctx.stroke();
  };
  stroke(150, 0.35); stroke(95, 0.6); stroke(55, 1);
  const trailData = trail.ctx.getImageData(0, 0, mw, mh).data;

  const dirt = canvas(mw, mh), stones = canvas(mw, mh), shade = canvas(mw, mh);
  const dirtImage = dirt.ctx.createImageData(mw, mh), stoneImage = stones.ctx.createImageData(mw, mh), shadeImage = shade.ctx.createImageData(mw, mh);
  const reach = spec.hexRadius * 1.45;
  for (let my = 0; my < mh; my++) for (let mx = 0; mx < mw; mx++) {
    const x = originX + mx * MASK_STEP, y = originY + my * MASK_STEP, i = (my * mw + mx) * 4;
    const n = noise(x / 320, y / 320), d = detail(x / 70, y / 70);
    // Bare earth: patches where the noise peaks, plus the trail, both frayed by fine noise.
    const patch = smoothstep(0.6, 0.7, n + (d - 0.5) * 0.12);
    const path = trailData[i + 3] / 255 * smoothstep(0.25, 0.55, d + 0.15);
    dirtImage.data[i + 3] = Math.round(255 * Math.min(1, Math.max(patch * 0.9, path)));
    // Stony ground around each rough tile, with a ragged border.
    let nearest = Infinity;
    for (const c of spec.rough) { const dd = Math.hypot(c.x - x, c.y - y); if (dd < nearest) nearest = dd; }
    stoneImage.data[i + 3] = Math.round(255 * smoothstep(reach, reach * 0.55, nearest + (d - 0.5) * spec.hexRadius * 0.9));
    // Broad light and dark areas break the repeat of the textures.
    const t = tone(x / 600, y / 600, 3);
    const v = Math.round(128 + (t - 0.5) * 120);
    shadeImage.data[i] = shadeImage.data[i + 1] = shadeImage.data[i + 2] = v; shadeImage.data[i + 3] = 255;
  }
  dirt.ctx.putImageData(dirtImage, 0, 0); stones.ctx.putImageData(stoneImage, 0, 0); shade.ctx.putImageData(shadeImage, 0, 0);

  const scaleMask = MASK_STEP * k;
  const layer = canvas(width, height);
  const apply = (source: Source, mask: HTMLCanvasElement) => {
    layer.ctx.globalCompositeOperation = 'source-over'; layer.ctx.clearRect(0, 0, width, height);
    layer.ctx.fillStyle = pattern(source); layer.ctx.fillRect(0, 0, width, height);
    layer.ctx.globalCompositeOperation = 'destination-in'; layer.ctx.imageSmoothingQuality = 'high';
    layer.ctx.drawImage(mask, 0, 0, mw * scaleMask, mh * scaleMask);
    ctx.drawImage(layer.c, 0, 0);
  };
  apply(textures.dirt, dirt.c);
  apply(textures.stones, stones.c);
  ctx.save(); ctx.globalCompositeOperation = 'overlay'; ctx.globalAlpha = 0.55; ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(shade.c, 0, 0, mw * scaleMask, mh * scaleMask); ctx.restore();
}
