import { useMemo } from 'react';
import { sheetExtent } from '../geometry';
import { useElementSize, usePager } from '../hooks';
import { draftOf, previewPageSetup, sameDraft, type PageDraft } from '../pageSetup';
import { allSpreads, sheetOf } from '../spreads';
import { useProject } from '../store';
import { TERMS } from '../units';
import { placedSoft, resolutionNote, softPhotos, softSentence } from '../resolution';
import { Pager } from './Pager';
import { PhotoImg } from './PhotoImg';
import { SoftBadge } from './SoftBadge';
import { SpreadCanvas } from './SpreadCanvas';

/** Room around the spread, as a share of a page's width. */
const PAD_SHARE = 0.05;

interface Props {
  draft: PageDraft;
}

/**
 * The Page tab's live preview: the project's real spreads or frames as they'd be after
 * Apply (as they are, with no changes waiting) (re-paginated, converted, and moved with the guides), read-only. ‹ › and the arrow
 * keys go through them. It's the same project Apply makes, so what's shown is what you get,
 * including which photos would have less detail than the page asks for.
 */
export function PagePreview({ draft }: Props) {
  const { project } = useProject();
  // Memoized, so pages that become frames keep their new ids between renders.
  const preview = useMemo(() => previewPageSetup(draft), [project, draft]); // eslint-disable-line react-hooks/exhaustive-deps
  const sheet = sheetOf(preview);
  const spreads = allSpreads(preview);
  const { at, go } = usePager(spreads.length);
  const spread = spreads[at];
  const [stageRef, stage] = useElementSize<HTMLDivElement>({ w: 800, h: 500 });

  const pad = sheet.pageW * PAD_SHARE;
  const across = sheetExtent(sheet).width;
  // Room below for the controls.
  const scale = Math.max(0, Math.min(stage.w / (across + 2 * pad), (stage.h - 56) / (sheet.pageH + 2 * pad)));
  const terms = TERMS[sheet.arrangement];
  const soft = softPhotos(preview).length;
  // With no changes waiting, this is the project as it is: photos are soft, not would be.
  const changed = !sameDraft(draft, draftOf(project));

  return (
    <div className="editor-stage page-preview" ref={stageRef}>
      {spread && (
        <div className="page-preview-canvas">
          <SpreadCanvas
            spread={spread}
            sheet={sheet}
            scale={scale}
            pad={pad}
            guides
            renderItem={(p, style) => {
              const photo = preview.photos[p.photoId];
              return (
                <div key={p.photoId} className="item" style={style}>
                  <PhotoImg id={p.photoId} />
                  {photo && placedSoft(photo, p, sheet) && (
                    <SoftBadge note={resolutionNote(photo, p, sheet)?.text ?? ''} />
                  )}
                </div>
              );
            }}
          />
        </div>
      )}
      <Pager at={at} count={spreads.length} go={go} noun={terms.spread} />
      {soft > 0 && <p className="page-preview-footer warn">{softSentence(soft, sheet, changed)}</p>}
    </div>
  );
}
