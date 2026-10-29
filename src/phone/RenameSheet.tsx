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
      left={
        <button className="btn" onClick={onCancel}>
          Cancel
        </button>
      }
      right={
        <button className="btn" style={{ fontWeight: 600 }} onClick={() => onDone(value)}>
          Done
        </button>
      }
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
