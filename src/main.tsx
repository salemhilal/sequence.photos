import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/inter-tight/latin-400.css';
import '@fontsource/inter-tight/latin-500.css';
import '@fontsource/ibm-plex-mono/latin-400.css';
import '@fontsource/ibm-plex-mono/latin-500.css';
import './styles.css';
import App from './App.tsx';
import { SettingsWindow } from './components/SettingsDialog';
import { applyDeskColor } from './deskColor';
import { finishSignIn, hasPendingSignIn, reloadInstagram, takeReturnToExport } from './instagram';
import { addTestImages } from './testImages';
import { onSettingSaved, reloadSettings, ui } from './ui';
import { isMainWindow, isSettingsWindow } from './windowKind';
import { platform } from '#platform';
import { installHints } from './hints';

applyDeskColor(ui.get().deskColor);
platform.start();
installHints();
// Settings saved here reach the app's other windows and tabs, and theirs reach this one.
onSettingSaved(() => platform.prefsChanged());
platform.onPrefsChanged(() => {
  reloadSettings();
  reloadInstagram();
});
// The Settings window asks the main window for what needs the project.
if (isMainWindow)
  platform.onMainRequest?.((request) => {
    if (request.kind === 'addTestImages') void addTestImages(request.count);
  });
// Coming back from connecting Instagram: finish it, say how it went, and go back to Export
// if that's where it started.
platform.onSignInReturn((fragment) => {
  void finishSignIn(fragment).then((notice) => {
    if (notice) ui.set({ notice });
    if (takeReturnToExport()) ui.set({ page: 'export', exportTo: 'instagram' });
  });
}, hasPendingSignIn);

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root');

createRoot(root).render(<StrictMode>{isSettingsWindow ? <SettingsWindow /> : <App />}</StrictMode>);
