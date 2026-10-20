import { useState } from 'react';
import { platform } from '#platform';
import {
  defaultServerUrl,
  DEV_SERVER_URL,
  normalizeServerUrl,
  SERVER_URL,
  serverUrl,
  serverUrlPref,
} from '../../server';
import { Segmented } from '../Segmented';

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
export function ServerSetting({ labelledBy }: { labelledBy: string }) {
  const [server, setServer] = useState(serverUrl);
  const choice = choiceOf(server);
  const [local, setLocal] = useState(choice === 'local' ? server : LOCAL_DEFAULT);
  const localUrl = normalizeServerUrl(local);
  // The default (Sequence's, or the development server's when running locally) is
  // stored as no choice, so it follows the default if that changes.
  const save = (value: string) => {
    serverUrlPref.save(value === defaultServerUrl() ? '' : value);
    setServer(value);
    platform.prefsChanged();
  };
  const pick = (c: ServerChoice) => {
    if (c === 'default') save(SERVER_URL);
    else if (c === 'dev') save(DEV_SERVER_URL);
    else save(localUrl ?? LOCAL_DEFAULT);
  };

  return (
    <div className="setting-controls">
      <Segmented labelledBy={labelledBy} options={SERVER_CHOICES} value={choice} onChange={pick} />
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
      <p className="help">
        Posts to Instagram go through this server. Change it only for development; it applies the next time you connect
        Instagram.
      </p>
    </div>
  );
}
