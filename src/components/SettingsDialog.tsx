import { useEffect, useState } from 'react';
import { platform } from '#platform';
import { Dialog } from './Dialog';
import { formatBytes, readStorageStatus, requestPersistence, type StorageStatus } from '../storage';
import type { ThemePref } from '../theme';
import { setTheme, closeModal, ui } from '../ui';
import { DeskColorPicker } from './DeskColorPicker';
import { DEV_SERVER_URL, normalizeServerUrl, SERVER_URL, serverUrlPref } from '../server';

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

type Tab = 'general' | 'advanced';
const TABS: { value: Tab; label: string }[] = [
  { value: 'general', label: 'General' },
  { value: 'advanced', label: 'Advanced' },
];

type ServerChoice = 'default' | 'dev' | 'local';
const SERVER_CHOICES: { value: ServerChoice; label: string }[] = [
  { value: 'default', label: 'Sequence' },
  { value: 'dev', label: 'Development' },
  { value: 'local', label: 'Local' },
];
const LOCAL_DEFAULT = 'http://localhost:8787';

function choiceOf(saved: string): ServerChoice {
  if (saved === '' || saved === SERVER_URL) return 'default';
  return saved === DEV_SERVER_URL ? 'dev' : 'local';
}

/**
 * Which server posts to Instagram: Sequence's (the default), the development one, or one
 * on this computer (e.g. `wrangler dev`). Saved for this browser.
 */
function ServerSetting() {
  const [saved, setSaved] = useState(() => serverUrlPref.load());
  const choice = choiceOf(saved);
  const [local, setLocal] = useState(choice === 'local' ? saved : LOCAL_DEFAULT);
  const localUrl = normalizeServerUrl(local);
  const save = (value: string) => {
    serverUrlPref.save(value);
    setSaved(value);
  };
  const pick = (c: ServerChoice) => {
    if (c === 'default') save('');
    else if (c === 'dev') save(DEV_SERVER_URL);
    else if (localUrl) save(localUrl);
    else save(LOCAL_DEFAULT);
  };

  return (
    <div className="setting-controls">
      <div className="segmented" role="radiogroup" aria-labelledby="server-label">
        {SERVER_CHOICES.map((c) => (
          <label key={c.value} className={choice === c.value ? 'on' : ''}>
            <input
              type="radio"
              name="server"
              value={c.value}
              checked={choice === c.value}
              onChange={() => pick(c.value)}
            />
            {c.label}
          </label>
        ))}
      </div>
      {choice === 'local' ? (
        <form
          className="inline"
          onSubmit={(e) => {
            e.preventDefault();
            if (localUrl) save(localUrl);
          }}
        >
          <input
            className="text-field"
            type="url"
            aria-label="Local server address"
            value={local}
            spellCheck={false}
            autoComplete="off"
            onChange={(e) => setLocal(e.target.value)}
          />
          <button type="submit" className="btn" disabled={!localUrl || localUrl === saved}>
            Save
          </button>
        </form>
      ) : (
        <p className="help data">{choice === 'dev' ? DEV_SERVER_URL : SERVER_URL}</p>
      )}
      {choice === 'local' && !localUrl && <p className="help warn">Use an http://localhost address.</p>}
      <p className="help">Posts to Instagram go through this server. For development only; keep Sequence otherwise.</p>
    </div>
  );
}

/** The app's own preferences; the project's page setup is in Layout. */
export function SettingsDialog() {
  const [tab, setTab] = useState<Tab>('general');
  return (
    <Dialog title="Settings" onClose={closeModal} className="settings">
      <div className="settings-tabs" role="tablist" aria-label="Settings">
        {TABS.map((t) => (
          <button
            key={t.value}
            role="tab"
            id={`settings-tab-${t.value}`}
            aria-selected={tab === t.value}
            aria-controls="settings-panel"
            className={tab === t.value ? 'on' : ''}
            onClick={() => setTab(t.value)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="settings-body" role="tabpanel" id="settings-panel" aria-labelledby={`settings-tab-${tab}`}>
        {tab === 'general' ? <GeneralSettings /> : <AdvancedSettings />}
      </div>
    </Dialog>
  );
}

function AdvancedSettings() {
  return (
    <section className="setting">
      <h3 id="server-label">Server</h3>
      <ServerSetting />
    </section>
  );
}

function GeneralSettings() {
  return (
    <>
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
    </>
  );
}
