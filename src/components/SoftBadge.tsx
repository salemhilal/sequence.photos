import { TriangleAlert } from 'lucide-react';

/** A mark on a photo with less detail than the page asks for. */
export function SoftBadge({ note }: { note: string }) {
  return (
    <span className="soft-badge" title={note} aria-label={note}>
      <TriangleAlert />
    </span>
  );
}
