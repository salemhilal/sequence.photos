import { useEffect, useState } from 'react';
import { platform } from '#platform';
import { Dialog } from './Dialog';
import { formatBytes, readStorageStatus, requestPersistence, type StorageStatus } from '../storage';
import type { ThemePref } from '../theme';
import { setTheme, closeModal, ui } from '../ui';
import { DeskColorPicker } from './DeskColorPicker';

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

/** The app's own preferences; the project's page setup is in Layout. */
export function SettingsDialog() {
  return (
    <Dialog title="Settings" onClose={closeModal} className="settings">
      <div className="settings-body">
        <section className="setting">
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
