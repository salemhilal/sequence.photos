import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/inter-tight/latin-400.css';
import '@fontsource/inter-tight/latin-500.css';
import '@fontsource/ibm-plex-mono/latin-400.css';
import '@fontsource/ibm-plex-mono/latin-500.css';
import './styles.css';
import App from './App.tsx';
import { applyDeskColor } from './deskColor';
import { finishSignIn, parseSignInReturn, takeReturnToExport } from './instagram';
import { ui } from './ui';
import { platform } from '#platform';
import { installTooltips } from './tooltip';

applyDeskColor(ui.get().deskColor);
platform.start();
installTooltips();
// Coming back from connecting Instagram: finish it, say how it went, and go back to Export
// if that's where it started. (Web only: the Mac app doesn't connect Instagram.)
if (platform.kind === 'browser') {
  const returning = parseSignInReturn(location.hash) !== null;
  void finishSignIn().then((notice) => {
    if (notice) ui.set({ notice });
    if (returning && takeReturnToExport()) ui.set({ modal: 'export', exportTo: 'instagram' });
  });
}

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
