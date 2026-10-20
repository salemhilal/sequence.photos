import { describe, expect, it, vi } from 'vitest';
import { rearrange } from './convertLayout';
import { outputPages } from './renderPlan';
import { emptyProject } from './store';

vi.mock('./db', () => ({ getImage: async () => undefined }));
const { imageNames } = await import('./rasterExport');

describe('imageNames', () => {
  it('names a book’s spreads by their pages, the single first and last pages on their own', () => {
    const book = emptyProject(); // four spreads: 1, 2–3, 4–5, 6
    expect(imageNames(book, outputPages(book, 'spread'))).toEqual(['01.jpg', '02-03.jpg', '04-05.jpg', '06.jpg']);
  });

  it('numbers pages and frames in order, padded to the count', () => {
    const book = emptyProject();
    expect(imageNames(book, outputPages(book, 'page'), 'png')).toEqual(
      ['01', '02', '03', '04', '05', '06'].map((n) => `${n}.png`),
    );
    const frames = rearrange(book, 'frames');
    expect(imageNames(frames, outputPages(frames, 'page'))[5]).toBe('06.jpg');
  });
});
