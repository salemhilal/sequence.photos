import { shortcutLabel, type CommandId } from '../commands';
import { goToPage, ui, type Page } from '../ui';

const PAGES: { page: Page; label: string; command: CommandId; tip: string }[] = [
  { page: 'desk', label: 'Desk', command: 'showDesk', tip: 'Arrange photos and sequence them' },
  { page: 'layout', label: 'Layout', command: 'layout', tip: 'The page size and guides' },
  { page: 'preview', label: 'Preview', command: 'preview', tip: 'See it as it will look' },
  { page: 'export', label: 'Export', command: 'showExport', tip: 'Make a PDF, images, an InDesign file, or a post' },
];

/** The toolbar's switch between the window's pages, as Resolve's page bar. */
export function PageSwitcher() {
  const page = ui.use((s) => s.page);
  return (
    <nav className="page-switcher" aria-label="Pages">
      {PAGES.map((p) => {
        const key = shortcutLabel(p.command);
        return (
          <button
            key={p.page}
            className={page === p.page ? 'on' : ''}
            aria-current={page === p.page ? 'page' : undefined}
            data-tour={p.page === 'desk' ? undefined : p.page}
            data-tip={key ? `${p.tip} (${key})` : p.tip}
            data-shortcut={key || undefined}
            onClick={() => goToPage(p.page)}
          >
            {p.label}
          </button>
        );
      })}
    </nav>
  );
}
