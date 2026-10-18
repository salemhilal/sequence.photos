import { Minus, Plus } from 'lucide-react';
import { fitDesk } from '../actions';
import { allSpreads, sheetOf } from '../spreads';
import { useProject } from '../store';
import { ui } from '../ui';
import { TERMS } from '../units';
import { zoomBy, zoomTo } from '../deskZoom';
import { Menu } from './Menu';

const ZOOM_STEP = 1.25;
const ZOOM_LEVELS = [0.5, 1, 2];

/**
 * The window's bottom line, as in desktop apps: the hint for what's under the pointer, or
 * else what the open page or the spread editor says (its size, how to use it), or else, on
 * the desk, what's selected (with nothing selected, how many photos are on the desk and
 * placed); then progress (adding photos, exporting), and the desk's zoom.
 */
export function StatusBar() {
  const { project } = useProject();
  const importing = ui.use((s) => s.importing);
  const busy = ui.use((s) => s.busy);
  const photosSelected = ui.use((s) => s.selection.length);
  const spreadsSelected = ui.use((s) => s.spreadSelection.length);
  const zoom = ui.use((s) => s.view.zoom);
  const page = ui.use((s) => s.page);
  const pageStatus = ui.use((s) => s.pageStatus);
  const hint = ui.use((s) => s.hint);
  // The zoom is the desk's; the editor over it has its own view.
  const onDesk = ui.use((s) => s.page === 'desk' && s.editingSpreadId === null);
  const sheet = sheetOf(project);
  const placed = new Set(allSpreads(project).flatMap((s) => s.items.map((i) => i.photoId))).size;
  const terms = TERMS[sheet.arrangement];
  // A hint, else what the open page or editor says, else the desk's selection or counts.
  const text = hint
    ? hint
    : pageStatus || page !== 'desk'
      ? pageStatus
      : photosSelected > 0
        ? `${photosSelected} ${photosSelected === 1 ? 'photo' : 'photos'} selected`
        : spreadsSelected > 0
          ? `${spreadsSelected} ${spreadsSelected === 1 ? terms.spread : terms.spreads} selected`
          : `${project.pile.length} on desk, ${placed} placed`;

  return (
    <footer className="statusbar">
      {text && <span className="status-text">{text}</span>}
      {importing ? (
        <span className="status-progress" role="status">
          {importing.label ?? 'Adding photos'}
          {importing.total ? ` ${importing.done}/${importing.total}` : '…'}
          <progress
            max={importing.total || undefined}
            value={importing.total ? importing.done : undefined}
            aria-label={importing.label ?? 'Adding photos'}
          />
        </span>
      ) : (
        busy && (
          <span className="status-progress" role="status">
            {busy}
          </span>
        )
      )}
      <span className="spacer" />
      {onDesk && (
        <span className="status-zoom">
          <button className="btn ghost icon" aria-label="Zoom out" onClick={() => zoomBy(1 / ZOOM_STEP)}>
            <Minus />
          </button>
          <Menu
            up
            tip="Zoom"
            label={`${Math.round(zoom * 100)}%`}
            items={[
              { label: 'Show all photos', icon: null, onSelect: fitDesk },
              ...ZOOM_LEVELS.map((z, i) => ({
                label: `${z * 100}%`,
                icon: null,
                onSelect: () => zoomTo(z),
                separatorBefore: i === 0,
              })),
            ]}
          />
          <button className="btn ghost icon" aria-label="Zoom in" onClick={() => zoomBy(ZOOM_STEP)}>
            <Plus />
          </button>
        </span>
      )}
    </footer>
  );
}
