// @vitest-environment happy-dom
import { toGuideId, toPhotoId } from './ids';
import { describe, expect, it } from 'vitest';
import { buildIdml } from './idml';
import { emptyProject } from './store';
import type { Project } from './types';
import { allSpreads } from './spreads';

async function build(project: Project, links = new Map()) {
  const entries = buildIdml(project, links);
  const files = new Map<string, Document>();
  for (const e of entries) {
    if (e.name.endsWith('.xml')) files.set(e.name, new DOMParser().parseFromString(await e.data.text(), 'text/xml'));
  }
  return { entries, files };
}

function sample(): Project {
  const project = emptyProject(); // 10 × 8 in pages; borders 0.5 and 1.25; four spreads
  const a = toPhotoId('a');
  project.photos[a] = { id: a, name: 'a & b.jpg', pxW: 3000, pxH: 2000 };
  allSpreads(project)[1]!.items.push({ photoId: a, x: -9, y: 1, w: 6, h: 4, z: 1 });
  return project;
}

describe('buildIdml', () => {
  it('starts with the package type, and lists every spread', async () => {
    const { entries, files } = await build(sample());
    expect(entries[0]!.name).toBe('mimetype');
    expect(await entries[0]!.data.text()).toBe('application/vnd.adobe.indesign-idml-package');
    const spreads = [...files.get('designmap.xml')!.getElementsByTagName('idPkg:Spread')];
    expect(spreads).toHaveLength(4);
    for (const s of spreads) expect(files.has(s.getAttribute('src')!)).toBe(true);
  });

  it('sets up facing pages at the book’s size, with the largest border guide as margins', async () => {
    const { files } = await build(sample());
    const prefs = files.get('Resources/Preferences.xml')!;
    const documentPrefs = prefs.querySelector('DocumentPreference')!;
    expect(documentPrefs.getAttribute('PageWidth')).toBe('720');
    expect(documentPrefs.getAttribute('PageHeight')).toBe('576');
    // More would leave InDesign's own blank pages ahead of the book's.
    expect(documentPrefs.getAttribute('PagesPerDocument')).toBe('1');
    expect(documentPrefs.getAttribute('FacingPages')).toBe('true');
    expect(prefs.querySelector('MarginPreference')!.getAttribute('Top')).toBe('36');
  });

  it('places pages around the binding, with single first and last pages', async () => {
    const { files } = await build(sample());
    const spreads = [...files.entries()].filter(([name]) => name.startsWith('Spreads/')).map(([, d]) => d);
    const pages = (d: Document) => [...d.querySelectorAll('Page')].map((p) => p.getAttribute('ItemTransform'));
    expect(pages(spreads[0]!)).toEqual(['1 0 0 1 0 -288']);
    expect(pages(spreads[1]!)).toEqual(['1 0 0 1 -720 -288', '1 0 0 1 0 -288']);
    expect(pages(spreads[3]!)).toEqual(['1 0 0 1 -720 -288']);
    expect(spreads[0]!.querySelector('Spread')!.getAttribute('BindingLocation')).toBe('0');
    expect(spreads[1]!.querySelector('Page')!.getAttribute('Name')).toBe('2');
    // The 1.25 in border guide and the center lines become ruler guides: 3 vertical and 3 horizontal.
    expect(spreads[1]!.querySelector('Page')!.querySelectorAll('Guide')).toHaveLength(6);
    // Vertical guides are measured from the spread's left edge.
    const right = spreads[1]!.querySelectorAll('Page')[1]!;
    const verticals = [...right.querySelectorAll('Guide[Orientation="Vertical"]')].map((g) =>
      g.getAttribute('Location'),
    );
    expect(verticals).toEqual(['1080', '810', '1350']);
    const horizontals = [...right.querySelectorAll('Guide[Orientation="Horizontal"]')].map((g) =>
      g.getAttribute('Location'),
    );
    expect(horizontals).toEqual(['288', '90', '486']);
  });

  it('mirrors per-edge margins and line guides on facing pages', async () => {
    const project = sample();
    project.settings.borders = [
      { id: toGuideId('book'), kind: 'edges', top: 0.5, bottom: 1, inside: 1.5, outside: 0.75 },
    ];
    project.settings.dropBorder = toGuideId('book');
    project.settings.centerV = false;
    project.settings.centerH = false;
    project.settings.lines = [
      { id: toGuideId('v'), axis: 'vertical', at: 2 },
      { id: toGuideId('h'), axis: 'horizontal', at: 3 },
    ];
    const { files } = await build(project);
    // The document's margins: with facing pages, Left is inside and Right is outside.
    const docMargins = files.get('Resources/Preferences.xml')!.querySelector('MarginPreference')!;
    expect(['Top', 'Bottom', 'Left', 'Right'].map((a) => docMargins.getAttribute(a))).toEqual([
      '36',
      '72',
      '108',
      '54',
    ]);
    const spread = [...files.entries()].filter(([name]) => name.startsWith('Spreads/'))[1]![1];
    const [left, right] = [...spread.querySelectorAll('Page')];
    // A page's own margins are its left and right: the left page's left edge is its outside.
    const margins = (p: Element) => ['Left', 'Right'].map((a) => p.querySelector('MarginPreference')!.getAttribute(a));
    expect(margins(left!)).toEqual(['54', '108']);
    expect(margins(right!)).toEqual(['108', '54']);
    // The vertical guide is 2 in from each outside edge (from the spread's left edge: 2 in, and 18 in).
    const at = (p: Element, o: string) =>
      [...p.querySelectorAll(`Guide[Orientation="${o}"]`)].map((g) => g.getAttribute('Location'));
    expect(at(left!, 'Vertical')).toEqual(['144']);
    expect(at(right!, 'Vertical')).toEqual(['1296']);
    expect(at(right!, 'Horizontal')).toEqual(['216']);
  });

  it('frames each photo where it sits, with its image scaled by its resolution', async () => {
    const links = new Map([
      ['a', { path: 'Links/a & b.jpg', format: 'jpeg' as const, ppi: 300, pxW: 3000, pxH: 2000 }],
    ]);
    const { files } = await build(sample(), links);
    const spread = [...files.entries()].filter(([name]) => name.startsWith('Spreads/'))[1]![1];
    const rect = spread.querySelector('Rectangle')!;
    expect(rect.getAttribute('Name')).toBe('a & b.jpg');
    const anchors = [...rect.querySelectorAll('PathPointType')].map((p) => p.getAttribute('Anchor'));
    expect(anchors).toEqual(['-648 -216', '-648 72', '-216 72', '-216 -216']);
    const image = rect.querySelector('Image')!;
    // 3000 px at 300 ppi is 720 pt wide; the frame is 432 pt.
    expect(image.getAttribute('ItemTransform')).toBe('0.6 0 0 0.6 -648 -216');
    expect(image.querySelector('GraphicBounds')!.getAttribute('Right')).toBe('720');
    expect(image.querySelector('Link')!.getAttribute('LinkResourceURI')).toBe('file:Links/a%20%26%20b.jpg');
  });

  it('leaves a frame empty when its image is missing', async () => {
    const { files } = await build(sample());
    const spread = [...files.entries()].filter(([name]) => name.startsWith('Spreads/'))[1]![1];
    expect(spread.querySelector('Rectangle')).not.toBeNull();
    expect(spread.querySelector('Image')).toBeNull();
  });
});
