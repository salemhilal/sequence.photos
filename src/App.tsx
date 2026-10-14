import { useEffect, useState, lazy, Suspense } from 'react';
import {
  Download,
  FilePlus,
  FolderOpen,
  ImagePlus,
  Info,
  Compass,
  PanelRightClose,
  PanelRightOpen,
  Redo2,
  Settings,
  Undo2,
  X,
  Ruler,
} from 'lucide-react';
import { usePasteHandler } from './clipboard';
import { platform } from '#platform';
import { runCommand, shortcutLabel, useCommandShortcuts } from './commands';
import { AboutDialog } from './components/AboutDialog';
import { ConfirmDialog } from './components/ConfirmDialog';
import { ContextMenus } from './components/ContextMenu';
import { Desk } from './components/Desk';
import { FileMenu } from './components/FileMenu';
import { useCommandItem, useExportItems } from './components/exportItems';
import { LayoutEditor } from './components/LayoutEditor';
import { PhotoImg } from './components/PhotoImg';
import { Preview } from './components/Preview';
import { QuickLook } from './components/QuickLook';
import { SettingsDialog } from './components/SettingsDialog';
import { Sidebar } from './components/Sidebar';
import { SpreadEditor } from './components/SpreadEditor';
import { Tour } from './components/Tour';
import { usePersistence } from './persistence';
import { tourSeenPref } from './prefs';
import { startTour } from './tour';
import { projectStore, useProject } from './store';
import { openModal, toggleSidebar, ui } from './ui';
import { takeOver } from './tabLock';
import { checkForUpdate, reloadToUpdate } from './update';
import { allSpreads, findSpread } from './spreads';
import { TERMS } from './units';

// Loaded when opened: it's the website's only (the Mac app doesn't post to Instagram).
const InstagramPost = lazy(() => import('./components/InstagramPost').then((m) => ({ default: m.InstagramPost })));

const NOTICE_MS = 6000;

/**
 * A phone or tablet: a touch screen with no mouse or trackpad. The app is built for
 * dragging with a pointer on a larger screen, so these get a warning first.
 */
function onTouchDevice(): boolean {
  if (platform.kind !== 'browser' || typeof matchMedia !== 'function') return false;
  return matchMedia('(pointer: coarse)').matches && !matchMedia('(any-pointer: fine)').matches;
}

export default function App() {
  const { project, canUndo, canRedo } = useProject();
  const terms = TERMS[project.layout.kind];
  const exportItems = useExportItems();
  const fileItem = useCommandItem();
  // Dismissed for this visit only: a reload shows it again.
  const [mobileNotice, setMobileNotice] = useState(onTouchDevice);
  const editing = ui.use((s) => s.editingSpreadId);
  const modal = ui.use((s) => s.modal);
  const importing = ui.use((s) => s.importing);
  const notice = ui.use((s) => s.notice);
  const busy = ui.use((s) => s.busy);
  const sidebarOpen = ui.use((s) => s.sidebarOpen);
  const blocked = ui.use((s) => s.blocked);
  const updateReady = ui.use((s) => s.updateReady);
  const saveFailed = ui.use((s) => s.saveFailed);
  const windowTitle = ui.use((s) => s.windowTitle);
  const loaded = usePersistence();

  useCommandShortcuts();
  usePasteHandler();

  // The open spread or frame went away (undo, a layout switch): close the editor, so it
  // doesn't stay open, invisible, holding the desk's shortcuts.
  useEffect(() => {
    if (editing && !findSpread(project, editing)) ui.set({ editingSpreadId: null });
  }, [project, editing]);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => ui.set({ notice: null }), NOTICE_MS);
    return () => clearTimeout(t);
  }, [notice]);

  // The first time this browser opens the app to an empty project, show the tour.
  const fresh = loaded && Object.keys(project.photos).length === 0;
  useEffect(() => {
    if (fresh && !tourSeenPref.load()) startTour();
  }, [fresh]);

  if (blocked === 'elsewhere') return <ElsewhereScreen />;
  if (blocked === 'outdated') return <OutdatedScreen />;
  if (mobileNotice) return <MobileNotice onContinue={() => setMobileNotice(false)} />;
  if (!loaded) return <div className="loading">Opening your project…</div>;

  const placed = allSpreads(project).reduce((n, s) => n + s.items.length, 0);
  const status = importing?.total
    ? `Importing ${importing.done} of ${importing.total}…`
    : (busy ?? (importing ? 'Importing…' : `${project.pile.length} on desk · ${placed} placed`));

  return (
    <div className="app">
      {/* In the Mac app this is also the window's title bar: drag it to move the window. */}
      <header className="toolbar" data-tauri-drag-region>
        {windowTitle && (
          <div className="window-title">
            {windowTitle.name}
            {windowTitle.edited && <span className="muted"> — Edited</span>}
          </div>
        )}
        {/* The Mac app has these in its menu bar (and its title bar says whose it is). */}
        {platform.kind === 'browser' && (
          <>
            <span className="wordmark">SEQUENCE</span>
            <FileMenu
              items={[
                fileItem('newProject', <FilePlus />),
                { ...fileItem('addPhotos', <ImagePlus />, importing !== null), separatorBefore: true },
                fileItem('importProject', <FolderOpen />),
                fileItem('exportProject', <Download />),
                ...exportItems,
                { ...fileItem('tour', <Compass />), separatorBefore: true },
                fileItem('about', <Info />, false),
              ]}
            />
            <div className="btn-joined has-hint">
              <button
                className="btn ghost icon"
                aria-label="Undo"
                data-tip={`Undo (${shortcutLabel('undo')})`}
                disabled={!canUndo}
                onClick={() => projectStore.undo()}
              >
                <Undo2 />
              </button>
              <button
                className="btn ghost icon"
                aria-label="Redo"
                data-tip={`Redo (${shortcutLabel('redo')})`}
                disabled={!canRedo}
                onClick={() => projectStore.redo()}
              >
                <Redo2 />
              </button>
              <ShortcutHint label={`${shortcutLabel('undo')} · ${shortcutLabel('redo')}`} below />
            </div>
          </>
        )}
        <span className="spacer" data-tauri-drag-region />
        <span className="status" data-tauri-drag-region>
          {status}
        </span>
        <button
          className="btn ghost"
          data-tour="layout"
          onClick={() => openModal('layout')}
          data-tip="Layout: size and guides"
        >
          <Ruler />
          Layout
        </button>
        <button
          className="btn accent has-hint"
          data-tour="preview"
          onClick={() => openModal('preview')}
          data-tip={`Preview (${shortcutLabel('preview')})`}
        >
          {terms.preview}
          <ShortcutHint label={shortcutLabel('preview')} />
        </button>
        <button
          className={`btn ghost icon has-hint${sidebarOpen ? '' : ' active'}`}
          aria-label={`${sidebarOpen ? 'Hide' : 'Show'} ${terms.spreads}`}
          aria-pressed={!sidebarOpen}
          onClick={toggleSidebar}
          data-tip={`${sidebarOpen ? 'Hide' : 'Show'} ${terms.spreads} (${shortcutLabel('toggleSidebar')})`}
        >
          {sidebarOpen ? <PanelRightClose /> : <PanelRightOpen />}
          <ShortcutHint label={shortcutLabel('toggleSidebar')} />
        </button>
        <button
          className="btn ghost icon has-hint"
          aria-label="Settings"
          onClick={() => openModal('settings')}
          data-tip={`Settings (${shortcutLabel('settings')})`}
        >
          <Settings />
          <ShortcutHint label={shortcutLabel('settings')} />
        </button>
      </header>
      <main className="main">
        <Desk />
        {sidebarOpen && <Sidebar />}
        {editing && <SpreadEditor spreadId={editing} />}
      </main>
      {modal === 'settings' && <SettingsDialog />}
      {modal === 'about' && <AboutDialog />}
      {modal === 'preview' && <Preview />}
      {modal === 'layout' && <LayoutEditor />}
      {modal === 'instagram' && (
        <Suspense fallback={null}>
          <InstagramPost />
        </Suspense>
      )}
      <QuickLook />
      <Tour />
      <ConfirmDialog />
      <ContextMenus />
      <DragGhost />
      {saveFailed && (
        <div className="save-failed" role="alert">
          {platform.kind === 'macos'
            ? 'Couldn’t keep a copy of your work in the app’s storage.'
            : 'Couldn’t save your work. Your browser’s storage may be full.'}
          <button className="btn primary" onClick={() => runCommand('exportProject')}>
            {platform.kind === 'macos' ? 'Save to a file' : 'Export a copy'}
          </button>
        </div>
      )}
      {updateReady && (
        <div className="update-bar" role="status">
          A new version is available.
          <button className="btn primary" onClick={reloadToUpdate}>
            Reload
          </button>
        </div>
      )}
      {notice && (
        <div className="notice" role="status">
          {notice}
          <button className="btn icon" aria-label="Dismiss" onClick={() => ui.set({ notice: null })}>
            <X />
          </button>
        </div>
      )}
    </div>
  );
}

/** A shortcut badge shown over (or `below`) its button while the modifier key is held. */
function ShortcutHint({ label, below }: { label: string; below?: boolean }) {
  const show = ui.use((s) => s.hints);
  if (!show) return null;
  return (
    <kbd className={`shortcut-hint${below ? ' below' : ''}`} aria-hidden="true">
      {label}
    </kbd>
  );
}

/** Shown instead of the app while another tab or window is editing the project. */
function ElsewhereScreen() {
  return (
    <div className="screen-message" role="alert">
      <span className="wordmark">SEQUENCE</span>
      <h1>Sequence is open in another window.</h1>
      <p>To keep your work safe, only one window can edit at a time. Using it here stops the other one.</p>
      <button className="btn primary" onClick={takeOver}>
        Use it here
      </button>
    </div>
  );
}

/** Shown instead of the app when the saved project is from a newer version of the app. */
function OutdatedScreen() {
  // The newer version may not have downloaded yet; look for it now.
  useEffect(checkForUpdate, []);
  return (
    <div className="screen-message" role="alert">
      <span className="wordmark">SEQUENCE</span>
      <h1>This project was saved by a newer version of Sequence.</h1>
      {platform.kind === 'macos' ? (
        // The Mac app updates through the App Store, not by reloading.
        <p>Update Sequence from the App Store to open it. Your saved project hasn't been changed.</p>
      ) : (
        <>
          <p>Reload to update. Your saved project hasn't been changed.</p>
          <button className="btn primary" onClick={reloadToUpdate}>
            Reload
          </button>
        </>
      )}
    </div>
  );
}

/** Shown first on a phone or tablet, until dismissed (see onTouchDevice). */
function MobileNotice({ onContinue }: { onContinue: () => void }) {
  return (
    <div className="screen-message" role="alertdialog" aria-labelledby="mobile-notice-title">
      <span className="wordmark">SEQUENCE</span>
      <h1 id="mobile-notice-title">Sequence is made for a computer.</h1>
      <p>
        It's built around a mouse or trackpad and a larger screen. On a phone or tablet, dragging photos, arranging
        spreads, and other parts of it won't work well.
      </p>
      <button className="btn primary" autoFocus onClick={onContinue}>
        Continue anyway
      </button>
    </div>
  );
}

function DragGhost() {
  const ghost = ui.use((s) => s.ghost);
  if (!ghost) return null;
  return (
    <div
      className="drag-ghost"
      style={{ left: ghost.clientX - ghost.w / 2, top: ghost.clientY - ghost.h / 2, width: ghost.w, height: ghost.h }}
    >
      <PhotoImg id={ghost.photoId} />
      {ghost.count > 1 && <span className="drag-ghost-count">{ghost.count}</span>}
    </div>
  );
}
