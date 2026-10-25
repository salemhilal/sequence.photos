import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight, ExternalLink, X } from 'lucide-react';
import { useElementSize, usePager } from '../hooks';
import { useConnectInstagram, useInstagram } from '../instagram';
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
import { CancelledError, postToInstagram, profilePicture, type PostStep } from '../instagramPost';
import { addTag, MAX_TAGS, usernameOf, type UserTag } from '../instagramTags';
import { saveExportState } from '../exportState';
import { PREVIEWS_NOTICE } from '../rasterExport';
import { firstNonEmpty, outputPages, slideKey } from '../renderPlan';
import { sheetOf } from '../spreads';
import { useProject } from '../store';
import type { Sheet } from '../types';
import { goToPage, lockPage } from '../ui';
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

/** People tagged, by slide (`slideKey`). */
type Tags = Record<string, readonly UserTag[]>;

/** The account's profile picture while connected (asked for each time the pane opens), or null. */
function useProfilePicture(token: string | null): string | null {
  const [picture, setPicture] = useState<{ token: string; url: string | null } | null>(null);
  useEffect(() => {
    if (!token) return;
    const controller = new AbortController();
    void profilePicture(token, controller.signal).then((url) => {
      if (!controller.signal.aborted) setPicture({ token, url });
    });
    return () => controller.abort();
  }, [token]);
  return token && picture?.token === token ? picture.url : null;
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

  // The post as it was left (saved with the project, like Export's choices), else the defaults.
  const [saved] = useState(() => project.export?.instagram ?? {});
  const [kind, setKind] = useState<PostKind>(saved.kind ?? 'feed');
  const [fit, setFit] = useState<Fit>(saved.fit ?? 'crop');
  const [caption, setCaption] = useState(saved.caption ?? '');
  const [people, setPeople] = useState<Tags>(saved.tags ?? {});
  // Instagram's API takes 10 at a time, for a carousel or a run of stories alike: the
  // first 10 with photos to start with, or those chosen last time that are still there.
  const [chosen, setChosen] = useState(() => {
    const was = new Set(saved.chosen ?? []);
    const kept = new Set(all.map(slideKey).filter((k) => was.has(k)));
    return kept.size ? kept : firstNonEmpty(all, sheet, LIMITS.maxItems);
  });
  // Saved once something's changed (just opening the pane changes nothing).
  const opened = useRef(true);
  useEffect(() => {
    if (opened.current) {
      opened.current = false;
      return;
    }
    const tags = Object.fromEntries(Object.entries(people).filter(([, list]) => list.length));
    saveExportState((s) => ({
      ...s,
      instagram: {
        kind,
        fit,
        ...(caption && { caption }),
        chosen: [...chosen],
        ...(Object.keys(tags).length && { tags: tags as Record<string, UserTag[]> }),
      },
    }));
  }, [kind, fit, caption, chosen, people]);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  // Photos that went out at preview size (their originals wouldn't decode here).
  const [previews, setPreviews] = useState(0);
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
    lockPage(posting);
    return () => lockPage(false);
  }, [posting]);
  useEffect(() => () => abort.current?.abort(), []);
  // Cancelling stops before anything is published.
  const cancellable = posting && status.step.step !== 'publishing';

  // Everything previews and can be set up before connecting; posting needs the account.
  const ready = connection !== null && !connection.needsReconnect;
  const signIn = useConnectInstagram({ returnToExport: true });
  const picture = useProfilePicture(ready ? connection.token : null);
  const tagged = slides.reduce((n, p) => n + (people[slideKey(p)]?.length ?? 0), 0);
  const tagging = {
    tags: people,
    editable: !posting,
    add: (key: string, tag: UserTag) => setPeople((t) => ({ ...t, [key]: addTag(t[key] ?? [], tag) })),
    remove: (key: string, username: string) =>
      setPeople((t) => ({ ...t, [key]: (t[key] ?? []).filter((x) => x.username !== username) })),
  };

  const problem = !ready
    ? null
    : slides.length === 0
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
      tags: slides.map((p) => people[slideKey(p)] ?? []),
      onPreviews: setPreviews,
      signal: controller.signal,
      onStep: (step) => setStatus({ kind: 'posting', step }),
    }).then(
      (link) => {
        // Posted: the next post starts fresh, not with this one's caption, slides, and tags.
        saveExportState((s) => ({ ...s, instagram: { kind, fit } }));
        setStatus({ kind: 'done', link });
      },
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
        username={connection?.username ?? 'you'}
        picture={picture}
        caption={caption}
        tagging={tagging}
      />
      <aside className="inspector sectioned export-panel">
        {head(posting)}
        <section>
          <h3>Account</h3>
          {ready ? (
            <p className="data">@{connection.username}</p>
          ) : (
            <>
              <p className="help">
                {connection
                  ? `Connect @${connection.username} again to keep posting.`
                  : 'Posting goes through your Instagram account. It needs a Business or Creator account.'}
              </p>
              <button className="btn" disabled={signIn.busy} onClick={signIn.connect}>
                {signIn.busy ? 'Opening Instagram…' : connection ? 'Reconnect Instagram' : 'Connect Instagram'}
              </button>
              {signIn.message && <p className={`help${signIn.message.warn ? ' warn' : ''}`}>{signIn.message.text}</p>}
            </>
          )}
        </section>
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

        <section>
          <h3>People</h3>
          <p className="help">
            {kind === 'feed'
              ? 'Click a slide in the preview to tag someone there.'
              : 'Click a story in the preview to mention someone there.'}
            {tagged > 0 && ` ${tagged} tagged.`}
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
        ) : null}

        <section className="export-actions">
          {status.kind === 'done' ? (
            <>
              <p className="instagram-done">Posted to Instagram.</p>
              {previews > 0 && <p className="help warn">{PREVIEWS_NOTICE}</p>}
              {status.link && (
                <a className="btn" href={status.link} target="_blank" rel="noopener noreferrer">
                  <ExternalLink />
                  View on Instagram
                </a>
              )}
              <button className="btn ghost" onClick={() => goToPage('desk')}>
                Done
              </button>
            </>
          ) : (
            <>
              <button className="btn primary" disabled={posting || !ready || problem !== null} onClick={post}>
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

interface Tagging {
  tags: Tags;
  editable: boolean;
  add: (key: string, tag: UserTag) => void;
  remove: (key: string, username: string) => void;
}

interface PreviewProps {
  slides: readonly Slide[];
  sheet: Sheet;
  layout: PostImageLayout;
  kind: PostKind;
  username: string;
  /** The profile picture's address, or null for the username's initial. */
  picture: string | null;
  caption: string;
  tagging: Tagging;
}

/** How the post will look on Instagram: a feed post's carousel, or stories. */
function PostPreview({ slides, sheet, layout, kind, username, picture, caption, tagging }: PreviewProps) {
  const [stageRef, stage] = useElementSize<HTMLDivElement>({ w: 700, h: 600 });
  const { at, go } = usePager(slides.length, true);

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
    const key = slideKey(slide);
    return (
      <TagLayer key={key} slideKey={key} tagging={tagging} style={{ width: imageW, height: imageH }}>
        <div
          style={{
            position: 'absolute',
            left: layout.target.x * k - layout.source.x * s,
            top: layout.target.y * k - layout.source.y * s,
          }}
        >
          <PageCanvas page={slide} sheet={sheet} scale={s * sheet.pxPerUnit} />
        </div>
      </TagLayer>
    );
  };

  const nav = slides.length > 1 && (
    <>
      {at > 0 && (
        <button className="ig-arrow prev" aria-label="Previous slide" onClick={() => go(-1)}>
          <ChevronLeft />
        </button>
      )}
      {at < slides.length - 1 && (
        <button className="ig-arrow next" aria-label="Next slide" onClick={() => go(1)}>
          <ChevronRight />
        </button>
      )}
    </>
  );

  const head = (
    <header className="ig-head">
      <Avatar username={username} picture={picture} />
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

/** The account's profile picture, or its initial without one (or until it loads). */
function Avatar({ username, picture }: { username: string; picture: string | null }) {
  const [failed, setFailed] = useState<string | null>(null);
  return picture && failed !== picture ? (
    <img className="ig-avatar" src={picture} alt="" referrerPolicy="no-referrer" onError={() => setFailed(picture)} />
  ) : (
    <span className="ig-avatar" aria-hidden="true">
      {username.charAt(0).toUpperCase()}
    </span>
  );
}

/**
 * A slide's image with the people tagged on it, as Instagram shows them: click a spot to
 * tag someone there (type their username, Return), click a tag's × to remove it.
 */
function TagLayer({
  slideKey: key,
  tagging,
  style,
  children,
}: {
  slideKey: string;
  tagging: Tagging;
  style: React.CSSProperties;
  children: ReactNode;
}) {
  const [draft, setDraft] = useState<{ x: number; y: number; text: string } | null>(null);
  const tags = tagging.tags[key] ?? [];
  const full = tags.length >= MAX_TAGS;

  const commit = () => {
    const username = draft && usernameOf(draft.text);
    if (draft && username) tagging.add(key, { username, x: draft.x, y: draft.y });
    setDraft(null);
  };
  const place = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!tagging.editable || full) return;
    const r = e.currentTarget.getBoundingClientRect();
    setDraft({ x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height, text: '' });
  };
  const at = (t: { x: number; y: number }) => ({ left: `${t.x * 100}%`, top: `${t.y * 100}%` });

  return (
    <div
      className={`ig-image${tagging.editable && !full ? ' taggable' : ''}`}
      style={style}
      data-tip={
        tagging.editable ? (full ? `Up to ${MAX_TAGS} people per image` : 'Click to tag someone here') : undefined
      }
      onClick={place}
    >
      {children}
      {tags.map((t) => (
        <span key={t.username} className="ig-user-tag" style={at(t)} onClick={(e) => e.stopPropagation()}>
          {t.username}
          {tagging.editable && (
            <button aria-label={`Remove ${t.username}`} onClick={() => tagging.remove(key, t.username)}>
              <X />
            </button>
          )}
        </span>
      ))}
      {draft && (
        <span className="ig-user-tag draft" style={at(draft)} onClick={(e) => e.stopPropagation()}>
          <input
            autoFocus
            aria-label="Username to tag"
            placeholder="Username"
            value={draft.text}
            spellCheck={false}
            autoCapitalize="off"
            className={draft.text && !usernameOf(draft.text) ? 'invalid' : ''}
            onChange={(e) => setDraft({ ...draft, text: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit();
              else if (e.key === 'Escape') setDraft(null);
              else return;
              e.preventDefault();
              e.stopPropagation();
            }}
            onBlur={commit}
          />
        </span>
      )}
    </div>
  );
}
