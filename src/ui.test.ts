import { afterEach, describe, expect, it } from 'vitest';
import { closeModal, lockModal, modalLocked, openModal, toggleModal, ui } from './ui';

afterEach(() => {
  lockModal(false);
  ui.set({ modal: null });
});

describe('lockModal', () => {
  it('keeps the open dialog open, and nothing else opening, while locked', () => {
    openModal('instagram');
    lockModal(true);
    expect(modalLocked()).toBe(true);
    closeModal();
    expect(ui.get().modal).toBe('instagram');
    openModal('settings');
    expect(ui.get().modal).toBe('instagram');
    toggleModal('instagram');
    expect(ui.get().modal).toBe('instagram');
    toggleModal('about');
    expect(ui.get().modal).toBe('instagram');
  });

  it('lets dialogs open and close again once unlocked', () => {
    openModal('instagram');
    lockModal(true);
    lockModal(false);
    expect(modalLocked()).toBe(false);
    closeModal();
    expect(ui.get().modal).toBeNull();
    openModal('settings');
    expect(ui.get().modal).toBe('settings');
    toggleModal('settings');
    expect(ui.get().modal).toBeNull();
    toggleModal('about');
    expect(ui.get().modal).toBe('about');
    toggleModal('settings');
    expect(ui.get().modal).toBe('settings');
  });
});
