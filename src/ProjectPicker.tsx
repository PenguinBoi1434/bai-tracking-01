import { useEffect, useMemo, useState } from "react";
import { generateClient } from "aws-amplify/data";
import type { Schema } from "../amplify/data/resource";
import MapPicker from "./MapPicker";
import "./ProjectPicker.css";

const client = generateClient<Schema>();

export type Role = "master" | "worker" | "field_worker";

export interface ProjectSummary {
  id: string;
  name: string;
  lat: number;
  lng: number;
  zoom: number | null;
}

interface ProjectPickerProps {
  role: Role;
  /** Comma-separated project IDs the user may access (from the Cognito token). Empty for masters. */
  allowedProjectIds: string[];
  userEmail: string;
  onSignOut: () => void;
  onChoose: (project: ProjectSummary) => void;
}

const DEFAULT_PROJECT_ZOOM = 14;

export default function ProjectPicker({ role, allowedProjectIds, userEmail, onSignOut, onChoose }: ProjectPickerProps) {
  const [projects, setProjects] = useState<Schema["Project"]["type"][]>([]);
  const [loading, setLoading] = useState(true);

  // ── Create-project modal (masters only) ──
  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createLat, setCreateLat] = useState("");
  const [createLng, setCreateLng] = useState("");
  const [createBusy, setCreateBusy] = useState(false);

  async function fetchProjects() {
    setLoading(true);
    const { data, errors } = await client.models.Project.list();
    if (!errors) setProjects(data);
    setLoading(false);
  }

  useEffect(() => {
    fetchProjects();
  }, []);

  /** Role-aware filtering: masters see everything; workers/field workers see only granted IDs. */
  const visibleProjects = useMemo<ProjectSummary[]>(() => {
    const mapped = projects.map((p) => ({
      id: p.id,
      name: p.name,
      lat: p.lat,
      lng: p.lng,
      zoom: p.zoom ?? null,
    }));
    if (role === "master") return mapped;
    return mapped.filter((p) => allowedProjectIds.includes(p.id));
  }, [projects, role, allowedProjectIds]);

  function handleCreateCoordChange(lat: string, lng: string) {
    setCreateLat(lat);
    setCreateLng(lng);
  }

  async function handleCreateSubmit() {
    if (!createName.trim() || !createLat || !createLng) return;
    setCreateBusy(true);
    try {
      await client.models.Project.create({
        name: createName.trim(),
        lat: parseFloat(createLat),
        lng: parseFloat(createLng),
        zoom: DEFAULT_PROJECT_ZOOM,
      });
      setCreateOpen(false);
      setCreateName("");
      setCreateLat("");
      setCreateLng("");
      await fetchProjects();
    } finally {
      setCreateBusy(false);
    }
  }

  return (
    <div className="project-picker">
      <header className="header">
        <div className="header-left">
          <img src="/bai-engineers-logo.png" alt="Bai Engineers" className="header-logo" />
          <h1>Point Tracker</h1>
        </div>
        <div className="header-user">
          <span className="header-email">{userEmail}</span>
          <button className="btn btn-secondary btn-small" onClick={onSignOut}>
            Sign out
          </button>
        </div>
      </header>

      <main className="project-picker-main">
        <div className="project-picker-head">
          <h2>Choose a project</h2>
          {role === "master" && (
            <button className="btn btn-primary btn-small" onClick={() => setCreateOpen(true)}>
              + New project
            </button>
          )}
        </div>

        {loading ? (
          <p className="project-picker-empty">Loading projects…</p>
        ) : visibleProjects.length === 0 ? (
          <p className="project-picker-empty">
            No projects assigned to you yet.
            {role !== "master" && " Ask an administrator to grant you access to a project."}
          </p>
        ) : (
          <div className="project-grid">
            {visibleProjects.map((p) => (
              <button
                key={p.id}
                className="project-card"
                onClick={() => onChoose(p)}
                title={`Open ${p.name}`}
              >
                <div className="project-card-pin" aria-hidden="true">📍</div>
                <div className="project-card-name">{p.name}</div>
                <div className="project-card-coords">
                  {p.lat.toFixed(4)}, {p.lng.toFixed(4)}
                </div>
              </button>
            ))}
          </div>
        )}
      </main>

      {createOpen && (
        <div className="attr-overlay" onClick={() => setCreateOpen(false)}>
          <div className="attr-window" onClick={(e) => e.stopPropagation()}>
            <h3>New project</h3>
            <label>
              Name
              <input
                type="text"
                value={createName}
                onChange={(e) => setCreateName(e.target.value)}
                placeholder="e.g. Bent, NM"
                autoFocus
              />
            </label>
            <div className="mini-map-wrap">
              <MapPicker
                lat={createLat}
                lng={createLng}
                points={[]}
                onCoordChange={handleCreateCoordChange}
                onMarkerCancel={() => { setCreateLat(""); setCreateLng(""); }}
              />
            </div>
            <p className="project-create-hint">
              {createLat && createLng
                ? `Center: ${createLat}, ${createLng}`
                : "Click the map to set the project's center."}
            </p>
            <div className="attr-actions">
              <button className="btn btn-secondary" onClick={() => setCreateOpen(false)} disabled={createBusy}>
                Cancel
              </button>
              <button
                className="btn btn-primary"
                onClick={handleCreateSubmit}
                disabled={createBusy || !createName.trim() || !createLat || !createLng}
              >
                {createBusy ? "Creating…" : "Create project"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
