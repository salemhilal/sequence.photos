import { STORAGE_REFUSED } from '../actions';
import { importFiles } from '../images';
import { projectStore } from '../store';
import { ui } from '../ui';
import { addPhotos, type AddTo } from './frameActions';

/**
 * Store photos chosen from the library, then add them to the open sequence where asked, as
 * one undo step. Progress and problems show as the web app's do (ui.importing, ui.notice).
 */
export async function addPhotoFiles(files: readonly File[], to: AddTo): Promise<void> {
  if (ui.get().importing || !files.length) return;
  try {
    const { photos, failed, storageRefused } = await importFiles([...files], (done, total) =>
      ui.set({ importing: { done, total } }),
    );
    if (photos.length) projectStore.apply((d) => addPhotos(d, photos, to));
    if (storageRefused) ui.set({ notice: STORAGE_REFUSED });
    else if (failed.length)
      ui.set({ notice: `Couldn’t read ${failed.length} ${failed.length === 1 ? 'photo' : 'photos'}.` });
  } finally {
    ui.set({ importing: null });
  }
}

/** Ask for photos from the library (iOS's photo picker); resolves to those chosen, if any. */
export function pickPhotos(): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.multiple = true;
    input.addEventListener('change', () => resolve([...(input.files ?? [])]));
    input.addEventListener('cancel', () => resolve([]));
    input.click();
  });
}
