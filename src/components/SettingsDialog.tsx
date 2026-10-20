import { useId, useState } from 'react';
import { platform } from '#platform';
import { Dialog } from './Dialog';
import type { ThemePref } from '../theme';
import { closeModal, setShortcutBadges, setStatusBar, setTheme, ui } from '../ui';
import { isMac } from '../input';
import { DeskColorPicker } from './DeskColorPicker';
import { Segmented } from './Segmented';
import { Tabs } from './Tabs';
import { WindowFoot } from './WindowFoot';
import { InstagramSetting } from './settings/InstagramSetting';
import { ServerSetting } from './settings/ServerSetting';
import { TestImagesSetting } from './settings/TestImagesSetting';
import { StorageRow } from './settings/StorageRow';

const THEMES: { value: ThemePref; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

function ThemePicker({ labelledBy }: { labelledBy: string }) {
  const theme = ui.use((s) => s.theme);
  return <Segmented labelledBy={labelledBy} options={THEMES} value={theme} onChange={setTheme} />;
}

type Tab = 'general' | 'accounts' | 'advanced';
const TABS: { value: Tab; label: string }[] = [
  { value: 'general', label: 'General' },
  // Instagram, and on the website, the browser's storage.
  { value: 'accounts', label: platform.kind === 'browser' ? 'Instagram & storage' : 'Instagram' },
  { value: 'advanced', label: 'Advanced' },
];

/** The app's own preferences, as a dialog (the website); the project's page setup is in Layout. */
export function SettingsDialog() {
  return (
    <Dialog title="Settings" onClose={closeModal} className="settings">
      <SettingsPanel />
    </Dialog>
  );
}

/** The app's own preferences in a window of their own (the Mac app's Settings window). */
export function SettingsWindow() {
  return (
    <div className="settings-window">
      <SettingsPanel />
      <WindowFoot />
    </div>
  );
}

/** Settings' tabs and what's on each. */
function SettingsPanel() {
  const [tab, setTab] = useState<Tab>('general');
  return (
    <>
      <Tabs id="settings" label="Settings" options={TABS} value={tab} onChange={setTab} />
      <div className="settings-body" id="settings-panel" role="tabpanel" aria-labelledby={`settings-tab-${tab}`}>
        {tab === 'general' ? <GeneralSettings /> : tab === 'accounts' ? <AccountSettings /> : <AdvancedSettings />}
      </div>
    </>
  );
}

function AdvancedSettings() {
  const heading = useId();
  const testImages = useId();
  return (
    <>
      <section className="setting">
        <h3 id={heading}>Server</h3>
        <ServerSetting labelledBy={heading} />
      </section>
      <section className="setting">
        <h3 id={testImages}>Test images</h3>
        <TestImagesSetting labelledBy={testImages} />
      </section>
    </>
  );
}

/** How the app looks: its theme, the desk's color, and the status bar and shortcut badges. */
function GeneralSettings() {
  const theme = useId();
  const statusBar = ui.use((s) => s.statusBar);
  const badges = ui.use((s) => s.shortcutBadges);
  return (
    <>
      <section className="setting">
        <h3 id={theme}>Theme</h3>
        <div className="setting-controls">
          <ThemePicker labelledBy={theme} />
        </div>
      </section>

      <section className="setting">
        <h3>Desk color</h3>
        <div className="setting-controls">
          <DeskColorPicker />
          <p className="help">Also in the desk's right-click menu.</p>
        </div>
      </section>

      <section className="setting">
        <h3>Status bar</h3>
        <div className="setting-controls">
          <label className="check">
            <input type="checkbox" checked={statusBar} onChange={(e) => setStatusBar(e.target.checked)} />
            Show the status bar
          </label>
          <p className="help">Along the window's foot: hints, what's selected, progress, and zoom.</p>
        </div>
      </section>

      <section className="setting">
        <h3>Shortcuts</h3>
        <div className="setting-controls">
          <label className="check">
            <input type="checkbox" checked={badges} onChange={(e) => setShortcutBadges(e.target.checked)} />
            Show shortcuts while {isMac ? '⌘' : 'Ctrl'} is held
          </label>
        </div>
      </section>
    </>
  );
}

/** Instagram, and on the website, how the browser keeps the project. */
function AccountSettings() {
  return (
    <>
      <section className="setting">
        <h3>Instagram</h3>
        <InstagramSetting />
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
