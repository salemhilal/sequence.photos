import { Pipette } from 'lucide-react';
import { DESK_PRESETS } from '../deskColor';
import { setDeskColor, ui } from '../ui';

/** Desk background swatches plus a custom color. Used in Settings and the desk menu. */
export function DeskColorPicker() {
  const color = ui.use((s) => s.deskColor);
  const isPreset = DESK_PRESETS.some((p) => p.value === color);
  return (
    <div className="swatches" role="radiogroup" aria-label="Desk color">
      {DESK_PRESETS.map((p) => (
        <button
          key={p.value}
          className={`swatch${color === p.value ? ' on' : ''}`}
          style={{ background: p.value }}
          role="radio"
          aria-checked={color === p.value}
          aria-label={p.label}
          data-tip={p.label}
          onClick={() => setDeskColor(p.value)}
        />
      ))}
      <label
        className={`swatch custom${isPreset ? '' : ' on'}`}
        style={isPreset ? undefined : { background: color }}
        data-tip="Custom color"
      >
        {isPreset && <Pipette />}
        <input
          type="color"
          value={color}
          onChange={(e) => setDeskColor(e.target.value)}
          aria-label="Custom desk color"
        />
      </label>
    </div>
  );
}
