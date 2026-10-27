import { cropOf, wholeRect } from './crop';
import { dropGuide, edgesOf, linePosition, lineOnPage, pageRect, pageSides } from './geometry';
import type { Crop, Project, PageSide, Sheet, Spread } from './types';
import type { ZipInput } from './zip';
import { allSpreads, sheetOf } from './spreads';

/**
 * Build an IDML file (InDesign Markup Language: a ZIP of XML that InDesign opens
 * as a new document). A book becomes a facing-pages document with the same page size and
 * spreads, and a sequence of frames a document of single pages, one to a spread (in
 * inches, or pixels at a point each), with the drop border guide as margins, the other
 * guides as ruler guides, and each photo as a frame with its image linked from `Links/`.
 *
 * Coordinates: an IDML spread's origin is at its binding (our gutter) and vertical
 * center, in points; y grows downward, as in the app. A single page without facing pages
 * is centered on it, so a frame's photos shift left by half its width.
 */

/** Points to the inch: images are sized by their own resolution in it. */
const PT_PER_INCH = 72;

/** Where a frame's left edge sits in its spread, in page units: centered on the origin. */
function frameShift(s: Pick<Sheet, 'arrangement' | 'pageW'>): number {
  return s.arrangement === 'frames' ? -s.pageW / 2 : 0;
}

/** A page's left and right distances from a border guide's edges: outside is a frame's (and a left page's) left. */
function leftRight(side: PageSide | undefined, g: { inside: number; outside: number }): [number, number] {
  return side === 'right' || side === undefined ? [g.inside, g.outside] : [g.outside, g.inside];
}

/** Points per page unit: 72 to the inch, and a point to the pixel (InDesign's pixels). */
function ptPerUnit(s: Pick<Sheet, 'unit'>): number {
  return s.unit === 'in' ? PT_PER_INCH : 1;
}
const PKG = 'http://ns.adobe.com/AdobeInDesign/idml/1.0/packaging';
const DOM = '8.0';
const HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const LAYER = 'layer';
/** Space between spreads on InDesign's pasteboard. */
const SPREAD_SPACING = 36;

/** A photo's image file, relative to the IDML file. */
export interface LinkedImage {
  path: string;
  format: 'jpeg' | 'png';
  /** The file's stored resolution, which InDesign sizes it by. */
  ppi: number;
  /** The file's pixel size (upright). */
  pxW: number;
  pxH: number;
}

export function buildIdml(project: Project, links: Map<string, LinkedImage>): ZipInput[] {
  let nextId = 0;
  // InDesign names its own objects u1, u2, …; a distinct prefix keeps ours from matching them.
  const id = () => `pbs${++nextId}`;
  const sheet = sheetOf(project);
  const spreadFiles = allSpreads(project).map((spread, i) => {
    const spreadId = id();
    return {
      name: `Spreads/Spread_${spreadId}.xml`,
      xml: spreadXml(project, spread, i, spreadId, id, links),
    };
  });

  const designmap = `${HEAD}
<?aid style="50" type="document" readerVersion="6.0" featureSet="257" product="8.0(370)" ?>
<Document xmlns:idPkg="${PKG}" DOMVersion="${DOM}" Self="d">
<idPkg:Preferences src="Resources/Preferences.xml"/>
<Layer Self="${LAYER}" Name="Photos" Visible="true" Locked="false" IgnoreWrap="false" ShowGuides="true" LockGuides="false" UI="true" Expendable="true" Printable="true"/>
${spreadFiles.map((f) => `<idPkg:Spread src="${f.name}"/>`).join('\n')}
</Document>`;

  const container = `${HEAD}
<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0">
<rootfiles><rootfile full-path="designmap.xml" media-type="text/xml"/></rootfiles>
</container>`;

  return [
    // The package type must come first, and uncompressed (createZip stores everything).
    { name: 'mimetype', data: new Blob(['application/vnd.adobe.indesign-idml-package']) },
    { name: 'designmap.xml', data: xmlBlob(designmap) },
    { name: 'META-INF/container.xml', data: xmlBlob(container) },
    { name: 'Resources/Preferences.xml', data: xmlBlob(preferencesXml(sheet)) },
    ...spreadFiles.map((f) => ({ name: f.name, data: xmlBlob(f.xml) })),
  ];
}

/**
 * Page setup. PagesPerDocument is 1 whatever the book's length: InDesign starts from
 * a blank document with that many pages, and only its first spread is replaced by ours.
 */
function preferencesXml(s: Sheet): string {
  const pt = ptPerUnit(s);
  const rulers = s.unit === 'in' ? 'Inches' : 'Pixels';
  const w = s.pageW * pt;
  const h = s.pageH * pt;
  return `${HEAD}
<idPkg:Preferences xmlns:idPkg="${PKG}" DOMVersion="${DOM}">
<DocumentPreference PageHeight="${n(h)}" PageWidth="${n(w)}" PageOrientation="${w > h ? 'Landscape' : 'Portrait'}" PagesPerDocument="1" FacingPages="${s.arrangement === 'spreads'}" StartPageNumber="1" PageBinding="LeftToRight" AllowPageShuffle="true" DocumentBleedUniformSize="true" DocumentBleedTopOffset="0" DocumentBleedBottomOffset="0" DocumentBleedInsideOrLeftOffset="0" DocumentBleedOutsideOrRightOffset="0" Intent="PrintIntent"/>
${marginXml(s)}
<ViewPreference HorizontalMeasurementUnits="${rulers}" VerticalMeasurementUnits="${rulers}"/>
</idPkg:Preferences>`;
}

/**
 * Margins from the border guide dropped photos fit inside. For a facing-pages document,
 * Left and Right are inside and outside; for single pages, and on a page, they're its own
 * left and right.
 */
function marginXml(s: Sheet, side?: PageSide): string {
  const drop = dropGuide(s);
  const g = drop ? edgesOf(drop) : { top: 0, bottom: 0, inside: 0, outside: 0 };
  const [left, right] = leftRight(side ?? (s.arrangement === 'frames' ? 'whole' : undefined), g);
  const pt = ptPerUnit(s);
  const m = (v: number) => n(v * pt);
  return `<MarginPreference ColumnCount="1" ColumnGutter="12" Top="${m(g.top)}" Bottom="${m(g.bottom)}" Left="${m(left)}" Right="${m(right)}" ColumnDirection="Horizontal" ColumnsPositions="0 ${m(s.pageW - left - right)}"/>`;
}

function spreadXml(
  project: Project,
  spread: Spread,
  index: number,
  spreadId: string,
  id: () => string,
  links: Map<string, LinkedImage>,
): string {
  const s = sheetOf(project);
  const pt = ptPerUnit(s);
  const sides = pageSides(spread.kind);
  const first = allSpreads(project)
    .slice(0, index)
    .reduce((n, sp) => n + pageSides(sp.kind).length, 0);
  const top = (-s.pageH * pt) / 2;

  const pages = sides.map((side, i) => {
    const x = (pageRect(side, s).x + frameShift(s)) * pt;
    return `<Page Self="${id()}" Name="${first + i + 1}" AppliedMaster="n" GeometricBounds="0 0 ${n(s.pageH * pt)} ${n(s.pageW * pt)}" ItemTransform="1 0 0 1 ${n(x)} ${n(top)}" MasterPageTransform="1 0 0 1 0 0">
${marginXml(s, side)}
${guidesXml(s, side, i, id)}
</Page>`;
  });

  const frames = [...spread.items]
    .sort((a, b) => a.z - b.z)
    .map((p) => {
      const x1 = (p.x + frameShift(s)) * pt;
      const y1 = p.y * pt + top;
      const x2 = x1 + p.w * pt;
      const y2 = y1 + p.h * pt;
      const points = [
        [x1, y1],
        [x1, y2],
        [x2, y2],
        [x2, y1],
      ]
        .map(([x, y]) => {
          const at = `${n(x!)} ${n(y!)}`;
          return `<PathPointType Anchor="${at}" LeftDirection="${at}" RightDirection="${at}"/>`;
        })
        .join('');
      const meta = project.photos[p.photoId];
      const link = links.get(p.photoId);
      const image = link ? imageXml(id, link, { x: x1, y: y1, w: x2 - x1, h: y2 - y1 }, meta?.crop) : '';
      return `<Rectangle Self="${id()}" Name="${esc(meta?.name ?? '$ID/')}" ContentType="GraphicType" StoredState="Normal" ItemLayer="${LAYER}" Locked="false" Visible="true" AppliedObjectStyle="ObjectStyle/$ID/[None]" FillColor="Swatch/None" StrokeColor="Swatch/None" StrokeWeight="0" ItemTransform="1 0 0 1 0 0">
<Properties><PathGeometry><GeometryPathType PathOpen="false"><PathPointArray>${points}</PathPointArray></GeometryPathType></PathGeometry></Properties>
${image}
</Rectangle>`;
    });

  const offset = index * (s.pageH * pt + SPREAD_SPACING);
  return `${HEAD}
<idPkg:Spread xmlns:idPkg="${PKG}" DOMVersion="${DOM}">
<Spread Self="${spreadId}" PageCount="${sides.length}" BindingLocation="${sides[0] === 'left' ? 1 : 0}" ShowMasterItems="true" AllowPageShuffle="true" ItemTransform="1 0 0 1 0 ${n(offset)}">
${pages.join('\n')}
${frames.join('\n')}
</Spread>
</idPkg:Spread>`;
}

/** Ruler guides: the center lines, line guides, and every border guide but the margins' one. */
function guidesXml(s: Sheet, side: PageSide, pageIndex: number, id: () => string): string {
  const pt = ptPerUnit(s);
  const w = s.pageW * pt;
  const h = s.pageH * pt;
  const margin = dropGuide(s);
  const vertical: number[] = [];
  const horizontal: number[] = [];
  if (s.centerV) vertical.push(w / 2);
  if (s.centerH) horizontal.push(h / 2);
  for (const b of s.borders) {
    if (b.id === margin?.id) continue;
    const g = edgesOf(b);
    const [left, right] = leftRight(side, g);
    vertical.push(left * pt, w - right * pt);
    horizontal.push(g.top * pt, h - g.bottom * pt);
  }
  // Line guides' positions from the page's left edge.
  const page = pageRect(side, s);
  for (const l of s.lines.filter((l) => lineOnPage(s, l))) {
    if (l.axis === 'vertical') vertical.push((linePosition(side, s, l) - page.x) * pt);
    else horizontal.push(l.at * pt);
  }
  // Vertical guides are placed from the spread's left edge, not the page's.
  const left = pageIndex * w;
  const guide = (orientation: string, at: number) =>
    `<Guide Self="${id()}" Orientation="${orientation}" Location="${n(orientation === 'Vertical' ? left + at : at)}" FitToPage="true" ViewThreshold="0" Locked="false" ItemLayer="${LAYER}" PageIndex="${pageIndex}" GuideType="Ruler"/>`;
  const unique = (v: number[]) => [...new Set(v.map((x) => Math.round(x * 1000) / 1000))];
  return [
    ...unique(vertical).map((v) => guide('Vertical', v)),
    ...unique(horizontal).map((y) => guide('Horizontal', y)),
  ].join('\n');
}

/**
 * A linked image in its frame, scaled from its size at its stored resolution: filling it,
 * or for a cropped photo, the whole image placed so the frame shows its crop (InDesign
 * clips the rest, which stays there to recrop).
 */
function imageXml(
  id: () => string,
  link: LinkedImage,
  frame: { x: number; y: number; w: number; h: number },
  crop: Crop | undefined,
): string {
  const gw = (link.pxW * PT_PER_INCH) / link.ppi;
  const gh = (link.pxH * PT_PER_INCH) / link.ppi;
  const whole = wholeRect(frame, cropOf({ crop }));
  const sx = whole.w / gw;
  const sy = whole.h / gh;
  const format = link.format === 'png' ? '$ID/Portable Network Graphics (PNG)' : '$ID/JPEG';
  const ppi = n(link.ppi);
  return `<Image Self="${id()}" ItemTransform="${n(sx)} 0 0 ${n(sy)} ${n(whole.x)} ${n(whole.y)}" ActualPpi="${ppi} ${ppi}" EffectivePpi="${Math.round(link.ppi / sx)} ${Math.round(link.ppi / sy)}">
<Properties><GraphicBounds Left="0" Top="0" Right="${n(gw)}" Bottom="${n(gh)}"/></Properties>
<Link Self="${id()}" LinkResourceURI="file:${esc(link.path.split('/').map(encodeURIComponent).join('/'))}" LinkResourceFormat="${format}" StoredState="Normal" LinkClassID="35906" LinkClientID="257" LinkResourceModified="false" LinkObjectModified="false" ShowInUI="true" CanEmbed="true" CanUnembed="true" CanPackage="true" ImportPolicy="NoAutoImport" ExportPolicy="NoAutoExport"/>
</Image>`;
}

/** A number for XML: no exponent notation, and no floating-point noise. */
function n(v: number): string {
  return String(Math.round(v * 10000) / 10000);
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function xmlBlob(xml: string): Blob {
  return new Blob([xml], { type: 'application/xml' });
}
