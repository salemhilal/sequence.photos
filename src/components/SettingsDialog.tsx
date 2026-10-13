import { useState } from 'react';
import { platform } from '#platform';
import { Dialog } from './Dialog';
import type { ThemePref } from '../theme';
import { setTheme, closeModal, ui } from '../ui';
import { DeskColorPicker } from './DeskColorPicker';
import { InstagramSetting } from './settings/InstagramSetting';
import { ServerSetting } from './settings/ServerSetting';
import { StorageRow } from './settings/StorageRow';

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

type Tab = 'general' | 'advanced';
const TABS: { value: Tab; label: string }[] = [
  { value: 'general', label: 'General' },
  { value: 'advanced', label: 'Advanced' },
];

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
