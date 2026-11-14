import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react';
import { FileText, Images, Info, Package, TriangleAlert } from 'lucide-react';
import {
  converts,
  defaultOptions,
  DESTINATIONS,
  exportPxPerUnit,
  perOf,
  type Destination,
  type ExportOptions,
  type Per,
} from '../exportOptions';
import { useElementSize, usePageStatus, usePager } from '../hooks';
import { exportIndesign } from '../indesign';
import { savePdf } from '../pdf';
import { estimateImagesSize, exportImages, imageNames } from '../rasterExport';
import { outputPages, pageRegion, type OutputPage } from '../renderPlan';
import { showPhoto, softPhotos, softSentence } from '../resolution';
import { sheetExtent } from '../geometry';
import { sheetOf } from '../spreads';
import { useProject } from '../store';
import type { Project, Sheet } from '../types';
import { saveExportState } from '../exportState';
import { goToPage, ui } from '../ui';
import { TERMS, UNITS } from '../units';
import { NumberField } from './NumberField';
import { Pager } from './Pager';
import { Segmented } from './Segmented';
import { PageCanvas } from './SpreadCanvas';
import { InstagramGlyph } from './InstagramGlyph';

const InstagramPost = lazy(() => import('./InstagramPost').then((m) => ({ default: m.InstagramPost })));

/**
 * File → Export…: pick where the project goes (a PDF, images, InDesign, or Instagram) and
 * that destination's options, beside a preview of what it makes. Where the destination
 * measures differently from the project (inches to images, pixels to a PDF), a note says
 * how it converts, with the dpi it converts at.
 */

/** How each destination shows in the picker. */
const LOOKS: Record<Destination, { label: string; icon: ReactNode }> = {
  pdf: { label: 'PDF', icon: <FileText /> },
  images: { label: 'Images', icon: <Images /> },
  indesign: { label: 'InDesign', icon: <Package /> },
  instagram: { label: 'Instagram', icon: <InstagramGlyph /> },
};

/**
 * Where Export opens before anything's picked: a book or zine in inches as a PDF; pixel
 * frames at Instagram's width to Instagram (on the web), other pixel frames as images.
 */
function defaultDestination(sheet: Sheet): Destination {
  if (sheet.unit === 'in') return 'pdf';
  if (sheet.arrangement === 'frames' && sheet.pageW === 1080) return 'instagram';
  return 'images';
}

/** Room around the preview, as a share of a page's width. */
const PAD_SHARE = 0.05;

const round2 = (n: number) => Math.round(n * 100) / 100;

export function ExportView() {
  const { project } = useProject();
  const sheet = sheetOf(project);
  const to = ui.use((s) => s.exportTo) ?? project.export?.to ?? defaultDestination(sheet);
  const pick = (d: Destination) => {
    ui.set({ exportTo: d });
    saveExportState((s) => ({ ...s, to: d }));
  };
  // The choices made last time, saved with the project. (The dpi starts from the page's.)
  const [options, setOptions] = useState<ExportOptions>(() => ({
    ...defaultOptions(sheet),
    ...project.export?.options,
  }));
  const set = (o: Partial<ExportOptions>) => {
    const next = { ...options, ...o };
    setOptions(next);
    const { per, format, quality, printAt } = next;
    saveExportState((s) => ({ ...s, options: { per, format, quality, printAt } }));
  };
  const busy = ui.use((s) => s.busy);

  // What's exported, in the status bar.
  const units = UNITS[sheet.unit];
  const status = `${units.format(sheet.pageW)} × ${units.format(sheet.pageH)} ${units.suffix} ${
    TERMS[sheet.arrangement].spreads
  }${sheet.unit === 'in' ? ` · ${sheet.pxPerUnit} dpi` : ''}`;
  usePageStatus(status);

  const picker = (locked: boolean) => (
    <section>
      <h3>Destination</h3>
      <div className="export-destinations" role="radiogroup" aria-label="Destination">
        {DESTINATIONS.map((d) => (
          <button
            key={d}
            role="radio"
            aria-checked={d === to}
            className={`export-destination${d === to ? ' on' : ''}`}
            disabled={locked}
            onClick={() => pick(d)}
          >
            {LOOKS[d].icon}
            {LOOKS[d].label}
          </button>
        ))}
      </div>
    </section>
  );

  return (
    <div className="page-view export-view">
      <div className="editor-body">
        {to === 'instagram' ? (
          <InstagramDestination sheet={sheet} picker={picker} />
        ) : (
          <FileDestination
            to={to}
            project={project}
            sheet={sheet}
            options={options}
            set={set}
            busy={busy}
            picker={picker(busy !== null)}
          />
        )}
      </div>
    </div>
  );
}

interface FileProps {
  to: Exclude<Destination, 'instagram'>;
  project: Project;
  sheet: Sheet;
  options: ExportOptions;
  set: (o: Partial<ExportOptions>) => void;
  busy: string | null;
  picker: ReactNode;
}

/** A PDF, images, or InDesign: the pages it makes, and its options. */
function FileDestination({ to, project, sheet, options, set, busy, picker }: FileProps) {
  const per = perOf(project, options);
  // InDesign keeps a book's spreads.
  const pages = outputPages(project, to === 'indesign' ? 'spread' : per);
  const pxPerUnit = exportPxPerUnit(to, sheet, options);
  const soft = softPhotos(project, pxPerUnit);
  const first = soft[0];
  const spreads = project.layout.kind === 'spreads';
  const converting = converts(to, sheet);
  const maxDpi = sheet.unit === 'in' ? sheet.pxPerUnit : 1;
  const setDpi = (n: number) => set({ dpi: Math.min(maxDpi, Math.max(1, Math.round(n))) });

  const estimate = useImagesEstimate(to === 'images', project, per, options.format, options.quality, pxPerUnit);

  const run = async () => {
    const saved =
      to === 'pdf' ? await savePdf(options) : to === 'images' ? await exportImages(options) : await exportIndesign();
    if (saved) goToPage('desk');
  };
  const action =
    to === 'pdf'
      ? 'Export PDF'
      : to === 'images'
        ? `Export ${pages.length} ${pages.length === 1 ? 'image' : 'images'}`
        : 'Export for InDesign';
  const perChoice = (
    <section>
      <h3>{to === 'pdf' ? 'One PDF page per' : 'One image per'}</h3>
      <Segmented<Per>
        halves
        label={to === 'pdf' ? 'One PDF page per' : 'One image per'}
        options={[
          { value: 'spread', label: 'Spread' },
          { value: 'page', label: 'Page' },
        ]}
        value={per}
        onChange={(v) => set({ per: v })}
        disabled={busy !== null}
      />
    </section>
  );
  const dpiField = (label: string, value: number, onCommit: (n: number) => void) => (
    <div className="field-row">
      <span className="field-label">{label}</span>
      <NumberField
        units={UNITS.px}
        min={1}
        suffixText="dpi"
        ariaLabel={`${label}, in dpi`}
        value={value}
        onCommit={onCommit}
      />
    </div>
  );

  return (
    <>
      <OutputPreview pages={pages} sheet={sheet} pxPerUnit={to === 'images' ? pxPerUnit : null} />
      <aside className="inspector sectioned export-panel">
        {picker}

        {converting && to === 'images' && (
          <section>
            <div className="export-note">
              <p>
                <Info aria-hidden="true" /> Pages are measured in inches, so they’re turned into pixels:{' '}
                <span className="data">
                  {Math.round(sheet.pageW * pxPerUnit)} × {Math.round(sheet.pageH * pxPerUnit)} px
                </span>{' '}
                a page.
              </p>
              {dpiField('Resolution', pxPerUnit, setDpi)}
              {pxPerUnit >= maxDpi && <p className="help">Up to the page’s {maxDpi} dpi.</p>}
            </div>
          </section>
        )}
        {converting && to === 'pdf' && (
          <section>
            <div className="export-note">
              <p>
                <Info aria-hidden="true" /> {TERMS[sheet.arrangement].Spreads} are measured in pixels, so they’re given
                a printed size:{' '}
                <span className="data">
                  {round2(sheet.pageW / options.printAt)} × {round2(sheet.pageH / options.printAt)} in
                </span>
                .
              </p>
              {dpiField('Print at', options.printAt, (n) => set({ printAt: Math.max(1, Math.round(n)) }))}
            </div>
          </section>
        )}

        {spreads && to !== 'indesign' && perChoice}

        {to === 'pdf' && sheet.unit === 'in' && (
          <section>
            <h3>Resolution</h3>
            {dpiField('Photos at', pxPerUnit, setDpi)}
            <p className="help">Up to the page’s {maxDpi} dpi. Lower makes a smaller file, for a proof.</p>
          </section>
        )}

        {to === 'images' && (
          <section>
            <h3>Format</h3>
            <Segmented
              halves
              label="Format"
              options={[
                { value: 'jpeg', label: 'JPEG' },
                { value: 'png', label: 'PNG' },
              ]}
              value={options.format}
              onChange={(format) => set({ format })}
              disabled={busy !== null}
            />
            {options.format === 'jpeg' ? (
              <label className="field-row export-quality">
                <span className="field-label">Quality</span>
                <span className="inline slider-control">
                  <input
                    type="range"
                    min={50}
                    max={100}
                    step={1}
                    value={Math.round(options.quality * 100)}
                    disabled={busy !== null}
                    onChange={(e) => set({ quality: e.target.valueAsNumber / 100 })}
                  />
                  <span className="data">{Math.round(options.quality * 100)}%</span>
                </span>
              </label>
            ) : (
              <p className="help">Lossless, so larger.</p>
            )}
            <p className="help">
              Saved as a ZIP:{' '}
              {imageNames(project, pages, options.format === 'png' ? 'png' : 'jpg')
                .slice(0, 2)
                .join(', ')}
              {pages.length > 2 ? ', …' : ''}
            </p>
            <p className="help data">
              {pages.length} {pages.length === 1 ? 'image' : 'images'}
              {estimate !== null && `, ~${formatBytes(estimate)} total`}
            </p>
          </section>
        )}

        {to === 'indesign' && (
          <section>
            <p className="help">
              An InDesign file with every photo linked at full size, and the guides as InDesign guides.
              {!spreads && ' Frames become single pages, without facing pages.'}
              {sheet.unit === 'px' &&
                ` InDesign counts a pixel as a point, so pages open at ${sheet.pageW} × ${sheet.pageH} px.`}
            </p>
          </section>
        )}

        <section className="export-actions">
          {first && (
            <p className="help warn">
              <TriangleAlert aria-hidden="true" /> {softSentence(soft.length, { unit: sheet.unit, pxPerUnit })}{' '}
              <button className="link" onClick={() => showPhoto(first)}>
                Show me
              </button>
            </p>
          )}
          <button className="btn primary" disabled={busy !== null} onClick={() => void run()}>
            {busy ?? action}
          </button>
        </section>
      </aside>
    </>
  );
}

/** The images' total size, estimated a moment after the settings settle (null until then). */
function useImagesEstimate(
  active: boolean,
  project: Project,
  per: Per,
  format: ExportOptions['format'],
  quality: number,
  pxPerUnit: number,
): number | null {
  const [estimate, setEstimate] = useState<{ key: string; bytes: number } | null>(null);
  const key = JSON.stringify([per, format, quality, pxPerUnit]);
  useEffect(() => {
    if (!active) return;
    let stale = false;
    const timer = window.setTimeout(() => {
      const pages = outputPages(project, perOf(project, { per }));
      void estimateImagesSize(pages, project, { format, quality, pxPerUnit })
        .then((bytes) => !stale && setEstimate({ key, bytes }))
        .catch(() => undefined);
    }, 400);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [active, project, key]); // eslint-disable-line react-hooks/exhaustive-deps
  return estimate?.key === key ? estimate.bytes : null;
}

/** "980 KB", "12 MB", "1.4 GB". */
function formatBytes(n: number): string {
  if (n < 1e6) return `${Math.max(1, Math.round(n / 1e3))} KB`;
  if (n < 1e9) return `${Math.round(n / 1e6)} MB`;
  return `${(n / 1e9).toFixed(1)} GB`;
}

/** An output page's size in pixels, at `pxPerUnit`. */
function pixelSize(page: OutputPage | undefined, sheet: Sheet, pxPerUnit: number): string {
  if (!page) return '';
  const r = pageRegion(page, sheet);
  return `${Math.round(r.w * pxPerUnit)} × ${Math.round(r.h * pxPerUnit)} px`;
}

/** Instagram: its own preview and settings, connecting from there when it isn't yet. */
function InstagramDestination({ sheet, picker }: { sheet: Sheet; picker: (locked: boolean) => ReactNode }) {
  return (
    <Suspense fallback={<div className="editor-stage" />}>
      <InstagramPost
        head={(posting) => (
          <>
            {picker(posting)}
            {sheet.unit === 'in' && (
              <section>
                <div className="export-note">
                  <p>
                    <Info aria-hidden="true" /> Pages are measured in inches, so each slide is made at Instagram’s size.
                  </p>
                </div>
              </section>
            )}
          </>
        )}
      />
    </Suspense>
  );
}

/** The pages an export makes, one at a time, with ‹ › and the arrow keys. */
function OutputPreview({
  pages,
  sheet,
  pxPerUnit,
}: {
  pages: OutputPage[];
  sheet: Sheet;
  /** Images: the pixels each page becomes, shown in the label. */
  pxPerUnit: number | null;
}) {
  const { at, go } = usePager(pages.length, true);
  const page = pages[at];
  const [stageRef, stage] = useElementSize<HTMLDivElement>({ w: 800, h: 500 });

  if (!page) return <div className="editor-stage" ref={stageRef} />;
  const region = pageRegion(page, sheet);
  const pad = sheet.pageW * PAD_SHARE;
  // A book's spreads all show at one scale, a whole spread's: a single first or last page
  // comes out the size of a page beside it, not enlarged to fill. Room below for the controls.
  const across = page.part === 'spread' ? sheetExtent(sheet).width : region.w;
  const scale = Math.max(0, Math.min(stage.w / (across + 2 * pad), (stage.h - 56) / (region.h + 2 * pad)));
  const units = UNITS[sheet.unit];
  const size =
    pxPerUnit !== null
      ? pixelSize(page, sheet, pxPerUnit)
      : `${units.format(region.w)} × ${units.format(region.h)} ${units.suffix}`;

  return (
    <div className="editor-stage page-preview" ref={stageRef}>
      <PageCanvas page={page} sheet={sheet} scale={scale} />
      <Pager at={at} count={pages.length} go={go} noun="page" extra={` · ${size}`} />
    </div>
  );
}
