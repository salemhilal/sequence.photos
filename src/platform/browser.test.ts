// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';

vi.mock('../update', () => ({ startOfflineSupport: () => undefined }));
const { platform } = await import('./browser');

describe('the website’s Instagram sign-in return', () => {
  it('hands over the fragment, and takes it out of the address first', () => {
    history.replaceState(null, '', '/app/?x=1#instagram=SEALED&state=web.n.c');
    const finish = vi.fn();
    platform.onSignInReturn(finish);
    expect(finish).toHaveBeenCalledWith('#instagram=SEALED&state=web.n.c');
    expect(location.pathname + location.search + location.hash).toBe('/app/?x=1');
  });

  it('leaves any other address alone', () => {
    history.replaceState(null, '', '/app/#section');
    const finish = vi.fn();
    platform.onSignInReturn(finish);
    expect(finish).not.toHaveBeenCalled();
    expect(location.hash).toBe('#section');
  });
});
