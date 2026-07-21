import { useMemo, useState } from "react";
import type { ProjectSummary } from "./ProjectPicker";
import type { ExportPoint } from "./exportPoints";
import { exportSelectedPoints, safeFilename } from "./exportPoints";
import { coordinateOptionsForLocation, unitsLabel } from "./survey";
import "./SurveyModals.css";

export function CoordinateSettingsModal({
  project,
  onClose,
  onSave,
}: {
  project: ProjectSummary;
  onClose: () => void;
  onSave: (values: {
    coordinateSystemEpsg: string;
    coordinateSystemName: string;
    coordinateUnits: string;
    coordinateSystemConfirmed: boolean;
    verticalDatum?: string;
    elevationUnits: string;
  }) => Promise<void>;
}) {
  const options = useMemo(() => coordinateOptionsForLocation(project.lat, project.lng), [project.lat, project.lng]);
  const initial = options.some((option) => option.epsg === project.coordinateSystemEpsg)
    ? project.coordinateSystemEpsg!
    : options.find((option) => option.recommended)?.epsg ?? options[0]?.epsg ?? "";
  const [epsg, setEpsg] = useState(initial);
  const [verticalDatum, setVerticalDatum] = useState(project.verticalDatum ?? "");
  const [elevationUnits, setElevationUnits] = useState(project.elevationUnits ?? "us-ft");
  const [confirmed, setConfirmed] = useState(project.coordinateSystemConfirmed && epsg === project.coordinateSystemEpsg);
  const [busy, setBusy] = useState(false);
  const selected = options.find((option) => option.epsg === epsg);

  async function save() {
    if (!selected || !confirmed) return;
    setBusy(true);
    try {
      await onSave({
        coordinateSystemEpsg: selected.epsg,
        coordinateSystemName: selected.name,
        coordinateUnits: selected.units,
        coordinateSystemConfirmed: true,
        verticalDatum: verticalDatum.trim() || undefined,
        elevationUnits,
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="attr-overlay" onClick={onClose}>
      <div className="attr-window survey-modal" onClick={(event) => event.stopPropagation()}>
        <div className="attr-window-header">
          <div>
            <h2>Coordinate settings</h2>
            <p>{project.name}</p>
          </div>
          <button className="attr-close" onClick={onClose} disabled={busy} aria-label="Close">×</button>
        </div>

        <div className="survey-notice">
          The recommendation uses the project location. Confirm it matches the coordinate system in the Civil 3D drawing.
        </div>
        <label>
          Coordinate system
          <select value={epsg} onChange={(event) => { setEpsg(event.target.value); setConfirmed(false); }}>
            {options.map((option) => (
              <option key={option.epsg} value={option.epsg}>
                {option.recommended ? "Recommended — " : ""}{option.name} (EPSG:{option.epsg})
              </option>
            ))}
          </select>
        </label>
        <div className="survey-system-summary">
          <span>EPSG:{selected?.epsg}</span>
          <span>{unitsLabel(selected?.units)}</span>
        </div>
        <label>
          Vertical datum (optional)
          <input value={verticalDatum} onChange={(event) => setVerticalDatum(event.target.value)} placeholder="e.g. NAVD88" />
        </label>
        <label>
          Elevation units
          <select value={elevationUnits} onChange={(event) => setElevationUnits(event.target.value)}>
            <option value="us-ft">US survey feet</option>
            <option value="m">Meters</option>
          </select>
        </label>
        <label className="survey-confirm">
          <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />
          I confirm this is the coordinate system used by the project drawing.
        </label>
        <div className="attr-actions">
          <button className="btn btn-secondary" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn btn-primary" onClick={save} disabled={busy || !confirmed || !selected}>
            {busy ? "Saving…" : "Save settings"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function ExportPointsModal({
  project,
  points,
  onClose,
}: {
  project: ProjectSummary;
  points: ExportPoint[];
  onClose: () => void;
}) {
  const [filename, setFilename] = useState(`${safeFilename(project.name)}-points`);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function runExport() {
    setBusy(true);
    setError("");
    try {
      await exportSelectedPoints({ project, points, filename });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="attr-overlay" onClick={onClose}>
      <div className="attr-window survey-modal export-modal" onClick={(event) => event.stopPropagation()}>
        <div className="attr-window-header">
          <div>
            <h2>Export selected points</h2>
            <p>{points.length} point{points.length === 1 ? "" : "s"} selected</p>
          </div>
          <button className="attr-close" onClick={onClose} disabled={busy} aria-label="Close">×</button>
        </div>
        <label>
          File name
          <input value={filename} onChange={(event) => setFilename(event.target.value)} />
        </label>
        <div className="survey-export-facts">
          <div><span>Coordinate system</span><strong>EPSG:{project.coordinateSystemEpsg}</strong></div>
          <div><span>System</span><strong>{project.coordinateSystemName}</strong></div>
          <div><span>Units</span><strong>{unitsLabel(project.coordinateUnits)}</strong></div>
          <div><span>Files</span><strong>CSV + PNEZD</strong></div>
        </div>
        <p className="export-help">The ZIP includes points.csv (Date, Name, X, Y, Z) and a headerless points-pnezd.csv for Civil 3D.</p>
        {error && <div className="survey-error" role="alert">{error}</div>}
        <div className="attr-actions">
          <button className="btn btn-secondary" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn btn-primary" onClick={runExport} disabled={busy || !filename.trim()}>
            {busy ? "Preparing download…" : "Export ZIP"}
          </button>
        </div>
      </div>
    </div>
  );
}
