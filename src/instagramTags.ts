/**
 * People tagged in an Instagram post: each a username at a spot on one slide's image, as
 * Instagram's `user_tags` takes them (x and y from 0 to 1, from the image's left and top).
 * On stories, the same tags mention the people there.
 */

export interface UserTag {
  username: string;
  x: number;
  y: number;
}

/** Instagram's limit per image. */
export const MAX_TAGS = 20;

/** Instagram usernames: letters, digits, periods, underscores, up to 30. */
const USERNAME = /^[A-Za-z0-9._]{1,30}$/;

/** A username as typed ("@Some.One ", say) as Instagram takes it, or null if it can't be one. */
export function usernameOf(input: string): string | null {
  const name = input.trim().replace(/^@/, '').toLowerCase();
  return USERNAME.test(name) ? name : null;
}

/** Add a tag, replacing one of the same person elsewhere on the image (Instagram tags each once). */
export function addTag(tags: readonly UserTag[], tag: UserTag): UserTag[] {
  return [...tags.filter((t) => t.username !== tag.username), tag].slice(-MAX_TAGS);
}

/** `user_tags` for an image's container: the tags, with spots kept inside the image. */
export function userTagsParam(tags: readonly UserTag[]): string | null {
  if (!tags.length) return null;
  const clamp = (n: number) => Math.round(Math.min(1, Math.max(0, n)) * 1000) / 1000;
  return JSON.stringify(tags.slice(0, MAX_TAGS).map((t) => ({ username: t.username, x: clamp(t.x), y: clamp(t.y) })));
}
