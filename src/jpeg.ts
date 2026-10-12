// JPEG structure and dimension checks for uploaded frames. See README "PUT /uploads".
//
// Not a decoder: this walks the marker segments up to the start of scan, to check that
// the file is shaped like a baseline/extended/progressive JPEG of a plausible frame size,
// and that it ends with an end-of-image marker (so nothing, such as HTML, is appended).

/** Instagram's limit for images. */
export const MAX_FRAME_BYTES = 8 * 1024 * 1024;

/** Frame bounds: the app always sends widths of 320–1440 px. */
export const MIN_WIDTH = 320;
export const MAX_WIDTH = 1440;
export const MAX_HEIGHT = 2560;

export type JpegCheck =
  | { ok: true; width: number; height: number }
  | { ok: false; reason: 'structure' | 'unsupported' | 'dimensions' };

const SOI = 0xd8;
const EOI = 0xd9;
const SOS = 0xda;
/** Start-of-frame markers accepted: baseline, extended sequential, progressive. */
const ACCEPTED_SOF = new Set([0xc0, 0xc1, 0xc2]);
/** Other start-of-frame markers (lossless, hierarchical, arithmetic): not from Sequence. */
const OTHER_SOF = new Set([0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);

/** Markers with no length or payload: TEM and RST0–RST7. */
function isStandalone(marker: number): boolean {
  return marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7);
}

export function checkJpeg(bytes: Uint8Array): JpegCheck {
  const fail = (reason: 'structure' | 'unsupported' | 'dimensions'): JpegCheck => ({
    ok: false,
    reason,
  });
  const at = (i: number): number => bytes[i] ?? -1;
  const n = bytes.length;

  if (n < 4 || at(0) !== 0xff || at(1) !== SOI || at(2) !== 0xff) return fail('structure');
  if (at(n - 2) !== 0xff || at(n - 1) !== EOI) return fail('structure');

  let frame: { width: number; height: number } | undefined;
  let pos = 2;
  for (;;) {
    if (at(pos) !== 0xff) return fail('structure');
    // Any number of 0xFF fill bytes may precede a marker.
    while (at(pos) === 0xff) pos++;
    const marker = at(pos);
    pos++;
    if (marker < 0 || marker === 0x00) return fail('structure');
    if (isStandalone(marker)) continue;
    // A second SOI, or EOI before any scan, isn't a frame.
    if (marker === SOI || marker === EOI) return fail('structure');

    // Every other marker has a big-endian length that counts itself but not the marker.
    if (pos + 2 > n) return fail('structure');
    const length = (at(pos) << 8) | at(pos + 1);
    if (length < 2 || pos + length > n) return fail('structure');

    if (ACCEPTED_SOF.has(marker)) {
      // precision (1), height (2), width (2), components (1), then 3 bytes per component.
      if (frame || length < 8) return fail('structure');
      const height = (at(pos + 3) << 8) | at(pos + 4);
      const width = (at(pos + 5) << 8) | at(pos + 6);
      const components = at(pos + 7);
      if (components < 1 || length !== 8 + 3 * components) return fail('structure');
      frame = { width, height };
    } else if (OTHER_SOF.has(marker)) {
      return fail('unsupported');
    } else if (marker === SOS) {
      // The scan's entropy-coded data follows; the header walk ends here.
      if (!frame) return fail('structure');
      break;
    }
    pos += length;
  }

  const { width, height } = frame;
  if (width < MIN_WIDTH || width > MAX_WIDTH || height < 1 || height > MAX_HEIGHT) {
    return fail('dimensions');
  }
  return { ok: true, width, height };
}
