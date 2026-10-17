// Synthetic JPEGs: real marker structure, placeholder tables and scan data. Enough for
// the structure checks in src/jpeg.ts (which doesn't decode).

export interface JpegOptions {
  width?: number;
  height?: number;
  /** Start-of-frame marker (0xC0 baseline, 0xC2 progressive, ...). */
  sof?: number;
  components?: number;
  /** Extra 0xFF fill bytes before the DHT marker. */
  fill?: number;
  /** A standalone TEM marker between segments. */
  tem?: boolean;
  /** Bytes of entropy-coded data (padded with a stuffed 0xFF 0x00 and a restart marker). */
  scanBytes?: number;
}

function segment(marker: number, payload: number[]): number[] {
  const length = payload.length + 2;
  return [0xff, marker, length >> 8, length & 0xff, ...payload];
}

export function makeJpeg(options: JpegOptions = {}): Uint8Array<ArrayBuffer> {
  const {
    width = 1080,
    height = 1350,
    sof = 0xc0,
    components = 3,
    fill = 0,
    tem = false,
    scanBytes = 64,
  } = options;
  const ids = Array.from({ length: components }, (_, i) => i + 1);
  const bytes: number[] = [
    0xff,
    0xd8,
    // APP0 JFIF
    ...segment(0xe0, [0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]),
    // DQT
    ...segment(0xdb, [0, ...new Array<number>(64).fill(1)]),
    // SOF
    ...segment(sof, [
      8,
      height >> 8,
      height & 0xff,
      width >> 8,
      width & 0xff,
      components,
      ...ids.flatMap((id) => [id, 0x11, 0]),
    ]),
    ...(tem ? [0xff, 0x01] : []),
    ...new Array<number>(fill).fill(0xff),
    // DHT
    ...segment(0xc4, [0, 1, ...new Array<number>(15).fill(0), 0]),
    // SOS
    ...segment(0xda, [components, ...ids.flatMap((id) => [id, 0]), 0, 63, 0]),
  ];
  for (let i = 0; i < scanBytes; i++) bytes.push((i * 37) & 0x7f);
  bytes.push(0xff, 0x00, 0x12, 0xff, 0xd0, 0x34);
  bytes.push(0xff, 0xd9);
  return new Uint8Array(bytes);
}

export const PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52, 0, 0, 4,
  0x38, 0, 0, 5, 0x46, 8, 2, 0, 0, 0, 0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
]);

export function concat(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}
