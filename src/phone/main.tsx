import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/inter-tight/latin-400.css';
import '@fontsource/inter-tight/latin-500.css';
import '@fontsource/inter-tight/latin-600.css';
import '@fontsource/inter-tight/latin-700.css';
import '@fontsource/ibm-plex-mono/latin-400.css';
import '@fontsource/ibm-plex-mono/latin-500.css';
import './phone.css';
import { setDatabaseName } from '../db';
import { finishSignIn, hasPendingSignIn } from '../instagram';
import { ui } from '../ui';
import { platform } from '#platform';
import { PhoneApp } from './PhoneApp';
import { phone } from './nav';

// The phone's projects and photos, apart from the web app's (in development they share an
// address, and the web app clears out photos its project doesn't use).
setDatabaseName('sequence-phone');
platform.start();
// Back from connecting Instagram (in Safari): finish it, and say how it went.
platform.onSignInReturn((fragment) => {
  void finishSignIn(fragment).then((notice) => {
    if (notice) ui.set({ notice });
    if (phone.get().screen !== 'library') phone.set({ sheet: 'export' });
  });
}, hasPendingSignIn);

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root');

createRoot(root).render(
  <StrictMode>
    <PhoneApp />
  </StrictMode>,
);
