import { useState } from 'react';
import { importPhotos } from '../../actions';
import { makeTestImages } from '../../testImages';
import { closeModal, ui } from '../../ui';

const MAX = 50;

/**
 * Add stand-in photos for testing: gradients in film colors, added to the desk as if
 * picked with Add photos.
 */
export function TestImagesSetting({ labelledBy }: { labelledBy: string }) {
  const [count, setCount] = useState(6);
  const working = ui.use((s) => s.importing !== null || s.busy !== null);
  const valid = Number.isInteger(count) && count >= 1 && count <= MAX;

  const add = async () => {
    if (!valid || working) return;
    // Back to the desk, where the photos land and the toolbar shows the progress.
    closeModal();
    ui.set({ busy: 'Making test images…' });
    let files: File[];
    try {
      files = await makeTestImages(count);
    } finally {
      ui.set({ busy: null });
    }
    await importPhotos(files);
  };

  return (
    <div className="setting-controls">
      <form
        className="inline"
        onSubmit={(e) => {
          e.preventDefault();
          void add();
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
