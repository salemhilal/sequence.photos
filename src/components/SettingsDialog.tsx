import { useEffect, useState } from 'react';
import { Ruler } from 'lucide-react';
import { platform } from '#platform';
import { Dialog } from './Dialog';
import { formatBytes, readStorageStatus, requestPersistence, type StorageStatus } from '../storage';
import { projectStore, useProject } from '../store';
import type { ThemePref } from '../theme';
import { setTheme, closeModal, openModal, ui } from '../ui';
import { DeskColorPicker } from './DeskColorPicker';
import { PageSizeFields } from './PageSizeFields';

const THEMES: { value: ThemePref; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

function ThemePicker() {
  const theme = ui.use((s) => s.theme);
  return (
    <div className="segmented" role="radiogroup" aria-labelledby="appearance-label">
      {THEMES.map((t) => (
        <label key={t.value} className={theme === t.value ? 'on' : ''}>
          <input
            type="radio"
            name="theme"
            value={t.value}
            checked={theme === t.value}
            onChange={() => setTheme(t.value)}
          />
          {t.label}
        </label>
      ))}
    </div>
  );
}

/** How much space the project uses in this browser, and whether the browser will keep it. */
function StorageRow() {
  const [status, setStatus] = useState<StorageStatus | null | undefined>(undefined);
  const [declined, setDeclined] = useState(false);

  useEffect(() => {
    void readStorageStatus().then(setStatus);
  }, []);

  if (status === undefined) return null;
  if (status === null) return <p className="help">This browser doesn't report storage details.</p>;

  const protect = async () => {
    const granted = await requestPersistence();
    setDeclined(!granted);
    setStatus(await readStorageStatus());
  };

  return (
    <>
      {status.usage !== null && <span className="data">{formatBytes(status.usage)} used</span>}
      {status.persisted ? (
        <p className="help">Protected: the browser won't clear it on its own.</p>
      ) : (
        <>
          <p className="help">Not protected: the browser may clear it if space runs low.</p>
          <button className="btn" onClick={() => void protect()}>
            Protect storage
          </button>
          {declined && <p className="help">The browser declined. Installing the app usually helps.</p>}
        </>
      )}
      <p className="help">Export your project to keep a backup.</p>
    </>
  );
}

export function SettingsDialog() {
  const { project } = useProject();
  const s = project.settings;

  return (
    <Dialog title="Settings" onClose={closeModal} className="settings">
      <div className="settings-body">
        <section className="setting">
          <h3>Layout</h3>
          <div className="setting-controls">
            <PageSizeFields />
            <label className="check">
              <input
                type="checkbox"
                checked={s.keepRelative}
                onChange={(e) => projectStore.apply((d) => void (d.settings.keepRelative = e.target.checked))}
              />
              Keep photos relative to guides
            </label>
            <p className="help">
              {s.keepRelative
                ? 'When the size changes, photos move and scale with the guides.'
                : 'When the size changes, photos keep their exact position.'}
            </p>
          </div>
        </section>

        <section className="setting">
          <h3>Guides</h3>
          <div className="setting-controls">
            <button className="btn" onClick={() => openModal('guides')}>
              <Ruler />
              Edit guides…
            </button>
            <p className="help">Border guides, center lines, and guides from the rulers.</p>
          </div>
        </section>

        <section className="setting app-setting">
          <h3 id="appearance-label">Appearance</h3>
          <div className="setting-controls">
            <ThemePicker />
          </div>
        </section>

        <section className="setting">
          <h3>Desk</h3>
          <div className="setting-controls">
            <DeskColorPicker />
            <p className="help">Also in the desk's right-click menu.</p>
          </div>
        </section>

        {/* A browser concern: the Mac app's storage isn't the browser's. */}
        {platform.kind === 'browser' && (
          <section className="setting">
            <h3>Storage</h3>
            <div className="setting-controls">
              <StorageRow />
            </div>
          </section>
        )}
      </div>
    </Dialog>
  );
}
