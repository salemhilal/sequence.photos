import type { ReactNode } from 'react';
import { commandTitle, runCommand, shortcutLabel, type CommandId } from '../commands';
import { ui } from '../ui';
import type { MenuItem } from './Menu';

/** A menu item running a command, disabled (by default) while the app is busy. */
export function useCommandItem(): (id: CommandId, icon: ReactNode, disabled?: boolean) => MenuItem {
  const working = ui.use((s) => s.importing !== null || s.busy !== null);
  return (id, icon, disabled = working) => ({
    label: commandTitle(id),
    icon,
    shortcut: shortcutLabel(id),
    disabled,
    onSelect: () => runCommand(id),
  });
}
