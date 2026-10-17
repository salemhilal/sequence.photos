import { TriangleAlert } from 'lucide-react';

/** A mark on a photo with less detail than the page asks for. */
export function SoftBadge({ note }: { note: string }) {
  return (
    <span className="soft-badge" data-tip={note} role="img" aria-label={note}>
      <TriangleAlert />
    </span>
  );
}
