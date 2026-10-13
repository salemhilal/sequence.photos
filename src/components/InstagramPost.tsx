import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, ExternalLink, X } from 'lucide-react';
import { useWindowEvent } from '../hooks';
import { useInstagram } from '../instagram';
import {
  CancelledError,
  fits,
  hashtagCount,
  LIMITS,
  postImageLayout,
  postToInstagram,
  ratioLabel,
  targetRatio,
  type Fit,
  type PostImageLayout,
  type PostKind,
  type PostStep,
} from '../instagramPost';
import { allSpreads, sheetOf } from '../spreads';
import { useProject } from '../store';
import type { Frame, Sheet } from '../types';
import { closeModal, lockModal } from '../ui';
import { SpreadCanvas } from './SpreadCanvas';

/**
 * File → Post to Instagram: the post's settings beside a preview of how it'll look on
 * Instagram (a feed post's carousel, or stories). Posting is in instagramPost.ts.
 */

type Status =
  | { kind: 'idle' }
  | { kind: 'posting'; step: PostStep }
  | { kind: 'done'; link: string | null }
  | { kind: 'failed'; message: string };

const KINDS: { value: PostKind; label: string }[] = [
  { value: 'feed', label: 'Feed post' },
  { value: 'story', label: 'Stories' },
];

function stepLabel(step: PostStep): string {
  switch (step.step) {
    case 'preparing':
      return `Preparing frame ${step.done + 1} of ${step.total}…`;
    case 'uploading':
      return `Uploading frame ${step.done + 1} of ${step.total}…`;
    case 'processing':
      return 'Instagram is processing the post…';
    case 'publishing':
      return step.total > 1 ? `Publishing story ${step.done + 1} of ${step.total}…` : 'Publishing…';
  }
}

export function InstagramPost() {
  const { project } = useProject();
  const connection = useInstagram();
  const sheet = sheetOf(project);
  const all = allSpreads(project).filter((s): s is Frame => s.kind === 'frame');
  const size = { w: sheet.pageW, h: sheet.pageH };

  const [kind, setKind] = useState<PostKind>('feed');
  const [fit, setFit] = useState<Fit>('crop');
  const [caption, setCaption] = useState('');
  const [skipEmpty, setSkipEmpty] = useState(true);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const abort = useRef<AbortController | null>(null);

  const emptyCount = all.filter((f) => f.items.length === 0).length;
  const chosen = skipEmpty ? all.filter((f) => f.items.length > 0) : all;
  // Instagram's API takes 10 at a time, for a carousel or a run of stories alike.
  const frames = chosen.slice(0, LIMITS.maxItems);
  const layout = postImageLayout(size, kind, fit);
  const tags = hashtagCount(caption);
  const posting = status.kind === 'posting';
  const ratio = targetRatio(size, kind);
  const tall = size.w / size.h < ratio;

  // Posting can't be hidden midway: nothing else can close or replace this pane meanwhile.
  // Should it go anyway (the app closing), the post is cancelled.
  useEffect(() => {
    lockModal(posting);
    return () => lockModal(false);
  }, [posting]);
  useEffect(() => () => abort.current?.abort(), []);
  // Cancelling stops before anything is published.
  const cancellable = posting && status.step.step !== 'publishing';

  const problem =
    frames.length === 0
      ? 'There are no frames with photos to post.'
      : kind === 'feed' && caption.length > LIMITS.captionLength
        ? `Captions can be up to ${LIMITS.captionLength.toLocaleString()} characters.`
        : kind === 'feed' && tags > LIMITS.hashtags
          ? `Instagram allows up to ${LIMITS.hashtags} hashtags.`
          : null;

  const close = () => {
    if (!posting) closeModal();
  };
  useWindowEvent('keydown', (e) => {
    if (e.key === 'Escape' && !(e.target instanceof HTMLTextAreaElement)) close();
  });

  const post = () => {
    const controller = new AbortController();
    abort.current = controller;
    setStatus({ kind: 'posting', step: { step: 'preparing', done: 0, total: frames.length } });
    postToInstagram({
      frames,
      size,
      kind,
      fit,
      caption: caption.trim(),
      signal: controller.signal,
      onStep: (step) => setStatus({ kind: 'posting', step }),
    }).then(
      (link) => setStatus({ kind: 'done', link }),
      (error: unknown) =>
        setStatus({
          kind: 'failed',
          message:
            error instanceof CancelledError
              ? 'Cancelled. Nothing was posted.'
              : error instanceof Error && error.message
                ? error.message
                : 'Couldn’t post to Instagram.',
        }),
    );
  };

  return (
    <div className="modal-backdrop" data-modal onPointerDown={(e) => e.target === e.currentTarget && close()}>
      <div className="modal editor instagram-post" data-modal>
        <header className="modal-head">
          <div className="modal-title">
            <span className="folio">Post to Instagram</span>
            {connection && <span className="muted data">@{connection.username}</span>}
          </div>
          <span className="spacer" />
          <button className="btn ghost icon" aria-label="Close" onClick={close} disabled={posting}>
            <X />
          </button>
        </header>
        <div className="editor-body">
          <PostPreview
            frames={frames}
            sheet={sheet}
            layout={layout}
            kind={kind}
            username={connection?.username ?? ''}
            caption={caption}
          />
          <aside className="inspector instagram-panel">
            <section>
              <h3>Post as</h3>
              <div className="segmented halves" role="radiogroup" aria-label="Post as">
                {KINDS.map((k) => (
                  <label key={k.value} className={kind === k.value ? 'on' : ''}>
                    <input
                      type="radio"
                      name="post-kind"
                      checked={kind === k.value}
                      disabled={posting}
                      onChange={() => setKind(k.value)}
                    />
                    {k.label}
                  </label>
                ))}
              </div>
              <p className="help">
                {kind === 'feed'
                  ? frames.length > 1
                    ? `A carousel of ${frames.length} frames.`
                    : 'A single image.'
                  : `${frames.length} ${frames.length === 1 ? 'story' : 'stories'}, one per frame.`}
              </p>
            </section>

            {!fits(size, kind) && (
              <section>
                <h3>Size</h3>
                <p className="help">
                  {kind === 'feed'
                    ? `These frames are ${ratioLabel(size.w / size.h)}. Instagram’s feed takes 4:5 (tall) to 1.91:1 (wide).`
                    : `These frames are too tall for stories.`}
                </p>
                <div className="segmented halves" role="radiogroup" aria-label="Fit">
                  {(['crop', 'expand'] as const).map((f) => (
                    <label key={f} className={fit === f ? 'on' : ''}>
                      <input
                        type="radio"
                        name="post-fit"
                        checked={fit === f}
                        disabled={posting}
                        onChange={() => setFit(f)}
                      />
                      {f === 'crop' ? 'Crop' : 'Expand'} to {ratioLabel(ratio)}
                    </label>
                  ))}
                </div>
                <p className="help">
                  {fit === 'crop'
                    ? `Trims the ${tall ? 'top and bottom' : 'sides'} of each frame.`
                    : `Adds white margins at the ${tall ? 'sides' : 'top and bottom'}.`}
                </p>
              </section>
            )}

            {(emptyCount > 0 || chosen.length > LIMITS.maxItems) && (
              <section>
                <h3>Frames</h3>
                {emptyCount > 0 && (
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={skipEmpty}
                      disabled={posting}
                      onChange={(e) => setSkipEmpty(e.target.checked)}
                    />
                    Skip {emptyCount} empty {emptyCount === 1 ? 'frame' : 'frames'}
                  </label>
                )}
                {chosen.length > LIMITS.maxItems && (
                  <p className="help warn">
                    Instagram takes up to {LIMITS.maxItems} {kind === 'feed' ? 'frames per post' : 'stories at a time'}{' '}
                    from apps, so only the first {LIMITS.maxItems} of {chosen.length} will be posted.
                  </p>
                )}
              </section>
            )}

            {kind === 'feed' ? (
              <section>
                <h3>Caption</h3>
                <textarea
                  className="text-area"
                  value={caption}
                  rows={6}
                  placeholder="Write a caption…"
                  disabled={posting}
                  onChange={(e) => setCaption(e.target.value)}
                />
                <p
                  className={`help data${caption.length > LIMITS.captionLength || tags > LIMITS.hashtags ? ' warn' : ''}`}
                >
                  {caption.length.toLocaleString()} / {LIMITS.captionLength.toLocaleString()}
                  {tags > 0 && ` · ${tags} / ${LIMITS.hashtags} hashtags`}
                </p>
              </section>
            ) : (
              <section>
                <p className="help">Stories don’t have captions.</p>
              </section>
            )}

            <section className="instagram-actions">
              {status.kind === 'done' ? (
                <>
                  <p className="instagram-done">Posted to Instagram.</p>
                  {status.link && (
                    <a className="btn" href={status.link} target="_blank" rel="noopener noreferrer">
                      <ExternalLink />
                      View on Instagram
                    </a>
                  )}
                  <button className="btn ghost" onClick={closeModal}>
                    Done
                  </button>
                </>
              ) : (
                <>
                  <button className="btn primary" disabled={posting || problem !== null} onClick={post}>
                    {posting ? 'Posting…' : 'Post to Instagram'}
                  </button>
                  {cancellable && (
                    <button className="btn ghost" onClick={() => abort.current?.abort()}>
                      Cancel
                    </button>
                  )}
                  {posting && <p className="help">{stepLabel(status.step)}</p>}
                  {status.kind === 'failed' && <p className="help warn">{status.message}</p>}
                  {problem && !posting && <p className="help warn">{problem}</p>}
                </>
              )}
            </section>
          </aside>
        </div>
      </div>
    </div>
  );
}

/** A caption with its hashtags and mentions in Instagram's link color. */
function Caption({ text }: { text: string }) {
  const parts = text.split(/((?:^|(?<=\s))[#@][\p{L}\p{N}_.]+)/u);
  return parts.map((part, i) =>
    i % 2 === 1 ? (
      <span key={i} className="ig-tag">
        {part}
      </span>
    ) : (
      part
    ),
  );
}

interface PreviewProps {
  frames: readonly Frame[];
  sheet: Sheet;
  layout: PostImageLayout;
  kind: PostKind;
  username: string;
  caption: string;
}

/** How the post will look on Instagram: a feed post's carousel, or stories. */
function PostPreview({ frames, sheet, layout, kind, username, caption }: PreviewProps) {
  const stageRef = useRef<HTMLDivElement>(null);
  const [stage, setStage] = useState({ w: 700, h: 600 });
  const [index, setIndex] = useState(0);
  const at = Math.min(index, Math.max(0, frames.length - 1));

  useLayoutEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      if (entry) setStage({ w: entry.contentRect.width, h: entry.contentRect.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useWindowEvent('keydown', (e) => {
    if (e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement) return;
    if (e.key === 'ArrowLeft') setIndex(Math.max(0, at - 1));
    if (e.key === 'ArrowRight') setIndex(Math.min(frames.length - 1, at + 1));
  });

  // The media box: the image's shape in the feed; a phone screen (9:16) for stories.
  const aspect = kind === 'story' ? 9 / 16 : layout.width / layout.height;
  const maxW = kind === 'story' ? 340 : 440;
  const reserve = kind === 'story' ? 40 : 190;
  const w = Math.max(160, Math.min(maxW, stage.w - 80, (stage.h - reserve) * aspect));
  const h = w / aspect;
  // Stories: the image fits inside the screen, as Instagram shows it.
  const imageW = kind === 'story' ? Math.min(w, h * (layout.width / layout.height)) : w;
  const imageH = imageW * (layout.height / layout.width);

  const slide = (frame: Frame) => {
    const k = imageW / layout.width;
    const s = k * (layout.target.w / layout.source.w);
    return (
      <div className="ig-image" style={{ width: imageW, height: imageH }}>
        <div
          style={{
            position: 'absolute',
            left: layout.target.x * k - layout.source.x * s,
            top: layout.target.y * k - layout.source.y * s,
          }}
        >
          <SpreadCanvas spread={frame} sheet={sheet} scale={s} clip />
        </div>
      </div>
    );
  };

  const nav = frames.length > 1 && (
    <>
      {at > 0 && (
        <button className="ig-arrow prev" aria-label="Previous frame" onClick={() => setIndex(at - 1)}>
          <ChevronLeft />
        </button>
      )}
      {at < frames.length - 1 && (
        <button className="ig-arrow next" aria-label="Next frame" onClick={() => setIndex(at + 1)}>
          <ChevronRight />
        </button>
      )}
    </>
  );

  const head = (
    <header className="ig-head">
      <span className="ig-avatar" aria-hidden="true">
        {username.charAt(0).toUpperCase()}
      </span>
      <span className="ig-user">{username}</span>
    </header>
  );

  return (
    <div className="editor-stage instagram-stage" ref={stageRef}>
      {frames.length === 0 ? (
        <p className="muted">Nothing to preview.</p>
      ) : kind === 'story' ? (
        <div className="ig-story" style={{ width: w, height: h }}>
          <div className="ig-track" style={{ transform: `translateX(${-at * w}px)` }}>
            {frames.map((frame) => (
              <div key={frame.id} className="ig-slide" style={{ width: w, height: h }}>
                {slide(frame)}
              </div>
            ))}
          </div>
          <div className="ig-progress">
            {frames.map((frame, i) => (
              <span key={frame.id} className={i <= at ? 'seen' : ''} />
            ))}
          </div>
          {head}
          {nav}
        </div>
      ) : (
        <div className="ig-card" style={{ width: w }}>
          {head}
          <div className="ig-media" style={{ width: w, height: h }}>
            <div className="ig-track" style={{ transform: `translateX(${-at * w}px)` }}>
              {frames.map((frame) => (
                <div key={frame.id} className="ig-slide" style={{ width: w, height: h }}>
                  {slide(frame)}
                </div>
              ))}
            </div>
            {frames.length > 1 && (
              <span className="ig-count">
                {at + 1}/{frames.length}
              </span>
            )}
            {nav}
          </div>
          {frames.length > 1 && (
            <div className="ig-dots">
              {frames.map((frame, i) => (
                <span key={frame.id} className={i === at ? 'on' : ''} />
              ))}
            </div>
          )}
          <p className="ig-caption">
            <strong>{username}</strong> <Caption text={caption} />
          </p>
        </div>
      )}
    </div>
  );
}
