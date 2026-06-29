import { useStore } from '../state/store';
import type { Settings } from '../types';

function NumberField({
  label,
  unit,
  value,
  step = 0.1,
  min = 0.1,
  onChange,
}: {
  label: string;
  unit?: string;
  value: number;
  step?: number;
  min?: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <span className="input-wrap">
        <input
          type="number"
          value={value}
          step={step}
          min={min}
          onChange={(e) => {
            const v = parseFloat(e.target.value);
            if (!Number.isNaN(v)) onChange(v);
          }}
        />
        {unit && <em>{unit}</em>}
      </span>
    </label>
  );
}

export default function ControlsPanel() {
  const {
    partName,
    partGeom,
    shellGeom,
    features,
    settings,
    mode,
    busy,
    selectedId,
    openPart,
    generateShell,
    setMode,
    updateSettings,
    removeFeature,
    selectFeature,
    clearFeatures,
    bakeAndSave,
    showPart,
    setShowPart,
  } = useStore();

  const set = (patch: Partial<Settings>) => updateSettings(patch);
  const ventCount = features.filter((f) => f.type === 'vent').length;
  const fillCount = features.filter((f) => f.type === 'fill').length;
  const disabled = !!busy;

  return (
    <aside className="panel">
      <header className="panel-head">
        <h1>Eggshell&nbsp;Mold&nbsp;Maker</h1>
        <span className="sub">STL in · watertight STL out · mm</span>
      </header>

      <section>
        <h2>1 · Part</h2>
        <button className="primary" onClick={openPart} disabled={disabled}>
          Open egg STL…
        </button>
        {partName && <p className="meta">Loaded: {partName}</p>}
      </section>

      <section>
        <h2>2 · Shell</h2>
        <NumberField
          label="Wall thickness"
          unit="mm"
          value={settings.thickness}
          step={0.25}
          onChange={(v) => set({ thickness: v })}
        />
        <NumberField
          label="Mesh detail (edge)"
          unit="mm"
          value={settings.edgeLength}
          step={0.25}
          onChange={(v) => set({ edgeLength: v })}
        />
        <p className="hint">Lower edge = finer shell, slower. Start ~1mm.</p>
        <button
          className="primary"
          onClick={generateShell}
          disabled={disabled || !partGeom}
        >
          Generate shell
        </button>
        {shellGeom && partGeom && (
          <label className="checkbox">
            <input
              type="checkbox"
              checked={showPart}
              onChange={(e) => setShowPart(e.target.checked)}
            />
            Show part ghost
          </label>
        )}
      </section>

      <section>
        <h2>3 · Place ports</h2>
        <div className="tool-row">
          <button
            className={mode === 'vent' ? 'tool active' : 'tool'}
            onClick={() => setMode('vent')}
            disabled={disabled || !shellGeom}
          >
            ● Vent ({ventCount})
          </button>
          <button
            className={mode === 'fill' ? 'tool active' : 'tool'}
            onClick={() => setMode('fill')}
            disabled={disabled || !shellGeom}
          >
            ▲ Fill port ({fillCount})
          </button>
        </div>
        <p className="hint">
          {mode === 'idle'
            ? 'Pick a tool, then click the shell surface.'
            : `Click the shell to drop a ${mode === 'vent' ? 'vent' : 'fill port'}. Right-click a marker to delete.`}
        </p>

        <details open>
          <summary>Vent settings</summary>
          <NumberField
            label="Vent Ø"
            unit="mm"
            value={settings.ventDia}
            step={0.25}
            onChange={(v) => set({ ventDia: v })}
          />
        </details>
        <details open>
          <summary>Fill-port settings</summary>
          <NumberField
            label="Bore Ø"
            unit="mm"
            value={settings.boreDia}
            step={0.25}
            onChange={(v) => set({ boreDia: v })}
          />
          <NumberField
            label="Funnel base Ø"
            unit="mm"
            value={settings.funnelBaseDia}
            step={0.5}
            onChange={(v) => set({ funnelBaseDia: v })}
          />
          <NumberField
            label="Funnel top Ø"
            unit="mm"
            value={settings.funnelTopDia}
            step={0.5}
            onChange={(v) => set({ funnelTopDia: v })}
          />
          <NumberField
            label="Funnel height"
            unit="mm"
            value={settings.funnelHeight}
            step={0.5}
            onChange={(v) => set({ funnelHeight: v })}
          />
        </details>

        {features.length > 0 && (
          <div className="feature-list">
            <div className="feature-list-head">
              <span>{features.length} feature(s)</span>
              <button className="link" onClick={clearFeatures} disabled={disabled}>
                clear all
              </button>
            </div>
            <ul>
              {features.map((f, i) => (
                <li
                  key={f.id}
                  className={f.id === selectedId ? 'sel' : ''}
                  onClick={() => selectFeature(f.id)}
                >
                  <span className={`dot ${f.type}`} />
                  {f.type === 'vent' ? 'Vent' : 'Fill'} #{i + 1}
                  <em>{f.wallThickness.toFixed(1)}mm wall</em>
                  <button
                    className="del"
                    onClick={(e) => {
                      e.stopPropagation();
                      removeFeature(f.id);
                    }}
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <section>
        <h2>4 · Export</h2>
        <button
          className="primary export"
          onClick={bakeAndSave}
          disabled={disabled || !shellGeom}
        >
          Bake &amp; Save mold STL
        </button>
        <p className="hint">Booleans are baked once, here, into one watertight STL.</p>
      </section>

      <footer className="panel-foot">
        Vents ≈ resin drain points · put them at the high spots.
      </footer>
    </aside>
  );
}
