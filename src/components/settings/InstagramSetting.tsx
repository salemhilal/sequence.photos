import { useState } from 'react';
import { useWindowEvent } from '../../hooks';
import { connectInstagram, disconnectInstagram, useInstagram } from '../../instagram';

/** Connect an Instagram account to post to (web only for now: the Mac app can't receive the sign-in's return yet). */
export function InstagramSetting() {
  const connection = useInstagram();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // When the dialog opened: enough to tell an expired connection.
  const [now] = useState(() => Date.now() / 1000);
  const expired = connection !== null && (connection.needsReconnect === true || connection.expiresAt <= now);
  // Back from Instagram's page (restored from the back/forward cache): ready again.
  useWindowEvent('pageshow', (e) => e.persisted && setBusy(false));

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
      {/* An error takes the description's place. */}
      {error ? (
        <p className="help warn">{error}</p>
      ) : (
        <p className="help">
          {expired
            ? connection.needsReconnect
              ? `Instagram needs you to connect @${connection.username} again.`
              : `The connection to @${connection.username} expired. Connect again to keep posting.`
            : 'Post digital sequences to Instagram. Needs a Business or Creator account.'}
        </p>
      )}
    </div>
  );
}
