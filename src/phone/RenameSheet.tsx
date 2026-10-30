import { useState } from 'react';
import { Sheet } from './Sheets';

/** Name (or rename) a sequence. */
export function RenameSheet({
  name,
  onDone,
  onCancel,
}: {
  name: string;
  onDone: (name: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(name);
  return (
    <Sheet
      title="Rename"
      onDismiss={onCancel}
      left={(close) => (
        <button className="btn" onClick={() => close()}>
          Cancel
        </button>
      )}
      right={(close) => (
        <button className="btn" style={{ fontWeight: 600 }} onClick={() => close(() => onDone(value))}>
          Done
        </button>
      )}
    >
      <input
        className="text-input"
        aria-label="Name"
        value={value}
        autoFocus
        enterKeyHint="done"
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onDone(value);
        }}
      />
    </Sheet>
  );
}
