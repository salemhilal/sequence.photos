import { TriangleAlert } from 'lucide-react';

/** A mark on a photo with less detail than the page asks for. Its note shows in the status bar only. */
export function SoftBadge({ note }: { note: string }) {
  return (
    <span className="soft-badge" data-tip={note} data-tip-quiet role="img" aria-label={note}>
      <TriangleAlert />
    </span>
  );
}
