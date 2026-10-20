import { ui } from '../ui';

/**
 * The foot of the Mac app's Settings and Layout windows, as the main window's status bar:
 * the hint for what's under the pointer, else what the view says (Layout's page size), else
 * a word from finishing an Instagram sign-in started here.
 */
export function WindowFoot() {
  const text = ui.use((s) => s.hint ?? s.pageStatus ?? s.notice);
  return (
    <p className="window-foot" role="status">
      {text}
    </p>
  );
}
