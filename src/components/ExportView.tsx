import { lazy, Suspense, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight, FileText, Images, Info, Package, Send, TriangleAlert, X } from 'lucide-react';
import { platform } from '#platform';
import {
  converts,
  defaultOptions,
  destinations,
  exportPxPerUnit,
  perOf,
  type Destination,
  type ExportOptions,
  type Per,
} from '../exportOptions';
import { useWindowEvent } from '../hooks';
import { exportIndesign } from '../indesign';
import { useInstagram } from '../instagram';
import { savePdf } from '../pdf';
import { exportImages, imageNames } from '../rasterExport';
import { outputPages, pageRegion, type OutputPage } from '../renderPlan';
import { showPhoto, softPhotos, softSentence } from '../resolution';
import { sheetOf } from '../spreads';
import { useProject } from '../store';
import type { Project, Sheet } from '../types';
import { closeModal, modalLocked, openModal, ui } from '../ui';
import { TERMS, UNITS } from '../units';
import { NumberField } from './NumberField';
import { Segmented } from './Segmented';
import { PageCanvas } from './SpreadCanvas';

const InstagramPost = lazy(() => import('./InstagramPost').then((m) => ({ default: m.InstagramPost })));

/**
 * File → Export…: pick where the project goes (a PDF, images, InDesign, or Instagram) and
 * that destination's options, beside a preview of what it makes. Where the destination
 * measures differently from the project (inches to images, pixels to a PDF), a note says
 * how it converts, with the dpi it converts at.
 */

const DESTINATIONS: Record<Destination, { label: string; icon: ReactNode }> = {
  pdf: { label: 'PDF', icon: <FileText /> },
  images: { label: 'Images', icon: <Images /> },
  indesign: { label: 'InDesign', icon: <Package /> },
  instagram: { label: 'Instagram', icon: <Send /> },
};

/** Room around the preview, as a share of a page's width. */
const PAD_SHARE = 0.05;

const round2 = (n: number) => Math.round(n * 100) / 100;

export function ExportView() {
  const { project } = useProject();
  const sheet = sheetOf(project);
  const available = destinations(project, platform.kind === 'browser');
  const picked = ui.use((s) => s.exportTo);
  const to = available.includes(picked) ? picked : 'pdf';
  const [options, setOptions] = useState<ExportOptions>(() => defaultOptions(sheet));
  const set = (o: Partial<ExportOptions>) => setOptions((was) => ({ ...was, ...o }));
  const busy = ui.use((s) => s.busy);

  const close = () => {
    if (!modalLocked()) closeModal();
  };
  useWindowEvent('keydown', (e) => {
    if (e.key === 'Escape' && !(e.target instanceof HTMLTextAreaElement)) close();
  });

  const picker = (locked: boolean) => (
    <section>
      <h3>Destination</h3>
      <div className="export-destinations" role="radiogroup" aria-label="Destination">
        {available.map((d) => (
          <button
            key={d}
            role="radio"
            aria-checked={d === to}
            className={`export-destination${d === to ? ' on' : ''}`}
            disabled={locked}
            onClick={() => ui.set({ exportTo: d })}
          >
            {DESTINATIONS[d].icon}
            {DESTINATIONS[d].label}
          </button>
        ))}
      </div>
    </section>
  );

  const units = UNITS[sheet.unit];
  return (
    <div className="modal-backdrop" data-modal onPointerDown={(e) => e.target === e.currentTarget && close()}>
      <div className="modal editor export-view" data-modal>
        <header className="modal-head">
          <div className="modal-title">
            <span className="folio">Export</span>
            <span className="muted data">
              {units.format(sheet.pageW)} × {units.format(sheet.pageH)} {units.suffix}{' '}
              {TERMS[sheet.arrangement].spreads}
              {sheet.unit === 'in' && ` · ${sheet.pxPerUnit} dpi`}
            </span>
          </div>
          <span className="spacer" />
          <button className="btn ghost icon" aria-label="Close" onClick={close}>
            <X />
          </button>
        </header>
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

  const run = async () => {
    const saved =
      to === 'pdf' ? await savePdf(options) : to === 'images' ? await exportImages(options) : await exportIndesign();
    if (saved) closeModal();
  };
  const action =
    to === 'pdf'
      ? 'Save PDF'
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
    <div className="inline dpi">
      <span>{label}</span>
      <NumberField units={UNITS.px} min={1} suffix={false} value={value} onCommit={onCommit} />
      <span className="muted data">dpi</span>
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
              {dpiField('At', options.dpi, setDpi)}
              {options.dpi >= maxDpi && <p className="help">Up to the page’s {maxDpi} dpi.</p>}
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
            <h3>Photo resolution</h3>
            {dpiField('Up to', options.dpi, setDpi)}
            <p className="help">At most the page’s {maxDpi} dpi. Lower makes a smaller file, for a proof.</p>
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
            <p className="help">
              Saved as a ZIP:{' '}
              {imageNames(project, pages, options.format === 'png' ? 'png' : 'jpg')
                .slice(0, 2)
                .join(', ')}
              {pages.length > 2 ? ', …' : ''}
            </p>
          </section>
        )}

        {to === 'indesign' && (
          <section>
            <p className="help">
              An InDesign file with every photo linked at full size, and the guides as InDesign guides.
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

/** An output page's size in pixels, at `pxPerUnit`. */
function pixelSize(page: OutputPage | undefined, sheet: Sheet, pxPerUnit: number): string {
  if (!page) return '';
  const r = pageRegion(page, sheet);
  return `${Math.round(r.w * pxPerUnit)} × ${Math.round(r.h * pxPerUnit)} px`;
}

/** Instagram: its own preview and settings, once it's connected. */
function InstagramDestination({ sheet, picker }: { sheet: Sheet; picker: (locked: boolean) => ReactNode }) {
  const connection = useInstagram();
  const ready = connection !== null && !connection.needsReconnect;
  if (!ready) {
    return (
      <>
        <div className="editor-stage export-empty">
          <p className="muted">{connection ? 'Instagram needs reconnecting.' : 'Instagram isn’t connected.'}</p>
        </div>
        <aside className="inspector sectioned export-panel">
          {picker(false)}
          <section className="export-actions">
            <p className="help">Posting goes through your Instagram account, connected in Settings.</p>
            <button className="btn primary" onClick={() => openModal('settings')}>
              {connection ? 'Reconnect in Settings' : 'Connect in Settings'}
            </button>
          </section>
        </aside>
      </>
    );
  }
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
  const [index, setIndex] = useState(0);
  const at = Math.min(index, pages.length - 1);
  const page = pages[at];
  const stageRef = useRef<HTMLDivElement>(null);
  const [stage, setStage] = useState({ w: 800, h: 500 });

  useLayoutEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      if (entry) setStage({ w: entry.contentRect.width, h: entry.contentRect.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const go = (d: number) => setIndex(Math.min(pages.length - 1, Math.max(0, at + d)));
  useWindowEvent('keydown', (e) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    if (e.key === 'ArrowLeft') go(-1);
    else if (e.key === 'ArrowRight') go(1);
    else return;
    e.preventDefault();
  });

  if (!page) return <div className="editor-stage" ref={stageRef} />;
  const region = pageRegion(page, sheet);
  const pad = sheet.pageW * PAD_SHARE;
  // Room below for the controls.
  const scale = Math.max(0, Math.min(stage.w / (region.w + 2 * pad), (stage.h - 56) / (region.h + 2 * pad)));
  const units = UNITS[sheet.unit];
  const size =
    pxPerUnit !== null
      ? pixelSize(page, sheet, pxPerUnit)
      : `${units.format(region.w)} × ${units.format(region.h)} ${units.suffix}`;

  return (
    <div className="editor-stage page-preview" ref={stageRef}>
      <PageCanvas page={page} sheet={sheet} scale={scale} />
      <div className="page-preview-controls">
        <button className="btn ghost icon" aria-label="Previous" disabled={at === 0} onClick={() => go(-1)}>
          <ChevronLeft />
        </button>
        <span className="muted data">
          {at + 1} / {pages.length} · {size}
        </span>
        <button className="btn ghost icon" aria-label="Next" disabled={at === pages.length - 1} onClick={() => go(1)}>
          <ChevronRight />
        </button>
      </div>
    </div>
  );
}
