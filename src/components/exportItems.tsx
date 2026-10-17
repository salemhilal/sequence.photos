import type { ReactNode } from 'react';
import { Upload } from 'lucide-react';
import { commandTitle, runCommand, shortcutLabel, type CommandId } from '../commands';
import { ui } from '../ui';
import type { MenuItem } from './FileMenu';

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

/** The File menu's way out: Export…, which opens the Export view. */
export function useExportItems(): MenuItem[] {
  const item = useCommandItem();
  return [item('export', <Upload />)];
}
