import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Check, Image, Share } from 'lucide-react';
import { InstagramGlyph } from '../components/InstagramGlyph';
import { DEFAULT_QUALITY } from '../exportOptions';
import { saveExportState } from '../exportState';
import { useConnectInstagram, useInstagram } from '../instagram';
import {
  fits,
  hashtagCount,
  LIMITS,
  ratioLabel,
  slideSize,
  targetRatio,
  type Fit,
  type PostKind,
} from '../instagramImage';
import { CancelledError, postToInstagram, type PostStep } from '../instagramPost';
import { PREVIEWS_NOTICE, renderImages } from '../rasterExport';
import { firstNonEmpty, outputPages, slideKey, type OutputPage } from '../renderPlan';
import { sheetOf } from '../spreads';
import { useProject } from '../store';
import type { Frame } from '../types';
import { ui } from '../ui';
import { FrameView } from './FrameView';
import { phone } from './nav';
import { Segmented, Sheet } from './Sheets';

type To = 'images' | 'instagram';

/** Export: the frames as images (to Photos, Files, or anywhere through the share sheet), or to Instagram. */
export function ExportSheet() {
  const { project } = useProject();
  const [to, setTo] = useState<To>(project.export?.to === 'instagram' ? 'instagram' : 'images');
  const [locked, setLocked] = useState(false);
  // Where each destination's main button goes: the sheet's foot, which stays put (clear of the
  // screen's rounded corners) while the rest scrolls.
  const [foot, setFoot] = useState<HTMLDivElement | null>(null);
  const choose = (t: To) => {
    setTo(t);
    saveExportState((s) => ({ ...s, to: t }));
  };
  return (
    <Sheet
      full
      title="Export"
      onDismiss={() => phone.set({ sheet: null })}
      left={(close) => (
        <button className="btn" aria-label="Close" disabled={locked} onClick={() => close()}>
          Close
        </button>
      )}
      foot={<div className="foot-slot" ref={setFoot} />}
    >
      <Segmented
        label="Export to"
        value={to}
        onChange={(t) => !locked && choose(t)}
        options={[
          {
            value: 'images',
            label: (
              <>
                <Image /> Images
              </>
            ),
          },
          {
            value: 'instagram',
            label: (
              <>
                <InstagramGlyph /> Instagram
              </>
            ),
          },
        ]}
      />
      {to === 'images' ? <ImagesExport foot={foot} /> : <InstagramExport foot={foot} onLock={setLocked} />}
    </Sheet>
  );
}

/** What goes in the sheet's foot, once it's there. */
function Foot({ at, children }: { at: HTMLDivElement | null; children: ReactNode }) {
  return at ? createPortal(children, at) : null;
}

/** A frame to choose (or not) in a strip, with its check. */
function Pick({
  frame,
  width,
  on,
  label,
  name,
  disabled = false,
  onToggle,
}: {
  frame: Frame;
  width: number;
  on: boolean;
  label: string;
  name?: string;
  disabled?: boolean;
  onToggle: () => void;
}) {
  const { project } = useProject();
  return (
    <button
      className={`strip-item${on ? '' : ' off'}`}
      aria-pressed={on}
      aria-label={label}
      disabled={disabled}
      onClick={onToggle}
    >
      <FrameView frame={frame} page={project.page} photos={project.photos} width={width} />
      <span className={`strip-check${on ? '' : ' off'}`}>{on && <Check />}</span>
      {name && <span>{name}</span>}
    </button>
  );
}

/** Hand files to iOS's share sheet (Save Images puts them in Photos); else download them. */
async function shareFiles(files: File[]): Promise<boolean> {
  if (navigator.canShare?.({ files })) {
    try {
      await navigator.share({ files });
      return true;
    } catch {
      return false;
    }
  }
  for (const f of files) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(f);
    a.download = f.name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
  }
  return true;
}

function ImagesExport({ foot }: { foot: HTMLDivElement | null }) {
  const { project } = useProject();
  // Which frames to make: all of them, until some are left out.
  const [off, setOff] = useState<ReadonlySet<string>>(new Set());
  const saved = project.export?.options;
  const [format, setFormat] = useState<'jpeg' | 'png'>(saved?.format ?? 'jpeg');
  const [quality, setQuality] = useState(saved?.quality ?? DEFAULT_QUALITY);
  // Made images, for the choices they were made with.
  const [made, setMade] = useState<{ files: File[]; for: unknown[] } | null>(null);
  const choices = [project, format, quality, off];
  const files = made && made.for.every((c, i) => c === choices[i]) ? made.files : null;
  const all = outputPages(project, 'page');
  const pages = all.filter((p) => !off.has(slideKey(p)));
  const ext = format === 'png' ? 'png' : 'jpg';
  const n = pages.length;
  const digits = Math.max(2, String(n).length);
  const name = (i: number) => `${String(i).padStart(digits, '0')}.${ext}`;

  const remember = (o: { format?: 'jpeg' | 'png'; quality?: number }) =>
    saveExportState((s) => ({ ...s, options: { ...s.options, ...o } }));

  const make = async () => {
    ui.set({ busy: `Making images… 0 of ${n}` });
    try {
      const out = await renderImages(pages, project, (done) => ui.set({ busy: `Making images… ${done} of ${n}` }), {
        format,
        quality,
      });
      if (out.missing) ui.set({ notice: `${out.missing} ${out.missing === 1 ? 'photo' : 'photos'} couldn’t be read.` });
      else if (out.previews) ui.set({ notice: PREVIEWS_NOTICE });
      const images = out.files.map((f) => new File([f.data], f.name, { type: f.data.type }));
      setMade({ files: images, for: choices });
      return images;
    } catch {
      ui.set({ notice: 'Couldn’t make the images.' });
      return null;
    } finally {
      ui.set({ busy: null });
    }
  };

  // The images are made first; the share sheet needs a tap of its own to open (iOS asks
  // for one), so a second tap shares them once they're ready.
  const share = async () => {
    const ready = files ?? (await make());
    if (ready && files) await shareFiles(ready);
  };

  return (
    <>
      <div>
        <div className="label" style={{ display: 'flex', justifyContent: 'space-between' }}>
          Frames
          <button className="link" onClick={() => setOff(off.size ? new Set() : new Set(all.map(slideKey).slice(1)))}>
            {off.size ? 'All' : 'Just the first'}
          </button>
        </div>
        <div className="strip">
          {all.map((p, i) => {
            const key = slideKey(p);
            const on = !off.has(key);
            const position = pages.indexOf(p);
            return (
              <Pick
                key={key}
                frame={p.spread as Frame}
                width={72}
                on={on}
                label={`Frame ${i + 1}`}
                name={on ? name(position + 1) : '—'}
                onToggle={() => {
                  const next = new Set(off);
                  if (on) next.add(key);
                  else next.delete(key);
                  setOff(next);
                }}
              />
            );
          })}
        </div>
      </div>
      <div className="group">
        <div className="group-row" style={{ cursor: 'default' }}>
          Format
          <span style={{ marginLeft: 'auto', width: 150 }}>
            <Segmented
              label="Format"
              value={format}
              onChange={(f) => (setFormat(f), remember({ format: f }))}
              options={[
                { value: 'jpeg', label: 'JPEG' },
                { value: 'png', label: 'PNG' },
              ]}
            />
          </span>
        </div>
        {format === 'jpeg' ? (
          <div className="group-row" style={{ flexWrap: 'wrap', padding: '10px 16px 12px', gap: 8, cursor: 'default' }}>
            <label htmlFor="quality" style={{ flex: 1 }}>
              Quality
            </label>
            <span className="mono muted" style={{ fontSize: 12 }}>
              {Math.round(quality * 100)}%
            </span>
            <input
              id="quality"
              type="range"
              min={50}
              max={100}
              value={Math.round(quality * 100)}
              style={{ width: '100%' }}
              onChange={(e) => setQuality(Number(e.target.value) / 100)}
              onPointerUp={() => remember({ quality })}
            />
          </div>
        ) : (
          <div className="group-row" style={{ cursor: 'default' }}>
            Quality<span className="value">Lossless</span>
          </div>
        )}
        <div className="group-row" style={{ cursor: 'default' }}>
          Size
          <span className="value">
            {project.page.w} × {project.page.h} px
          </span>
        </div>
      </div>
      <span className="note">
        {n === 0
          ? 'Choose at least one frame.'
          : `${n} ${format === 'png' ? (n === 1 ? 'PNG' : 'PNGs') : n === 1 ? 'JPEG' : 'JPEGs'}, ${
              n > 1 ? `${name(1)} to ${name(n)}` : name(1)
            }. In the share sheet, Save Images puts them in Photos.`}
      </span>
      <Foot at={foot}>
        <button className="btn primary wide" disabled={n === 0} onClick={() => void share()}>
          {files ? (
            <>
              <Share /> Share {n} {n === 1 ? 'image' : 'images'}…
            </>
          ) : (
            `Make ${n} ${n === 1 ? 'image' : 'images'}`
          )}
        </button>
      </Foot>
    </>
  );
}

type Status =
  | { kind: 'idle' }
  | { kind: 'posting'; step: PostStep }
  | { kind: 'done'; link: string | null }
  | { kind: 'failed'; message: string };

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

function InstagramExport({ foot, onLock }: { foot: HTMLDivElement | null; onLock: (on: boolean) => void }) {
  const { project } = useProject();
  const connection = useInstagram();
  const signIn = useConnectInstagram({ returnToExport: true });
  const sheet = sheetOf(project);
  const all = outputPages(project, 'page');
  const size = slideSize(sheet);
  const [saved] = useState(() => project.export?.instagram ?? {});
  const [kind, setKind] = useState<PostKind>(saved.kind ?? 'feed');
  const [fit, setFit] = useState<Fit>(saved.fit ?? 'crop');
  const [caption, setCaption] = useState(saved.caption ?? '');
  const [chosen, setChosen] = useState(() => {
    const was = new Set(saved.chosen ?? []);
    const kept = new Set(all.map(slideKey).filter((k) => was.has(k)));
    return kept.size ? kept : firstNonEmpty(all, sheet, LIMITS.maxItems);
  });
  const [shown, setShown] = useState(0);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const abort = useRef<AbortController | null>(null);

  // Kept with the project once something's changed, as the desktop does.
  const now = JSON.stringify([kind, fit, caption, [...chosen]]);
  const [opened] = useState(now);
  useEffect(() => {
    if (now === opened) return;
    saveExportState((s) => ({
      ...s,
      instagram: {
        ...s.instagram,
        kind,
        fit,
        ...(caption ? { caption } : { caption: undefined }),
        chosen: [...chosen],
      },
    }));
  }, [now, opened, kind, fit, caption, chosen]);

  const posting = status.kind === 'posting';
  useEffect(() => onLock(posting), [posting, onLock]);
  useEffect(() => () => abort.current?.abort(), []);

  const slides = all.filter((p) => chosen.has(slideKey(p)));
  const full = slides.length >= LIMITS.maxItems;
  const ready = connection !== null && !connection.needsReconnect;
  const tags = hashtagCount(caption);
  const ratio = targetRatio(size, kind);
  const problem =
    slides.length === 0
      ? 'Choose at least one slide to post.'
      : kind === 'feed' && caption.length > LIMITS.captionLength
        ? `Captions can be up to ${LIMITS.captionLength.toLocaleString()} characters.`
        : kind === 'feed' && tags > LIMITS.hashtags
          ? `Instagram allows up to ${LIMITS.hashtags} hashtags.`
          : null;

  const toggle = (key: string) => {
    const next = new Set([...chosen].filter((k) => all.some((p) => slideKey(p) === k)));
    if (next.has(key)) next.delete(key);
    else if (next.size < LIMITS.maxItems) next.add(key);
    setChosen(next);
  };

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
      onPreviews: (n) => n && ui.set({ notice: PREVIEWS_NOTICE }),
      signal: controller.signal,
      onStep: (step) => setStatus({ kind: 'posting', step }),
    }).then(
      (link) => {
        saveExportState((s) => ({ ...s, instagram: { kind, fit } }));
        setCaption('');
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

  const current: OutputPage | undefined = slides[Math.min(shown, slides.length - 1)];

  return (
    <>
      <div className="account">
        {ready ? (
          <>
            <span className="avatar">{connection.username.slice(0, 1).toUpperCase()}</span>
            <span className="mono" style={{ fontSize: 13 }}>
              @{connection.username}
            </span>
          </>
        ) : (
          <button className="btn raised" style={{ flex: 1 }} disabled={signIn.busy} onClick={signIn.connect}>
            {signIn.busy ? 'Opening Instagram…' : connection ? 'Reconnect Instagram' : 'Connect Instagram'}
          </button>
        )}
      </div>
      <Segmented
        label="Post as"
        value={kind}
        onChange={(k) => !posting && setKind(k)}
        options={[
          { value: 'feed', label: 'Feed post' },
          { value: 'story', label: 'Stories' },
        ]}
      />
      {!ready && (
        <span className={`note${signIn.message?.warn ? ' warn' : ''}`}>
          {signIn.message?.text ??
            'Posting goes through your Instagram account. It needs a Business or Creator account.'}
        </span>
      )}
      <div>
        <div className="label" style={{ display: 'flex', justifyContent: 'space-between' }}>
          Slides
          <span className={full ? 'note warn' : 'note'} style={{ padding: 0, fontWeight: 400 }}>
            {slides.length} of {LIMITS.maxItems} chosen
          </span>
        </div>
        <div className="strip">
          {all.map((p, i) => {
            const key = slideKey(p);
            const on = chosen.has(key);
            return (
              <Pick
                key={key}
                frame={p.spread as Frame}
                width={44}
                on={on}
                label={`Slide ${i + 1}`}
                disabled={posting || (!on && full)}
                onToggle={() => toggle(key)}
              />
            );
          })}
        </div>
      </div>
      {current &&
        (kind === 'story' ? (
          <StoryPreview
            slide={current}
            at={Math.min(shown, slides.length - 1)}
            count={slides.length}
            username={connection?.username ?? 'you'}
            onNext={() => setShown((shown + 1) % Math.max(1, slides.length))}
          />
        ) : (
          <div className="post-card">
            <div
              style={{ position: 'relative' }}
              onClick={() => setShown((shown + 1) % Math.max(1, slides.length))}
              role="button"
              aria-label="Next slide"
            >
              <FrameView frame={current.spread as Frame} page={project.page} photos={project.photos} width={240} />
              {slides.length > 1 && (
                <span className="post-count">
                  {Math.min(shown, slides.length - 1) + 1}/{slides.length}
                </span>
              )}
            </div>
            {slides.length > 1 && (
              <div className="post-dots">
                {slides.map((p, i) => (
                  <span key={slideKey(p)} className={i === Math.min(shown, slides.length - 1) ? 'on' : ''} />
                ))}
              </div>
            )}
            {caption && <div className="post-caption">{caption}</div>}
          </div>
        ))}
      {!fits(size, kind) && (
        <div>
          <div className="label">Size</div>
          <Segmented
            label="Fit"
            value={fit}
            onChange={(f) => !posting && setFit(f)}
            options={[
              { value: 'crop', label: `Crop to ${ratioLabel(ratio)}` },
              { value: 'expand', label: `Expand to ${ratioLabel(ratio)}` },
            ]}
          />
          <span className="note" style={{ display: 'block', paddingTop: 6 }}>
            Instagram takes {kind === 'feed' ? 'feed posts' : 'stories'} up to {ratioLabel(ratio)} from here.
          </span>
        </div>
      )}
      {kind === 'feed' ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <label className="label" htmlFor="caption" style={{ padding: '0 4px' }}>
            Caption
          </label>
          <textarea
            id="caption"
            className="caption"
            placeholder="Write a caption…"
            value={caption}
            disabled={posting}
            onChange={(e) => setCaption(e.target.value)}
          />
          <span className="mono muted" style={{ fontSize: 11, textAlign: 'right' }}>
            {caption.length.toLocaleString()} / {LIMITS.captionLength.toLocaleString()} · {tags} / {LIMITS.hashtags}{' '}
            hashtags
          </span>
        </div>
      ) : (
        <span className="note">Stories have no captions.</span>
      )}
      <Foot at={foot}>
        {status.kind === 'posting' && <span className="note">{stepLabel(status.step)}</span>}
        {status.kind === 'failed' && <span className="note danger">{status.message}</span>}
        {status.kind === 'done' && (
          <span className="note">
            Posted to Instagram.{' '}
            {status.link && (
              <a href={status.link} style={{ color: 'var(--text)' }}>
                View on Instagram
              </a>
            )}
          </span>
        )}
        {ready && problem && <span className="note warn">{problem}</span>}
        {posting ? (
          <button
            className="btn raised wide"
            disabled={status.step.step === 'publishing'}
            onClick={() => abort.current?.abort()}
          >
            Cancel
          </button>
        ) : (
          <button className="btn primary wide" disabled={!ready || !!problem} onClick={post}>
            Post to Instagram
          </button>
        )}
      </Foot>
    </>
  );
}

/** Where a story preview's slide sits: a 9:16 screen, like Instagram's. */
const STORY_W = 210;
const STORY_H = (STORY_W * 16) / 9;

/** A story as Instagram shows it: a tall dark screen, progress bars, the account, the slide. */
function StoryPreview({
  slide,
  at,
  count,
  username,
  onNext,
}: {
  slide: OutputPage;
  at: number;
  count: number;
  username: string;
  onNext: () => void;
}) {
  const { project } = useProject();
  const width = Math.min(STORY_W, (STORY_H * project.page.w) / project.page.h);
  return (
    <div
      className="story"
      style={{ width: STORY_W, height: STORY_H }}
      onClick={onNext}
      role="button"
      aria-label="Next story"
    >
      <FrameView frame={slide.spread as Frame} page={project.page} photos={project.photos} width={width} />
      <div className="story-top">
        <div className="story-bars">
          {Array.from({ length: count }, (_, i) => (
            <span key={i} className={i < at ? 'done' : i === at ? 'on' : ''} />
          ))}
        </div>
        <div className="story-account">
          <span className="avatar">{username.slice(0, 1).toUpperCase()}</span>
          {username}
        </div>
      </div>
    </div>
  );
}
