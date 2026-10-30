// The native iPhone app's fonts (ios/Sequence/Fonts): the web app's Inter Tight and IBM Plex
// Mono, from the same @fontsource packages (Latin, as the web loads), turned from WOFF into
// the TrueType files iOS reads. `node scripts/ios-fonts.mjs` after the packages update.
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';

const out = new URL('../ios/Sequence/Fonts/', import.meta.url);
const fonts = [
  ['inter-tight', [400, 500, 600, 700], 'InterTight'],
  ['ibm-plex-mono', [400, 500], 'IBMPlexMono'],
];
const weightNames = { 400: 'Regular', 500: 'Medium', 600: 'SemiBold', 700: 'Bold' };

/** A WOFF 1 file as the font inside it: each table inflated, laid out as an sfnt. */
function woffToSfnt(woff) {
  if (woff.toString('latin1', 0, 4) !== 'wOFF') throw new Error('not a WOFF file');
  const flavor = woff.readUInt32BE(4);
  const count = woff.readUInt16BE(12);
  const tables = [];
  for (let i = 0; i < count; i++) {
    const at = 44 + i * 20;
    const offset = woff.readUInt32BE(at + 4);
    const compLength = woff.readUInt32BE(at + 8);
    const origLength = woff.readUInt32BE(at + 12);
    const raw = woff.subarray(offset, offset + compLength);
    tables.push({
      tag: woff.subarray(at, at + 4),
      checksum: woff.readUInt32BE(at + 16),
      data: compLength < origLength ? inflateSync(raw) : raw,
    });
  }
  const pad = (n) => (n + 3) & ~3;
  const headerSize = 12 + count * 16;
  const size = tables.reduce((sum, t) => sum + pad(t.data.length), headerSize);
  const sfnt = Buffer.alloc(size);
  const pow = 2 ** Math.floor(Math.log2(count));
  sfnt.writeUInt32BE(flavor, 0);
  sfnt.writeUInt16BE(count, 4);
  sfnt.writeUInt16BE(pow * 16, 6);
  sfnt.writeUInt16BE(Math.log2(pow), 8);
  sfnt.writeUInt16BE(count * 16 - pow * 16, 10);
  let offset = headerSize;
  tables.forEach((t, i) => {
    const at = 12 + i * 16;
    t.tag.copy(sfnt, at);
    sfnt.writeUInt32BE(t.checksum, at + 4);
    sfnt.writeUInt32BE(offset, at + 8);
    sfnt.writeUInt32BE(t.data.length, at + 12);
    t.data.copy(sfnt, offset);
    offset += pad(t.data.length);
  });
  return sfnt;
}

mkdirSync(out, { recursive: true });
for (const [pkg, weights, name] of fonts) {
  const dir = new URL(`../node_modules/@fontsource/${pkg}/`, import.meta.url);
  for (const weight of weights) {
    const woff = readFileSync(new URL(`files/${pkg}-latin-${weight}-normal.woff`, dir));
    writeFileSync(new URL(`${name}-${weightNames[weight]}.ttf`, out), woffToSfnt(woff));
  }
  copyFileSync(new URL('LICENSE', dir), new URL(`${name}-OFL.txt`, out));
}
console.log('Wrote the fonts to ios/Sequence/Fonts.');
