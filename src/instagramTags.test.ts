import { describe, expect, it } from 'vitest';
import { addTag, MAX_TAGS, userTagsParam, usernameOf } from './instagramTags';

describe('tagging people', () => {
  it('reads a username as typed', () => {
    expect(usernameOf(' @Some.One_ ')).toBe('some.one_');
    expect(usernameOf('someone')).toBe('someone');
    expect(usernameOf('')).toBeNull();
    expect(usernameOf('@')).toBeNull();
    expect(usernameOf('two words')).toBeNull();
    expect(usernameOf('a'.repeat(31))).toBeNull();
  });

  it('takes “@salemhilal” and “salemhilal” as the same person', () => {
    expect(usernameOf('@salemhilal')).toBe('salemhilal');
    const at = (input: string, x: number) => ({ username: usernameOf(input) ?? '', x, y: 0.5 });
    expect(addTag(addTag([], at('@salemhilal', 0.2)), at('salemhilal', 0.8))).toEqual([at('salemhilal', 0.8)]);
  });

  it('tags a person once per image, at the last spot', () => {
    const tags = addTag(addTag([], { username: 'a', x: 0.1, y: 0.1 }), { username: 'a', x: 0.5, y: 0.6 });
    expect(tags).toEqual([{ username: 'a', x: 0.5, y: 0.6 }]);
  });

  it('keeps to Instagram’s limit', () => {
    let tags = addTag([], { username: 'first', x: 0, y: 0 });
    for (let i = 0; i < MAX_TAGS; i++) tags = addTag(tags, { username: `p${i}`, x: 0, y: 0 });
    expect(tags).toHaveLength(MAX_TAGS);
    expect(tags.some((t) => t.username === 'first')).toBe(false);
  });

  it('sends spots inside the image, rounded', () => {
    expect(userTagsParam([])).toBeNull();
    expect(JSON.parse(userTagsParam([{ username: 'a', x: 1.2, y: 0.33333 }]) ?? '')).toEqual([
      { username: 'a', x: 1, y: 0.333 },
    ]);
  });
});
