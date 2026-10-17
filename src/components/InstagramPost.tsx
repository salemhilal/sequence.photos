import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight, ExternalLink } from 'lucide-react';
import { useWindowEvent } from '../hooks';
import { useInstagram } from '../instagram';
import {
  fits,
  hashtagCount,
  LIMITS,
  postImageLayout,
  ratioLabel,
  slideSize,
  targetRatio,
  type Fit,
  type PostImageLayout,
  type PostKind,
  type Slide,
} from '../instagramImage';
import { CancelledError, postToInstagram, type PostStep } from '../instagramPost';
import { firstNonEmpty, outputPages, slideKey } from '../renderPlan';
import { sheetOf } from '../spreads';
import { useProject } from '../store';
import type { Sheet } from '../types';
import { closeModal, lockModal } from '../ui';
import { Segmented } from './Segmented';
import { PageCanvas } from './SpreadCanvas';

/**
 * The Export view's Instagram destination: a preview of how the post will look on
 * Instagram (a feed post's carousel, or stories) beside its settings and the choice of
 * which pages or frames to post. Posting is in instagramPost.ts; the images, in
 * instagramImage.ts.
 */

/** Thumbnails' height in the slide picker. */
const THUMB_H = 64;

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
      return `Preparing slide ${step.done + 1} of ${step.total}…`;
    case 'uploading':
      return `Uploading slide ${step.done + 1} of ${step.total}…`;
    case 'processing':
      return 'Instagram is processing the post…';
    case 'publishing':
      return step.total > 1 ? `Publishing story ${step.done + 1} of ${step.total}…` : 'Publishing…';
  }
}

interface Props {
  /** What the panel starts with (the destination picker), told whether a post is under way. */
  head: (posting: boolean) => ReactNode;
}

export function InstagramPost({ head }: Props) {
  const { project } = useProject();
  const connection = useInstagram();
  const sheet = sheetOf(project);
  // Every page or frame, in order: spreads are torn into their pages.
  const all = outputPages(project, 'page');
  const size = slideSize(sheet);
  const torn = project.layout.kind === 'spreads';

  const [kind, setKind] = useState<PostKind>('feed');
  const [fit, setFit] = useState<Fit>('crop');
  const [caption, setCaption] = useState('');
  // Instagram's API takes 10 at a time, for a carousel or a run of stories alike: the
  // first 10 with photos to start with.
  const [chosen, setChosen] = useState(() => firstNonEmpty(all, sheet, LIMITS.maxItems));
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const abort = useRef<AbortController | null>(null);

  // In the document's order; any that went away (an undo meanwhile) are left out.
  const slides = all.filter((p) => chosen.has(slideKey(p)));
  const full = slides.length >= LIMITS.maxItems;
  const toggle = (key: string, on: boolean) => {
    const next = new Set([...chosen].filter((k) => all.some((p) => slideKey(p) === k)));
    if (on && next.size < LIMITS.maxItems) next.add(key);
    else next.delete(key);
    setChosen(next);
  };
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
    slides.length === 0
      ? 'Choose at least one slide to post.'
      : kind === 'feed' && caption.length > LIMITS.captionLength
        ? `Captions can be up to ${LIMITS.captionLength.toLocaleString()} characters.`
        : kind === 'feed' && tags > LIMITS.hashtags
          ? `Instagram allows up to ${LIMITS.hashtags} hashtags.`
          : null;

  const post = () => {
    const controller = new AbortController();
    abort.current = controller;
    setStatus({ kind: 'posting', step: { step: 'preparing', done: 0, total: slides.length } });
    postToInstagram({
      slides,
      sheet,
      photos: project.photos,
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
    <>
      <PostPreview
        slides={slides}
        sheet={sheet}
        layout={layout}
        kind={kind}
        username={connection?.username ?? ''}
        caption={caption}
      />
      <aside className="inspector sectioned export-panel">
        {head(posting)}
        {connection && (
          <section>
            <h3>Account</h3>
            <p className="data">@{connection.username}</p>
          </section>
        )}
        <section>
          <h3>Post as</h3>
          <Segmented halves label="Post as" options={KINDS} value={kind} onChange={setKind} disabled={posting} />
          <p className="help">
            {kind === 'feed'
              ? slides.length > 1
                ? `A carousel of ${slides.length} slides.`
                : 'A single image.'
              : `${slides.length} ${slides.length === 1 ? 'story' : 'stories'}, one per slide.`}
          </p>
        </section>

        {!fits(size, kind) && (
          <section>
            <h3>Size</h3>
            <p className="help">
              {kind === 'feed'
                ? `These pages have an aspect ratio of ${ratioLabel(size.w / size.h)}. Instagram’s upload API only takes feed posts from ${ratioLabel(LIMITS.minRatio)} (tall) to ${ratioLabel(LIMITS.maxRatio)} (wide), even where the Instagram app takes others.`
                : `These pages have an aspect ratio of ${ratioLabel(size.w / size.h)}, too tall for stories through Instagram’s upload API.`}
            </p>
            <Segmented
              halves
              label="Fit"
              options={[
                { value: 'crop', label: `Crop to ${ratioLabel(ratio)}` },
                { value: 'expand', label: `Expand to ${ratioLabel(ratio)}` },
              ]}
              value={fit}
              onChange={setFit}
              disabled={posting}
            />
            <p className="help">
              {fit === 'crop'
                ? `Trims the ${tall ? 'top and bottom' : 'sides'} of each slide.`
                : `Adds white margins at the ${tall ? 'sides' : 'top and bottom'}.`}
            </p>
          </section>
        )}

        <section>
          <h3>Slides</h3>
          {torn && (
            <p className="help warn">
              Spreads are posted as their pages: {all.length} slides. Photos across the gutter continue onto the next
              slide.
            </p>
          )}
          <div className="slide-picker">
            {all.map((p, i) => {
              const key = slideKey(p);
              const on = chosen.has(key);
              return (
                <label key={key} className={`slide-pick${on ? ' on' : ''}`}>
                  <PageCanvas page={p} sheet={sheet} scale={THUMB_H / sheet.pageH} />
                  <span className="slide-pick-label">
                    <input
                      type="checkbox"
                      checked={on}
                      disabled={posting || (!on && full)}
                      onChange={(e) => toggle(key, e.target.checked)}
                    />
                    {String(i + 1).padStart(2, '0')}
                  </span>
                </label>
              );
            })}
          </div>
          <p className={`help${full ? ' warn' : ''}`}>
            {slides.length} of {LIMITS.maxItems} chosen.
            {full && ` Instagram takes up to ${LIMITS.maxItems} at a time.`}
          </p>
        </section>

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
            <p className={`help data${caption.length > LIMITS.captionLength || tags > LIMITS.hashtags ? ' warn' : ''}`}>
              {caption.length.toLocaleString()} / {LIMITS.captionLength.toLocaleString()}
              {tags > 0 && ` · ${tags} / ${LIMITS.hashtags} hashtags`}
            </p>
          </section>
        ) : (
          <section>
            <p className="help">Stories don’t have captions.</p>
          </section>
        )}

        <section className="export-actions">
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
    </>
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
  slides: readonly Slide[];
  sheet: Sheet;
  layout: PostImageLayout;
  kind: PostKind;
  username: string;
  caption: string;
}

/** How the post will look on Instagram: a feed post's carousel, or stories. */
function PostPreview({ slides, sheet, layout, kind, username, caption }: PreviewProps) {
  const stageRef = useRef<HTMLDivElement>(null);
  const [stage, setStage] = useState({ w: 700, h: 600 });
  const [index, setIndex] = useState(0);
  const at = Math.min(index, Math.max(0, slides.length - 1));

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
    if (e.key === 'ArrowRight') setIndex(Math.min(slides.length - 1, at + 1));
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

  const render = (slide: Slide) => {
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
          <PageCanvas page={slide} sheet={sheet} scale={s * sheet.pxPerUnit} />
        </div>
      </div>
    );
  };

  const nav = slides.length > 1 && (
    <>
      {at > 0 && (
        <button className="ig-arrow prev" aria-label="Previous slide" onClick={() => setIndex(at - 1)}>
          <ChevronLeft />
        </button>
      )}
      {at < slides.length - 1 && (
        <button className="ig-arrow next" aria-label="Next slide" onClick={() => setIndex(at + 1)}>
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
      {slides.length === 0 ? (
        <p className="muted">Nothing to preview.</p>
      ) : kind === 'story' ? (
        <div className="ig-story" style={{ width: w, height: h }}>
          <div className="ig-track" style={{ transform: `translateX(${-at * w}px)` }}>
            {slides.map((item) => (
              <div key={slideKey(item)} className="ig-slide" style={{ width: w, height: h }}>
                {render(item)}
              </div>
            ))}
          </div>
          <div className="ig-progress">
            {slides.map((item, i) => (
              <span key={slideKey(item)} className={i <= at ? 'seen' : ''} />
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
              {slides.map((item) => (
                <div key={slideKey(item)} className="ig-slide" style={{ width: w, height: h }}>
                  {render(item)}
                </div>
              ))}
            </div>
            {slides.length > 1 && (
              <span className="ig-count">
                {at + 1}/{slides.length}
              </span>
            )}
            {nav}
          </div>
          {slides.length > 1 && (
            <div className="ig-dots">
              {slides.map((item, i) => (
                <span key={slideKey(item)} className={i === at ? 'on' : ''} />
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
