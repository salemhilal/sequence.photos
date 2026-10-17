import { Menu, MenuItem, PredefinedMenuItem, Submenu } from '@tauri-apps/api/menu';
import { openUrl } from '@tauri-apps/plugin-opener';
import { REPO_URL } from '../../config';
import { commandTitle, runFromMenu, shortcutAccelerator, type CommandId } from '../../commands';
import { isTextField } from '../../input';
import { projectStore } from '../../store';
import { ui } from '../../ui';
import { TERMS } from '../../units';
import { quit } from './documents';

/**
 * The Mac app's menu bar, built from the command table (so it always matches the
 * shortcuts), with the standard macOS items around it.
 */

/** Menu bar items are in title case ("Add Photos…"); commands are named in sentence case. */
const SMALL_WORDS = new Set(['a', 'an', 'and', 'for', 'in', 'of', 'on', 'or', 'the', 'to', 'with']);
export function titleCase(s: string): string {
  return s
    .split(' ')
    .map((w, i) => (i > 0 && SMALL_WORDS.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ');
}

/** A menu item for a command; `textFallback` edits the focused text field instead, when there is one. */
function command(id: CommandId, textFallback?: () => void, text = titleCase(commandTitle(id))) {
  return MenuItem.new({
    id,
    text,
    accelerator: shortcutAccelerator(id),
    action: () => void runFromMenu(id, textFallback),
  });
}

const separator = () => PredefinedMenuItem.new({ item: 'Separator' });
const predefined = (item: 'Cut' | 'Copy' | 'Paste' | 'Minimize' | 'Maximize' | 'Fullscreen') =>
  PredefinedMenuItem.new({ item });
// Text fields' own editing, for menu shortcuts typed in them.
const inField = (cmd: 'undo' | 'redo' | 'selectAll') => () => void document.execCommand(cmd);

export async function setUpMenu(): Promise<void> {
  const undo = await command('undo', inField('undo'));
  const redo = await command('redo', inField('redo'));
  // Its wording follows the sidebar (see sync below).
  const sidebar = await command('toggleSidebar', undefined, 'Hide Spreads');
  const guides = await command('toggleGuides', undefined, 'Hide Guides');
  // For print books and digital sequences respectively (see sync below).
  const indesign = await command('exportIndesign');
  const images = await command('exportFrames');

  const menu = await Menu.new({
    items: [
      // macOS titles the first menu with the app's name.
      await Submenu.new({
        text: 'Sequence',
        items: [
          await command('about'),
          await separator(),
          await command('settings'),
          await separator(),
          await PredefinedMenuItem.new({ item: 'Services' }),
          await separator(),
          await PredefinedMenuItem.new({ item: 'Hide', text: 'Hide Sequence' }),
          await PredefinedMenuItem.new({ item: 'HideOthers' }),
          await PredefinedMenuItem.new({ item: 'ShowAll' }),
          await separator(),
          // Not the standard Quit, so unsaved changes get the chance to be saved.
          await MenuItem.new({ text: 'Quit Sequence', accelerator: 'CmdOrCtrl+Q', action: quit }),
        ],
      }),
      await Submenu.new({
        text: 'File',
        items: [
          await command('newProject'),
          await command('importProject'),
          await separator(),
          await command('addPhotos'),
          await separator(),
          await PredefinedMenuItem.new({ item: 'CloseWindow' }),
          await command('exportProject'),
          await command('saveAs'),
          await separator(),
          await command('savePdf'),
          indesign,
          images,
        ],
      }),
      await Submenu.new({
        text: 'Edit',
        items: [
          undo,
          redo,
          await separator(),
          // Native, so they work in text fields; on the desk, the page handles ⌘C and ⌘V itself.
          await predefined('Cut'),
          await predefined('Copy'),
          await predefined('Paste'),
          await command('duplicate'),
          await command('deleteSelection'),
          await separator(),
          await command('selectAll', inField('selectAll')),
        ],
      }),
      await Submenu.new({
        text: 'View',
        items: [
          await command('preview'),
          await command('layout'),
          guides,
          sidebar,
          await separator(),
          await predefined('Fullscreen'),
        ],
      }),
      await Submenu.new({
        text: 'Window',
        items: [await predefined('Minimize'), await predefined('Maximize')],
      }),
      await Submenu.new({
        text: 'Help',
        items: [
          await command('tour'),
          await MenuItem.new({ text: 'Sequence on GitHub', action: () => void openUrl(REPO_URL) }),
        ],
      }),
    ],
  });
  await menu.setAsAppMenu();

  // Keep items that depend on state in step with it, updating only what changed. Undo
  // and Redo stay enabled in text fields, where they undo typing.
  let shown = '';
  const sync = () => {
    const { canUndo, canRedo } = projectStore.getSnapshot();
    const typing = isTextField(document.activeElement);
    const { sidebarOpen, guidesHidden } = ui.get();
    const layout = projectStore.project.layout.kind;
    const state = {
      undo: canUndo || typing,
      redo: canRedo || typing,
      sidebar: sidebarOpen,
      guides: !guidesHidden,
      layout,
    };
    const key = JSON.stringify(state);
    if (key === shown) return;
    shown = key;
    void undo.setEnabled(state.undo);
    void redo.setEnabled(state.redo);
    void sidebar.setText(`${state.sidebar ? 'Hide' : 'Show'} ${TERMS[state.layout].Spreads}`);
    void guides.setText(state.guides ? 'Hide Guides' : 'Show Guides');
    void indesign.setEnabled(state.layout === 'print');
    void images.setEnabled(state.layout === 'digital');
  };
  sync();
  projectStore.subscribe(sync);
  ui.subscribe(sync);
  document.addEventListener('focusin', sync);
  document.addEventListener('focusout', () => setTimeout(sync));

  // Edit → Copy clicked with photos selected: copy them (⌘C is handled by the page itself).
  document.addEventListener('copy', (e) => {
    if (isTextField(document.activeElement) || !ui.get().selection.length) return;
    e.preventDefault();
    runFromMenu('copy');
  });
}
