import { useState } from 'react';
import { platform } from '#platform';
import { addTestImages } from '../../testImages';
import { closeModal, ui } from '../../ui';
import { isSettingsWindow } from '../../windowKind';

const MAX = 50;

/**
 * Add stand-in photos for testing: gradients in film colors, added to the desk as if
 * picked with Add photos.
 */
export function TestImagesSetting({ labelledBy }: { labelledBy: string }) {
  const [count, setCount] = useState(6);
  const working = ui.use((s) => s.importing !== null || s.busy !== null);
  const valid = Number.isInteger(count) && count >= 1 && count <= MAX;

  const add = () => {
    if (!valid || working) return;
    // The Settings window asks the main window, which holds the project.
    if (isSettingsWindow) return platform.sendToMain?.({ kind: 'addTestImages', count });
    // Back to the desk, where the photos land and the status bar shows the progress.
    closeModal();
    void addTestImages(count);
  };

  return (
    <div className="setting-controls">
      <form
        className="inline"
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
      >
        <input
          className="text-field test-images-count"
          type="number"
          min={1}
          max={MAX}
          step={1}
          aria-labelledby={labelledBy}
          value={Number.isNaN(count) ? '' : count}
          onChange={(e) => setCount(e.target.valueAsNumber)}
        />
        <button className="btn" type="submit" disabled={!valid || working}>
          Add test images
        </button>
      </form>
      <p className={`help${valid ? '' : ' warn'}`}>
        {valid
          ? 'Gradients in film colors, 3000 × 2000 px or so, added to the desk like any photos.'
          : `Choose from 1 to ${MAX}.`}
      </p>
    </div>
  );
}
