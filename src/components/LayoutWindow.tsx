import { ConfirmDialog } from './ConfirmDialog';
import { LayoutEditor } from './LayoutEditor';
import { WindowFoot } from './WindowFoot';

/** The Mac app's Layout window: the Layout view, filling it, over the main window's project. */
export function LayoutWindow() {
  return (
    <div className="layout-window">
      <LayoutEditor inWindow />
      <WindowFoot />
      <ConfirmDialog />
    </div>
  );
}
