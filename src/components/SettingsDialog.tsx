import { useEffect, useState } from 'react';
import { platform } from '#platform';
import { Dialog } from './Dialog';
import { formatBytes, readStorageStatus, requestPersistence, type StorageStatus } from '../storage';
import type { ThemePref } from '../theme';
import { setTheme, closeModal, ui } from '../ui';
import { DeskColorPicker } from './DeskColorPicker';
import { connectInstagram, disconnectInstagram, useInstagram } from '../instagram';
import { defaultServerUrl, DEV_SERVER_URL, normalizeServerUrl, SERVER_URL, serverUrl, serverUrlPref } from '../server';

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

function choiceOf(server: string): ServerChoice {
  if (server === SERVER_URL) return 'default';
  return server === DEV_SERVER_URL ? 'dev' : 'local';
}

/**
 * Which server posts to Instagram: Sequence's (the default), the development one, or one
 * on this computer (e.g. `wrangler dev`). Saved for this browser.
 */
function ServerSetting() {
  const [server, setServer] = useState(serverUrl);
  const choice = choiceOf(server);
  const [local, setLocal] = useState(choice === 'local' ? server : LOCAL_DEFAULT);
  const localUrl = normalizeServerUrl(local);
  // The default (Sequence's, or the development server's when running locally) is
  // stored as no choice, so it follows the default if that changes.
  const save = (value: string) => {
    serverUrlPref.save(value === defaultServerUrl() ? '' : value);
    setServer(value);
  };
  const pick = (c: ServerChoice) => {
    if (c === 'default') save(SERVER_URL);
    else if (c === 'dev') save(DEV_SERVER_URL);
    else save(localUrl ?? LOCAL_DEFAULT);
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
          <button type="submit" className="btn" disabled={!localUrl || localUrl === server}>
            Save
          </button>
        </form>
      ) : (
        <p className="help data">{choice === 'dev' ? DEV_SERVER_URL : SERVER_URL}</p>
      )}
      {choice === 'local' && !localUrl && <p className="help warn">Use an http://localhost address.</p>}
      <p className="help">Posts to Instagram go through this server. Change it only for development.</p>
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

/** Connect an Instagram account to post to (web only for now: the Mac app can't receive the sign-in's return yet). */
function InstagramSetting() {
  const connection = useInstagram();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // When the dialog opened: enough to tell an expired connection.
  const [now] = useState(() => Date.now() / 1000);
  const expired = connection !== null && connection.expiresAt <= now;

  if (connection && !expired) {
    return (
      <div className="setting-controls">
        <div className="inline">
          <span>
            Connected as <strong>@{connection.username}</strong>
          </span>
          <button className="btn ghost" onClick={disconnectInstagram}>
            Disconnect
          </button>
        </div>
        <p className="help">
          Disconnecting forgets the account here. To remove Sequence’s access entirely, remove it in Instagram’s
          settings (Website permissions → Apps and websites).
        </p>
      </div>
    );
  }
  return (
    <div className="setting-controls">
      <button
        className="btn"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          setError(null);
          void connectInstagram().then((message) => {
            // Null: on the way to Instagram's sign-in page.
            if (message) {
              setError(message);
              setBusy(false);
            }
          });
        }}
      >
        {busy ? 'Opening Instagram…' : expired ? 'Reconnect Instagram' : 'Connect Instagram'}
      </button>
      {error && <p className="help warn">{error}</p>}
      <p className="help">
        {expired
          ? `The connection to @${connection.username} expired. Connect again to keep posting.`
          : 'Post digital sequences to Instagram. Needs a Business or Creator account.'}
      </p>
    </div>
  );
}

function GeneralSettings() {
  return (
    <>
      {platform.kind === 'browser' && (
        <section className="setting">
          <h3>Instagram</h3>
          <InstagramSetting />
        </section>
      )}
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
