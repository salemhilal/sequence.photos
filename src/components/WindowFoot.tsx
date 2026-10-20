import { useNoticeTimeout } from '../hooks';
import { ui } from '../ui';

/**
 * The foot of the Mac app's Settings window, as the main window's status bar: the hint for
 * what's under the pointer, else a word from finishing an Instagram sign-in started here.
 */
export function WindowFoot() {
  const text = ui.use((s) => s.hint ?? s.notice);
  useNoticeTimeout();
  return (
    <p className="window-foot" role="status">
      {text}
    </p>
  );
}
