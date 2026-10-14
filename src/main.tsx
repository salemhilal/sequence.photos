import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/inter-tight/latin-400.css';
import '@fontsource/inter-tight/latin-500.css';
import '@fontsource/ibm-plex-mono/latin-400.css';
import '@fontsource/ibm-plex-mono/latin-500.css';
import './styles.css';
import App from './App.tsx';
import { applyDeskColor } from './deskColor';
import { finishSignIn } from './instagram';
import { ui } from './ui';
import { platform } from '#platform';

applyDeskColor(ui.get().deskColor);
platform.start();
// Coming back from connecting Instagram (Settings): finish it, and say how it went.
// (Web only: the Mac app doesn't connect Instagram.)
if (platform.kind === 'browser') void finishSignIn().then((notice) => notice && ui.set({ notice }));

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
