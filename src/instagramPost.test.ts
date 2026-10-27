import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { INSTAGRAM, SERVER_URL } from './config';
import type { InstagramConnection } from './instagram';
import type { Sheet } from './types';
import type { Slide } from './instagramImage';
import { toSpreadId } from './ids';

// Rendering needs a real canvas: stand in for it, as a tiny JPEG per slide.
vi.mock('./rasterExport', () => ({
  renderPage: async () => ({ canvas: {}, missing: 0, previews: 0 }),
  releaseCanvas: () => undefined,
}));
vi.stubGlobal(
  'OffscreenCanvas',
  class {
    getContext() {
      return { fillRect() {}, drawImage() {}, fillStyle: '', imageSmoothingQuality: '' };
    }
    async convertToBlob() {
      return new Blob(['jpeg']);
    }
  },
);

const connection: InstagramConnection = {
  token: 'TOKEN',
  expiresAt: 1_900_000_000,
  refreshedAt: 1_800_000_000,
  userId: '17841400000000000',
  username: 'someone',
  enrollment: 'ENROLLMENT',
  server: SERVER_URL,
};
const markNeedsReconnect = vi.fn();
vi.mock('./instagram', async (importOriginal) => ({
  // Its messages, as they are.
  ...(await importOriginal<typeof import('./instagram')>()),
  freshConnection: async () => connection,
  markNeedsReconnect: () => markNeedsReconnect(),
}));

const { CancelledError, graphErrorMessage, isInstagramImage, postToInstagram, profilePicture, quoteIds } =
  await import('./instagramPost');
const { LIMITS } = await import('./instagramImage');

const USER = connection.userId;
const GRAPH = INSTAGRAM.graphUrl;
const DELETE_URL = `${SERVER_URL}/uploads/batch/delete`;

interface Call {
  method: string;
  url: string;
  /** The form fields of a POST to Instagram, or the query of a GET. */
  params: Record<string, string>;
  init?: RequestInit;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

/**
 * A fake Instagram and Sequence server. Each route can be overridden; by default
 * everything works, containers are ready on the second check, and ids count up.
 */
function fakeServers(overrides: Partial<Record<string, (call: Call) => Response | Promise<Response>>> = {}) {
  const calls: Call[] = [];
  let containers = 0;
  let published = 0;
  const checks = new Map<string, number>();
  const routes: Record<string, (call: Call) => Response | Promise<Response>> = {
    quota: () => json({ data: [{ quota_usage: 0, config: { quota_total: 100 } }] }),
    uploads: (call) => {
      const { count } = JSON.parse(String(call.init?.body)) as { count: number };
      const frames = Array.from({ length: count }, (_, i) => ({
        put: `${SERVER_URL}/uploads/batch/${i}?sig=x`,
        url: `${SERVER_URL}/f/batch/${i}.jpg`,
      }));
      return json({ id: 'batch', frames, delete: DELETE_URL });
    },
    put: () => new Response(null, { status: 204 }),
    media: () => json({ id: `c${++containers}` }),
    status: (call) => {
      const id = call.url.slice(GRAPH.length + 1).split('?')[0]!;
      const n = (checks.get(id) ?? 0) + 1;
      checks.set(id, n);
      return json({ status_code: n > 1 ? 'FINISHED' : 'IN_PROGRESS', id });
    },
    publish: () => json({ id: `m${++published}` }),
    permalink: () => json({ permalink: 'https://www.instagram.com/p/abc/' }),
    delete: () => new Response(null, { status: 204 }),
    ...overrides,
  };
  const route = (call: Call): string => {
    const { method, url, params } = call;
    if (url.startsWith(`${DELETE_URL}?`)) return 'delete';
    if (url === `${SERVER_URL}/uploads`) return 'uploads';
    if (method === 'PUT') return 'put';
    if (url.startsWith(`${GRAPH}/${USER}/content_publishing_limit`)) return 'quota';
    if (url === `${GRAPH}/${USER}/media`) return 'media';
    if (url === `${GRAPH}/${USER}/media_publish`) return 'publish';
    if (params.fields === 'status_code') return 'status';
    if (params.fields === 'permalink') return 'permalink';
    throw new Error(`unexpected ${method} ${url}`);
  };
  const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    const params = Object.fromEntries(
      init?.body instanceof URLSearchParams ? init.body : new URL(url).searchParams,
    ) as Record<string, string>;
    const call = { method, url, params, init };
    calls.push(call);
    const handler = routes[route(call)]!;
    return handler(call);
  });
  /** The calls to one route, in order. */
  const to = (name: string) => calls.filter((c) => route(c) === name);
  /** Where a route's first (or last) call came, among all calls. */
  const firstIndex = (name: string) => calls.findIndex((c) => route(c) === name);
  const lastIndex = (name: string) => calls.findLastIndex((c) => route(c) === name);
  return { calls, to, firstIndex, lastIndex, fetch };
}

const slides = (n: number): Slide[] =>
  Array.from({ length: n }, (_, i) => ({
    spread: { kind: 'frame', id: toSpreadId(`f${i}`), items: [] },
    part: 'whole',
  }));
const sheet: Sheet = {
  arrangement: 'frames',
  unit: 'px',
  pxPerUnit: 1,
  pageW: 1080,
  pageH: 1350,
  centerV: false,
  centerH: false,
  keepRelative: true,
  borders: [],
  lines: [],
  dropBorder: null,
};

/** Posts, letting the polling's waits pass at once. */
async function post(options: Partial<Parameters<typeof postToInstagram>[0]> = {}) {
  const promise = postToInstagram({
    slides: slides(1),
    sheet,
    photos: {},
    kind: 'feed',
    fit: 'crop',
    caption: 'A caption #film',
    onStep: () => {},
    ...options,
  });
  // Settled either way; the caller awaits the original to see which.
  promise.catch(() => undefined);
  await vi.runAllTimersAsync();
  return promise;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  markNeedsReconnect.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('postToInstagram: feed', () => {
  it('posts a single image with its caption, and resolves to the post’s link', async () => {
    const server = fakeServers();
    const steps: string[] = [];
    const link = await post({ onStep: (s) => steps.push(s.step) });
    expect(link).toBe('https://www.instagram.com/p/abc/');
    expect(server.to('put')).toHaveLength(1);
    expect(server.to('media').map((c) => c.params)).toEqual([
      { image_url: `${SERVER_URL}/f/batch/0.jpg`, caption: 'A caption #film', access_token: 'TOKEN' },
    ]);
    expect(server.to('publish').map((c) => c.params.creation_id)).toEqual(['c1']);
    expect(server.to('permalink')[0]!.url).toContain(`${GRAPH}/m1?`);
    expect(steps).toEqual(['preparing', 'uploading', 'processing', 'publishing']);
  });

  it('sends the upload request with the connection’s token and enrollment', async () => {
    const server = fakeServers();
    await post({ slides: slides(2) });
    const [upload] = server.to('uploads');
    expect(upload!.init?.method).toBe('POST');
    expect(new Headers(upload!.init?.headers).get('Authorization')).toBe('Bearer TOKEN');
    expect(JSON.parse(String(upload!.init?.body))).toEqual({ enrollment: 'ENROLLMENT', count: 2 });
    expect(server.to('put').map((c) => c.url)).toEqual([
      `${SERVER_URL}/uploads/batch/0?sig=x`,
      `${SERVER_URL}/uploads/batch/1?sig=x`,
    ]);
  });

  it('posts several frames as a carousel: its items, then the carousel, each ready before publishing', async () => {
    const server = fakeServers();
    const link = await post({ slides: slides(3) });
    expect(link).toBe('https://www.instagram.com/p/abc/');
    const media = server.to('media').map((c) => c.params);
    expect(media.slice(0, 3)).toEqual(
      [0, 1, 2].map((i) => ({
        image_url: `${SERVER_URL}/f/batch/${i}.jpg`,
        is_carousel_item: 'true',
        access_token: 'TOKEN',
      })),
    );
    expect(media[3]).toEqual({
      media_type: 'CAROUSEL',
      children: 'c1,c2,c3',
      caption: 'A caption #film',
      access_token: 'TOKEN',
    });
    // Each item, then the carousel, polled until FINISHED (twice each here).
    const checked = server.to('status').map((c) => c.url.slice(GRAPH.length + 1).split('?')[0]);
    expect(checked).toEqual(['c1', 'c1', 'c2', 'c2', 'c3', 'c3', 'c4', 'c4']);
    expect(server.to('publish').map((c) => c.params.creation_id)).toEqual(['c4']);
    expect(server.firstIndex('publish')).toBeGreaterThan(server.lastIndex('status'));
  });

  it('refuses more than 10 frames before doing anything', async () => {
    const server = fakeServers();
    await expect(post({ slides: slides(LIMITS.maxItems + 1) })).rejects.toThrow(/up to 10 slides/);
    expect(server.calls).toHaveLength(0);
  });

  it('refuses no frames', async () => {
    const server = fakeServers();
    await expect(post({ slides: [] })).rejects.toThrow(/no slides/);
    expect(server.calls).toHaveLength(0);
  });

  it('reports a container Instagram couldn’t process, and publishes nothing', async () => {
    const server = fakeServers({ status: () => json({ status_code: 'ERROR' }) });
    await expect(post()).rejects.toThrow(/couldn’t process the images/);
    expect(server.to('publish')).toHaveLength(0);
  });

  it('resolves to null when the link can’t be fetched (the post is up)', async () => {
    fakeServers({ permalink: () => json({ error: { code: 1 } }, 500) });
    expect(await post()).toBeNull();
  });
});

describe('postToInstagram: people tagged', () => {
  const tag = (username: string) => ({ username, x: 0.25, y: 0.5 });

  it('tags a single image’s people on its container', async () => {
    const server = fakeServers();
    await post({ tags: [[tag('a'), tag('b')]] });
    expect(JSON.parse(server.to('media')[0]!.params.user_tags ?? '')).toEqual([tag('a'), tag('b')]);
  });

  it('tags a carousel’s slides on their own items, and none on the carousel or untagged items', async () => {
    const server = fakeServers();
    await post({ slides: slides(3), tags: [[tag('a')], [], [tag('c')]] });
    const media = server.to('media').map((c) => c.params.user_tags);
    expect(media.map((t) => t && JSON.parse(t))).toEqual([[tag('a')], undefined, [tag('c')], undefined]);
  });

  it('mentions a story’s people on it', async () => {
    const server = fakeServers();
    await post({ kind: 'story', slides: slides(2), tags: [[], [tag('b')]] });
    expect(server.to('media').map((c) => c.params.user_tags)).toEqual([undefined, JSON.stringify([tag('b')])]);
  });
});

describe('isInstagramImage', () => {
  it('takes only Instagram’s image servers', () => {
    expect(isInstagramImage('https://scontent-lga3-1.cdninstagram.com/v/t51/p.jpg?oe=1')).toBe(true);
    expect(isInstagramImage('https://scontent.xx.fbcdn.net/p.jpg')).toBe(true);
    expect(isInstagramImage('http://scontent.cdninstagram.com/p.jpg')).toBe(false);
    expect(isInstagramImage('https://cdninstagram.com.example.com/p.jpg')).toBe(false);
    expect(isInstagramImage('https://evilcdninstagram.com/p.jpg')).toBe(false);
    expect(isInstagramImage('not a url')).toBe(false);
  });
});

describe('profilePicture', () => {
  const answer = (body: unknown, status = 200) =>
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(body), { status }));

  it('asks for the account’s picture, and gives its address', async () => {
    const url = 'https://scontent.cdninstagram.com/p.jpg';
    const fetch = answer({ profile_picture_url: url, id: '1' });
    expect(await profilePicture('TOKEN')).toBe(url);
    expect(String(fetch.mock.calls[0]![0])).toMatch(/\/me\?fields=profile_picture_url&access_token=TOKEN$/);
  });

  it('gives null without one, for one elsewhere, or when Instagram says no', async () => {
    answer({ id: '1' });
    expect(await profilePicture('TOKEN')).toBeNull();
    answer({ profile_picture_url: 'https://example.com/p.jpg' });
    expect(await profilePicture('TOKEN')).toBeNull();
    answer({ error: { code: 1 } }, 400);
    expect(await profilePicture('TOKEN')).toBeNull();
  });
});

describe('postToInstagram: stories', () => {
  it('creates and readies every story before publishing any, then publishes each', async () => {
    const server = fakeServers();
    const link = await post({ slides: slides(3), kind: 'story' });
    expect(link).toBe('https://www.instagram.com/p/abc/');
    expect(server.to('media').map((c) => c.params.media_type)).toEqual(['STORIES', 'STORIES', 'STORIES']);
    expect(server.to('media').every((c) => c.params.caption === undefined)).toBe(true);
    expect(server.firstIndex('publish')).toBeGreaterThan(server.lastIndex('media'));
    expect(server.firstIndex('publish')).toBeGreaterThan(server.lastIndex('status'));
    expect(server.to('publish').map((c) => c.params.creation_id)).toEqual(['c1', 'c2', 'c3']);
    // The first story's link.
    expect(server.to('permalink')[0]!.url).toContain(`${GRAPH}/m1?`);
  });

  it('says how many stories went up when publishing stops partway', async () => {
    let n = 0;
    fakeServers({
      publish: () => (++n === 1 ? json({ id: 'm1' }) : json({ error: { code: 4 } }, 400)),
    });
    await expect(post({ slides: slides(3), kind: 'story' })).rejects.toThrow(
      /^1 of 3 stories were posted, then it stopped\. Instagram’s posting limit was reached/,
    );
  });

  it('reports the first publish failing as it is', async () => {
    fakeServers({ publish: () => json({ error: { code: 4 } }, 400) });
    await expect(post({ slides: slides(2), kind: 'story' })).rejects.toThrow(/^Instagram’s posting limit/);
  });

  it('counts each story against the daily limit', async () => {
    const server = fakeServers({
      quota: () => json({ data: [{ quota_usage: 23, config: { quota_total: 25 } }] }),
    });
    await expect(post({ slides: slides(3), kind: 'story' })).rejects.toThrow(/allows 25 posts a day/);
    expect(server.to('uploads')).toHaveLength(0);
  });
});

describe('postToInstagram: the daily limit', () => {
  it('stops before uploading once the limit is reached', async () => {
    const server = fakeServers({
      quota: () => json({ data: [{ quota_usage: 25, config: { quota_total: 25 } }] }),
    });
    await expect(post()).rejects.toThrow(/allows 25 posts a day through apps/);
    expect(server.to('uploads')).toHaveLength(0);
    expect(server.to('put')).toHaveLength(0);
  });

  it('goes ahead if the limit can’t be checked', async () => {
    const server = fakeServers({ quota: () => json({ error: { code: 1 } }, 500) });
    await post();
    expect(server.to('publish')).toHaveLength(1);
  });
});

describe('postToInstagram: cancelling', () => {
  it('rejects at once with an already-cancelled signal', async () => {
    const server = fakeServers();
    const controller = new AbortController();
    controller.abort();
    await expect(post({ signal: controller.signal })).rejects.toBeInstanceOf(CancelledError);
    expect(server.calls).toHaveLength(0);
  });

  it('stops before uploading', async () => {
    const server = fakeServers();
    const controller = new AbortController();
    const promise = post({
      slides: slides(2),
      signal: controller.signal,
      onStep: (s) => {
        if (s.step === 'preparing' && s.done === 1) controller.abort();
      },
    });
    await expect(promise).rejects.toBeInstanceOf(CancelledError);
    expect(server.to('uploads')).toHaveLength(0);
    expect(server.to('delete')).toHaveLength(0);
  });

  it('stops while waiting for Instagram to process, publishing nothing', async () => {
    const controller = new AbortController();
    const server = fakeServers({
      status: () => {
        controller.abort();
        return json({ status_code: 'IN_PROGRESS' });
      },
    });
    await expect(post({ signal: controller.signal })).rejects.toBeInstanceOf(CancelledError);
    expect(server.to('status')).toHaveLength(1);
    expect(server.to('publish')).toHaveLength(0);
    expect(server.to('delete')).toHaveLength(1);
  });

  it('stops after every container is ready, publishing nothing', async () => {
    const controller = new AbortController();
    let checks = 0;
    const server = fakeServers({
      status: () => {
        // The last of three stories is ready.
        if (++checks === 3) controller.abort();
        return json({ status_code: 'FINISHED' });
      },
    });
    await expect(post({ slides: slides(3), kind: 'story', signal: controller.signal })).rejects.toBeInstanceOf(
      CancelledError,
    );
    expect(server.to('media')).toHaveLength(3);
    expect(server.to('publish')).toHaveLength(0);
    expect(server.to('delete')).toHaveLength(1);
  });
});

describe('postToInstagram: the connection', () => {
  it('marks the connection for reconnecting when the server refuses it', async () => {
    const server = fakeServers({ uploads: () => json({ error: 'unauthorized' }, 401) });
    await expect(post()).rejects.toThrow(/needs renewing/);
    expect(markNeedsReconnect).toHaveBeenCalledOnce();
    expect(server.to('put')).toHaveLength(0);
  });

  it('marks the connection for reconnecting when Instagram says the token is invalid (190)', async () => {
    fakeServers({ media: () => json({ error: { code: 190 } }, 400) });
    await expect(post()).rejects.toThrow(/connection expired/);
    expect(markNeedsReconnect).toHaveBeenCalledOnce();
  });

  it('doesn’t for other Instagram errors', async () => {
    fakeServers({ media: () => json({ error: { code: 36003 } }, 400) });
    await expect(post()).rejects.toThrow(/image shape/);
    expect(markNeedsReconnect).not.toHaveBeenCalled();
  });

  it('says when the server is too busy, or unreachable', async () => {
    fakeServers({ uploads: () => json({}, 429) });
    await expect(post()).rejects.toThrow(/Too many posts/);
    vi.restoreAllMocks();
    fakeServers({ uploads: () => Promise.reject(new TypeError('Failed to fetch')) });
    await expect(post()).rejects.toThrow(/Couldn’t connect to the Sequence server/);
  });
});

describe('postToInstagram: the server’s copies', () => {
  it('deletes them after a post', async () => {
    const server = fakeServers();
    await post();
    expect(server.to('delete').map((c) => c.init?.method)).toEqual(['DELETE']);
    expect(server.to('delete').map((c) => c.params.result)).toEqual(['posted']);
  });

  it('deletes them after a failure', async () => {
    const server = fakeServers({ put: () => new Response(null, { status: 500 }) });
    await expect(post()).rejects.toThrow(/refused an image \(HTTP 500\)/);
    expect(server.to('delete').map((c) => c.params.result)).toEqual(['failed']);
  });

  it('deletes them after a failure to publish', async () => {
    const server = fakeServers({ publish: () => json({ error: { code: 4 } }, 400) });
    await expect(post()).rejects.toThrow(/posting limit/);
    expect(server.to('delete').map((c) => c.params.result)).toEqual(['failed']);
  });

  it('says it was cancelled, or posted when only some stories went up', async () => {
    const controller = new AbortController();
    let server = fakeServers({
      status: () => {
        controller.abort();
        return json({ status_code: 'IN_PROGRESS' });
      },
    });
    await expect(post({ signal: controller.signal })).rejects.toBeInstanceOf(CancelledError);
    expect(server.to('delete').map((c) => c.params.result)).toEqual(['cancelled']);

    vi.restoreAllMocks();
    let published = 0;
    server = fakeServers({
      publish: () => (++published === 2 ? json({ error: { code: 4 } }, 400) : json({ id: `m${published}` })),
    });
    await expect(post({ slides: slides(3), kind: 'story' })).rejects.toThrow(/1 of 3 stories/);
    expect(server.to('delete').map((c) => c.params.result)).toEqual(['posted']);
  });
});

describe('ids longer than a JavaScript number holds', () => {
  it('are quoted before parsing', () => {
    expect(quoteIds('{"id":17841400000000000123,"user_id": 9007199254740993}')).toBe(
      '{"id":"17841400000000000123","user_id": "9007199254740993"}',
    );
    expect(quoteIds('{"id":"already"}')).toBe('{"id":"already"}');
  });

  it('keep every digit from Instagram’s answer to the next call', async () => {
    const container = '17841400000000000123';
    const media = '17999999999999999999';
    const raw = (id: string) => new Response(`{"id":${id}}`, { status: 200 });
    const server = fakeServers({
      media: () => raw(container),
      publish: () => raw(media),
      status: () => json({ status_code: 'FINISHED' }),
    });
    await post();
    expect(server.to('status')[0]!.url).toContain(`${GRAPH}/${container}?`);
    expect(server.to('publish')[0]!.params.creation_id).toBe(container);
    expect(server.to('permalink')[0]!.url).toContain(`${GRAPH}/${media}?`);
  });
});

describe('graphErrorMessage', () => {
  it('explains the errors people can act on', () => {
    expect(graphErrorMessage({ code: 190 }, 400)).toMatch(/Connect again/);
    expect(graphErrorMessage({ code: 4 }, 400)).toMatch(/limit/);
    expect(graphErrorMessage({ code: 9004 }, 400)).toMatch(/fetch the images/);
    expect(graphErrorMessage({ code: 36003 }, 400)).toMatch(/cropping or expanding/);
    expect(graphErrorMessage({ code: 1, error_user_msg: 'Try a smaller image.' }, 400)).toBe('Try a smaller image.');
    expect(graphErrorMessage(null, 500)).toMatch(/HTTP 500/);
  });
});
