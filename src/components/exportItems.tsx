import type { ReactNode } from 'react';
import { FileText, Images, Package, Send } from 'lucide-react';
import { platform } from '#platform';
import { commandTitle, runCommand, shortcutLabel, type CommandId } from '../commands';
import { useInstagram } from '../instagram';
import { useProject } from '../store';
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

/**
 * The exports, as the File menu and the preview's Export… list them: PDF and images for
 * any project, InDesign for spreads, and Instagram on the web (disabled, saying why, until
 * it's connected).
 */
export function useExportItems(): MenuItem[] {
  const { project } = useProject();
  const instagram = useInstagram();
  const item = useCommandItem();
  const working = ui.use((s) => s.importing !== null || s.busy !== null);
  // (An expired token is caught when posting, which says to reconnect.)
  const instagramBlocked =
    instagram === null
      ? 'Connect Instagram in Settings first.'
      : instagram.needsReconnect
        ? 'Reconnect Instagram in Settings first.'
        : null;
  return [
    item('savePdf', <FileText />),
    item('exportImages', <Images />),
    ...(project.layout.kind === 'spreads' ? [item('exportIndesign', <Package />)] : []),
    ...(platform.kind === 'browser'
      ? [
          {
            ...item('postToInstagram', <Send />, working || instagramBlocked !== null),
            note: instagramBlocked ?? undefined,
          },
        ]
      : []),
  ];
}
