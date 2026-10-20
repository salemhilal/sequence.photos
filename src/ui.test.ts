import { afterEach, describe, expect, it } from 'vitest';
import { closeModal, goToPage, lockPage, pageLocked, openModal, setCloseGuard, toggleModal, ui } from './ui';

afterEach(() => {
  lockPage(false);
  setCloseGuard(null);
  ui.set({ page: 'desk', modal: null });
});

describe('lockPage', () => {
  it('keeps the page and dialog as they are while locked', () => {
    goToPage('export');
    lockPage(true);
    expect(pageLocked()).toBe(true);
    goToPage('desk');
    expect(ui.get().page).toBe('export');
    openModal('settings');
    toggleModal('about');
    expect(ui.get().modal).toBeNull();
  });

  it('lets pages change and dialogs open and close again once unlocked', () => {
    goToPage('export');
    lockPage(true);
    lockPage(false);
    expect(pageLocked()).toBe(false);
    goToPage('desk');
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

describe('pages and dialogs', () => {
  it('close any dialog when going to another page', () => {
    openModal('settings');
    goToPage('export');
    expect(ui.get()).toMatchObject({ page: 'export', modal: null });
  });

  it('ask the dialog being closed or replaced first, and go on only when told to', async () => {
    openModal('layout');
    let answer = false;
    setCloseGuard(async () => answer);
    goToPage('export');
    await Promise.resolve();
    expect(ui.get()).toMatchObject({ page: 'desk', modal: 'layout' });
    openModal('settings');
    await Promise.resolve();
    expect(ui.get().modal).toBe('layout');
    answer = true;
    closeModal();
    await Promise.resolve();
    expect(ui.get().modal).toBeNull();
  });
});
