/**
 * Stand-in photos for testing (Settings → Advanced): soft gradients in colors like film's
 * (saturated, warm and cool, never pure black or white), with a little grain. They're made
 * as JPEG files and added like any others (see importPhotos).
 */

/**
 * Colors from slide and negative film: rich, but with headroom at both ends. In order
 * around the color wheel, so neighbors blend cleanly (opposites would meet in gray).
 */
export const FILM_COLORS = [
  '#c2452d', // red, like Ektachrome
  '#e07a3f', // orange
  '#f2b544', // warm yellow
  '#3f7d4e', // green
  '#2a9d8f', // teal
  '#1f4e5a', // dark cyan
  '#2f5d8a', // deep blue
  '#7a4c9a', // violet
  '#b8336a', // magenta
  '#e8a398', // Portra skin, back toward red
] as const;

/** The sizes made, in pixels: about 6 megapixels, 10 in at 300 dpi along the long side (or 8 in square). */
const SIZES = [
  { w: 3000, h: 2000 },
  { w: 2000, h: 3000 },
  { w: 2400, h: 2400 },
] as const;

const QUALITY = 0.9;

/** A random pick. */
function pick<T>(items: readonly T[]): T {
  return items[Math.floor(Math.random() * items.length) % items.length]!;
}

/** Two or three neighboring film colors, for one gradient, either way around the wheel. */
export function gradientColors(random: () => number = Math.random): string[] {
  const count = random() < 0.5 ? 2 : 3;
  const start = Math.floor(random() * FILM_COLORS.length);
  const step = random() < 0.5 ? 1 : -1;
  const n = FILM_COLORS.length;
  return Array.from({ length: count }, (_, i) => FILM_COLORS[(((start + i * step) % n) + n) % n]!);
}

/** A small tile of grain, repeated over each image: cheap, and enough to read as film. */
function grainTile(): OffscreenCanvas {
  const size = 256;
  const tile = new OffscreenCanvas(size, size);
  const ctx = tile.getContext('2d');
  if (!ctx) return tile;
  const data = ctx.createImageData(size, size);
  for (let i = 0; i < data.data.length; i += 4) {
    const v = Math.floor(Math.random() * 256);
    data.data[i] = v;
    data.data[i + 1] = v;
    data.data[i + 2] = v;
    data.data[i + 3] = 18;
  }
  ctx.putImageData(data, 0, 0);
  return tile;
}

/**
 * Stops for a fade of `rgb` up to `alpha`, eased (smoothstep) so it starts and ends with
 * no edge; `shape` maps the position (0–1) to how far along the fade it is.
 */
function easedStops(g: CanvasGradient, rgb: readonly number[], alpha: number, shape: (t: number) => number): void {
  const steps = 16;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const s = shape(t);
    g.addColorStop(t, `rgba(${rgb.join(', ')}, ${(alpha * s * s * (3 - 2 * s)).toFixed(4)})`);
  }
}

/** One gradient as a JPEG file named `name`. */
async function gradientFile(name: string, grain: OffscreenCanvas): Promise<File> {
  const { w, h } = pick(SIZES);
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('No 2D canvas');
  // A linear gradient at a random angle across the whole image.
  const angle = Math.random() * Math.PI * 2;
  const r = Math.hypot(w, h) / 2;
  const [cx, cy, dx, dy] = [w / 2, h / 2, Math.cos(angle) * r, Math.sin(angle) * r];
  const linear = ctx.createLinearGradient(cx - dx, cy - dy, cx + dx, cy + dy);
  const colors = gradientColors();
  colors.forEach((c, i) => linear.addColorStop(i / (colors.length - 1), c));
  ctx.fillStyle = linear;
  ctx.fillRect(0, 0, w, h);
  // A soft glow somewhere, like light leaking in, then a gentle vignette. Both fade along
  // an eased curve: a straight fade that starts partway out leaves a visible ring.
  const gx = Math.random() * w;
  const gy = Math.random() * h;
  const glow = ctx.createRadialGradient(gx, gy, 0, gx, gy, r * 1.2);
  easedStops(glow, [255, 236, 200], 0.2, (t) => 1 - t);
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, w, h);
  const vignette = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, r);
  easedStops(vignette, [20, 16, 24], 0.22, (t) => t);
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, w, h);
  const pattern = ctx.createPattern(grain, 'repeat');
  if (pattern) {
    ctx.fillStyle = pattern;
    ctx.fillRect(0, 0, w, h);
  }
  const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: QUALITY });
  canvas.width = 0;
  canvas.height = 0;
  return new File([blob], name, { type: 'image/jpeg' });
}

/** `count` gradient photos, named "Gradient 01.jpg" and so on; `onProgress` hears after each. */
export async function makeTestImages(count: number, onProgress: (done: number) => void = () => {}): Promise<File[]> {
  const grain = grainTile();
  const digits = Math.max(2, String(count).length);
  const files: File[] = [];
  for (let i = 1; i <= count; i++) {
    files.push(await gradientFile(`Gradient ${String(i).padStart(digits, '0')}.jpg`, grain));
    onProgress(i);
  }
  return files;
}
