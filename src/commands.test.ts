import { describe, expect, it } from 'vitest';
import { commands, commandTitle, matches, shortcutAccelerator, shortcutLabel } from './commands';
import { titleCase } from './platform/macos/menu';
import { isMac } from './input';

describe('commands', () => {
  it('never bind the same key combination twice', () => {
    const seen = new Map<string, string>();
    for (const [id, c] of Object.entries(commands)) {
      for (const b of c.bindings) {
        const shifts = 'shift' in b && b.shift === 'any' ? [true, false] : ['shift' in b && b.shift === true];
        for (const shift of shifts) {
          const combo = `${'mod' in b && b.mod ? 'mod+' : ''}${'alt' in b && b.alt ? 'alt+' : ''}${shift ? 'shift+' : ''}${b.key}`;
          expect(seen.get(combo), `${combo} is bound by both ${seen.get(combo)} and ${id}`).toBeUndefined();
          seen.set(combo, id);
        }
      }
    }
  });

  it('labels shortcuts for display', () => {
    const labels = ['addPhotos', 'export', 'settings', 'redo', 'about'].map((id) =>
      shortcutLabel(id as keyof typeof commands),
    );
    expect(labels).toEqual(isMac ? ['⌘I', '⇧⌘E', '⌘,', '⇧⌘Z', ''] : ['Ctrl+I', 'Ctrl+Shift+E', 'Ctrl+,', 'Ctrl+Y', '']);
  });

  it('gives menu accelerators for modifier shortcuts, and none for plain keys', () => {
    expect(shortcutAccelerator('addPhotos')).toBe('CmdOrCtrl+I');
    expect(shortcutAccelerator('importProject')).toBe('CmdOrCtrl+O');
    expect(shortcutAccelerator('export')).toBe('CmdOrCtrl+Shift+E');
    expect(shortcutAccelerator('settings')).toBe('CmdOrCtrl+,');
    expect(shortcutAccelerator('deleteSelection')).toBeUndefined();
    expect(shortcutAccelerator('newProject')).toBeUndefined();
  });

  it('names commands for the platform, in sentence case', () => {
    expect(commandTitle('exportProject')).toBe('Save project');
    expect(commandTitle('importProject')).toBe('Open project…');
    expect(commandTitle('addPhotos')).toBe('Add photos…');
  });

  it('gives the website no Save As', () => {
    expect(commands.saveAs.bindings).toEqual([]);
  });

  it('title-cases names for the Mac menu bar', () => {
    expect(titleCase('Add photos…')).toBe('Add Photos…');
    expect(titleCase('Take the tour')).toBe('Take the Tour');
    expect(titleCase('Export for InDesign…')).toBe('Export for InDesign…');
    expect(titleCase('Save as…')).toBe('Save As…');
  });
});

describe('page shortcuts (⌥⌘1–⌥⌘4)', () => {
  // The platform modifier: ⌘ on a Mac, Ctrl elsewhere.
  const mod = isMac ? { metaKey: true, ctrlKey: false } : { metaKey: false, ctrlKey: true };
  const press = (key: string, code: string, extra: Partial<KeyboardEvent> = {}) => ({
    key,
    code,
    altKey: true,
    shiftKey: false,
    ...mod,
    ...extra,
  });
  const layout = commands.layout.bindings[0]!;

  it('match by the key’s position, since Option changes the character it types', () => {
    expect(matches(layout, press('™', 'Digit2'))).toBe(true);
    expect(matches(layout, press('2', 'Digit2'))).toBe(true);
    expect(matches(layout, press('¡', 'Digit1'))).toBe(false);
  });

  it('need both Option and the modifier', () => {
    expect(matches(layout, press('2', 'Digit2', { altKey: false }))).toBe(false);
    expect(matches(layout, press('™', 'Digit2', { metaKey: false, ctrlKey: false }))).toBe(false);
  });

  it('cover the four pages, labeled and in the menus with Option', () => {
    expect(
      ['showDesk', 'layout', 'preview', 'showExport'].map((id) => shortcutLabel(id as keyof typeof commands)),
    ).toEqual(['1', '2', '3', '4'].map((n) => (isMac ? `⌥⌘${n}` : `Ctrl+Alt+${n}`)));
    expect(shortcutAccelerator('showExport')).toBe('CmdOrCtrl+Alt+4');
  });

  it('leave other shortcuts alone when Option is held', () => {
    expect(matches(commands.undo.bindings[0]!, { ...press('z', 'KeyZ'), altKey: true })).toBe(false);
    expect(matches(commands.undo.bindings[0]!, { ...press('z', 'KeyZ'), altKey: false })).toBe(true);
  });
});
