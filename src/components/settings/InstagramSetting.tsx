import { useState } from 'react';
import { disconnectInstagram, useConnectInstagram, useInstagram } from '../../instagram';

/** Connect an Instagram account to post to: on the website, or from the Mac app through the browser. */
export function InstagramSetting() {
  const connection = useInstagram();
  const { connect, busy, message } = useConnectInstagram();
  // When the dialog opened: enough to tell an expired connection.
  const [now] = useState(() => Date.now() / 1000);
  const expired = connection !== null && (connection.needsReconnect === true || connection.expiresAt <= now);

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
      <button className="btn" disabled={busy} onClick={connect}>
        {busy ? 'Opening Instagram…' : expired ? 'Reconnect Instagram' : 'Connect Instagram'}
      </button>
      {/* What the button has to say takes the description's place. */}
      {message ? (
        <p className={`help${message.warn ? ' warn' : ''}`}>{message.text}</p>
      ) : (
        <p className="help">
          {expired
            ? connection.needsReconnect
              ? `Instagram needs you to connect @${connection.username} again.`
              : `The connection to @${connection.username} expired. Connect again to keep posting.`
            : 'Post frames to Instagram from Export. Needs a Business or Creator account.'}
        </p>
      )}
    </div>
  );
}
