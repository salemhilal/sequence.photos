import { useSyncExternalStore } from 'react';
import { TriangleAlert } from 'lucide-react';
import { cropStyle, isWhole } from '../crop';
import { markMissing, usePhotoMissing, usePhotoUrl } from '../images';
import { toPhotoId } from '../ids';
import { projectStore } from '../store';
import type { Crop } from '../types';

const MISSING_TIP = "This photo's image could no longer be found.";

/** A photo's crop, re-rendering only when it changes. */
function usePhotoCrop(id: string): Crop | undefined {
  return useSyncExternalStore(projectStore.subscribe, () => projectStore.project.photos[toPhotoId(id)]?.crop);
}

/**
 * A photo filling its frame, showing its crop. `crop` shows another (a crop being made);
 * null, the whole photo.
 */
export function PhotoImg({ id, crop }: { id: string; crop?: Crop | null }) {
  const url = usePhotoUrl(id);
  const missing = usePhotoMissing(id);
  const own = usePhotoCrop(id);
  const shown = crop === undefined ? own : (crop ?? undefined);
  if (missing) {
    return (
      <div className="photo photo-missing">
        <span className="photo-missing-icon" data-tip={MISSING_TIP} aria-label={MISSING_TIP} role="img">
          <TriangleAlert />
        </span>
      </div>
    );
  }
  if (!url) return <div className="photo photo-loading" />;
  const img = (
    <img
      className="photo"
      src={url}
      alt=""
      draggable={false}
      decoding="async"
      style={cropStyle(shown)}
      onError={() => markMissing(id)}
    />
  );
  return isWhole(shown) ? img : <div className="photo-crop">{img}</div>;
}
