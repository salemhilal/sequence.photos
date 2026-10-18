import { afterEach, describe, expect, it } from 'vitest';
import {
  closeModal,
  goToPage,
  lockModal,
  modalLocked,
  openModal,
  setPageGuard,
  toggleModal,
  togglePage,
  ui,
} from './ui';

afterEach(() => {
  lockModal(false);
  setPageGuard(null);
  ui.set({ page: 'desk', modal: null });
});

describe('lockModal', () => {
  it('keeps the page and dialog as they are while locked', () => {
    goToPage('export');
    lockModal(true);
    expect(modalLocked()).toBe(true);
    goToPage('desk');
    togglePage('export');
    expect(ui.get().page).toBe('export');
    openModal('settings');
    toggleModal('about');
    expect(ui.get().modal).toBeNull();
  });

  it('lets pages change and dialogs open and close again once unlocked', () => {
    goToPage('export');
    lockModal(true);
    lockModal(false);
    expect(modalLocked()).toBe(false);
    togglePage('export');
    expect(ui.get().page).toBe('desk');
    openModal('settings');
    expect(ui.get().modal).toBe('settings');
    toggleModal('settings');
    expect(ui.get().modal).toBeNull();
    toggleModal('about');
    expect(ui.get().modal).toBe('about');
    toggleModal('settings');
    expect(ui.get().modal).toBe('settings');
    closeModal();
    expect(ui.get().modal).toBeNull();
  });
});

describe('pages', () => {
  it('close any dialog when going to another page', () => {
    openModal('settings');
    goToPage('layout');
    expect(ui.get()).toMatchObject({ page: 'layout', modal: null });
  });

  it('ask the page being left first, and go on only when told to', async () => {
    goToPage('layout');
    let answer = false;
    setPageGuard(async () => answer);
    goToPage('export');
    await Promise.resolve();
    expect(ui.get().page).toBe('layout');
    // A dialog over the page doesn't leave it, so it doesn't ask.
    openModal('settings');
    expect(ui.get().modal).toBe('settings');
    answer = true;
    goToPage('desk');
    await Promise.resolve();
    expect(ui.get().page).toBe('desk');
  });
});
