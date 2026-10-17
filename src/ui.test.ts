import { afterEach, describe, expect, it } from 'vitest';
import { closeModal, lockModal, modalLocked, openModal, toggleModal, ui } from './ui';

afterEach(() => {
  lockModal(false);
  ui.set({ modal: null });
});

describe('lockModal', () => {
  it('keeps the open dialog open, and nothing else opening, while locked', () => {
    openModal('export');
    lockModal(true);
    expect(modalLocked()).toBe(true);
    closeModal();
    expect(ui.get().modal).toBe('export');
    openModal('settings');
    expect(ui.get().modal).toBe('export');
    toggleModal('export');
    expect(ui.get().modal).toBe('export');
    toggleModal('about');
    expect(ui.get().modal).toBe('export');
  });

  it('lets dialogs open and close again once unlocked', () => {
    openModal('export');
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
