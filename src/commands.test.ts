import { describe, expect, it } from 'vitest';
import { commands, commandTitle, shortcutAccelerator, shortcutLabel } from './commands';
import { titleCase } from './platform/macos/menu';
import { isMac } from './input';

describe('commands', () => {
  it('never bind the same key combination twice', () => {
    const seen = new Map<string, string>();
    for (const [id, c] of Object.entries(commands)) {
      for (const b of c.bindings) {
        const shifts = 'shift' in b && b.shift === 'any' ? [true, false] : ['shift' in b && b.shift === true];
        for (const shift of shifts) {
          const combo = `${'mod' in b && b.mod ? 'mod+' : ''}${shift ? 'shift+' : ''}${b.key}`;
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
    expect(commandTitle('exportProject')).toBe('Export project');
    expect(commandTitle('importProject')).toBe('Import project…');
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
