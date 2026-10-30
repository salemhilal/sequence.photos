import { useEffect } from 'react';
import { ui } from '../ui';
import { Editor } from './Editor';
import { ExportSheet } from './ExportSheet';
import { Frames } from './Frames';
import { Preview } from './Preview';
import { Sequences } from './Sequences';
import { phone } from './nav';

/** The phone UI: Sequences, a sequence's frames, or a frame's editor, with what's over them. */
export function PhoneApp() {
  const screen = phone.use((s) => s.screen);
  const sheet = phone.use((s) => s.sheet);
  const importing = ui.use((s) => s.importing);
  const busy = ui.use((s) => s.busy);
  const notice = ui.use((s) => s.notice);

  // A notice goes after a while on its own.
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => ui.set({ notice: null }), 6000);
    return () => clearTimeout(t);
  }, [notice]);

  return (
    <div className="screen">
      {screen === 'library' && <Sequences />}
      {screen === 'frames' && <Frames />}
      {screen === 'editor' && <Editor />}
      {screen === 'preview' && <Preview />}
      {sheet === 'export' && screen !== 'library' && <ExportSheet />}
      {notice && (
        <div className="toast" role="status">
          {notice}
          <button className="btn" onClick={() => ui.set({ notice: null })}>
            OK
          </button>
        </div>
      )}
      {(importing || busy) && (
        <div className="progress" role="status">
          <div>{importing ? `Adding photos… ${importing.done} of ${importing.total}` : busy}</div>
        </div>
      )}
    </div>
  );
}
