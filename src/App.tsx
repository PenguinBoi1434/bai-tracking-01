import { useEffect, useState, useCallback, useMemo } from "react";
import { generateClient } from "aws-amplify/data";
import type { Schema } from "../amplify/data/resource";
import MapPicker from "./MapPicker";
import type { PointMarker } from "./MapPicker";
import "./App.css";

const client = generateClient<Schema>();

interface PointFormData {
  date: string;
  time: string;
  location: string;
  lng: string;
  lat: string;
  description: string;
}

const emptyForm: PointFormData = {
  date: "",
  time: "",
  location: "",
  lng: "",
  lat: "",
  description: "",
};

function App() {
  const [points, setPoints] = useState<Schema["Point"]["type"][]>([]);
  const [form, setForm] = useState<PointFormData>(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchPoints();
  }, []);

  async function fetchPoints() {
    setLoading(true);
    const { data: items, errors } = await client.models.Point.list();
    if (!errors) {
      setPoints(items);
    }
    setLoading(false);
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) {
    setForm({ ...form, [e.target.name]: e.target.value });
  }

  const pointMarkers: PointMarker[] = useMemo(
    () => points.map((p) => ({ id: p.id, lat: p.lat, lng: p.lng, location: p.location })),
    [points]
  );

  const handleCoordChange = useCallback((lat: string, lng: string) => {
    setForm((prev) => ({ ...prev, lat, lng }));
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    const payload = {
      date: form.date,
      time: form.time,
      location: form.location,
      lng: parseFloat(form.lng),
      lat: parseFloat(form.lat),
      description: form.description,
    };

    if (editingId) {
      await client.models.Point.update({ id: editingId, ...payload });
    } else {
      await client.models.Point.create(payload);
    }

    setForm(emptyForm);
    setEditingId(null);
    await fetchPoints();
  }

  function handleEdit(point: Schema["Point"]["type"]) {
    setEditingId(point.id);
    setForm({
      date: point.date,
      time: point.time,
      location: point.location,
      lng: String(point.lng),
      lat: String(point.lat),
      description: point.description,
    });
  }

  async function handleDelete(id: string) {
    await client.models.Point.delete({ id });
    if (editingId === id) {
      setForm(emptyForm);
      setEditingId(null);
    }
    await fetchPoints();
  }

  function handleCancel() {
    setForm(emptyForm);
    setEditingId(null);
  }

  return (
    <div className="app">
      <header className="header">
        <h1>📍 Point Tracker</h1>
      </header>

      <main className="main">
        <section className="form-section">
          <h2>{editingId ? "Edit Point" : "Add Point"}</h2>
          <form onSubmit={handleSubmit} className="point-form">
            <div className="form-row">
              <label>
                Date
                <input
                  name="date"
                  type="date"
                  value={form.date}
                  onChange={handleChange}
                  required
                />
              </label>
              <label>
                Time
                <input
                  name="time"
                  type="time"
                  value={form.time}
                  onChange={handleChange}
                  required
                />
              </label>
            </div>

            <label>
              Location
              <input
                name="location"
                type="text"
                placeholder="e.g. Central Park, NYC"
                value={form.location}
                onChange={handleChange}
                required
              />
            </label>

            <label>
              Description
              <textarea
                name="description"
                placeholder="Describe this point..."
                value={form.description}
                onChange={handleChange}
                rows={3}
                required
              />
            </label>

            <div className="form-actions">
              <button type="submit" className="btn btn-primary">
                {editingId ? "Update" : "Create"}
              </button>
              {editingId && (
                <button type="button" className="btn btn-secondary" onClick={handleCancel}>
                  Cancel
                </button>
              )}
            </div>
          </form>
        </section>

        <section className="map-section">
          <MapPicker
            lat={form.lat}
            lng={form.lng}
            points={pointMarkers}
            onCoordChange={handleCoordChange}
          />
        </section>

        <section className="list-section">
          <h2>Points ({points.length})</h2>

          {loading ? (
            <p className="loading">Loading…</p>
          ) : points.length === 0 ? (
            <p className="empty">No points yet. Add one above.</p>
          ) : (
            <div className="point-grid">
              {points.map((p) => (
                <div key={p.id} className="point-card">
                  <div className="point-card-header">
                    <span className="point-date">{p.date}</span>
                    <span className="point-time">{p.time}</span>
                  </div>
                  <h3>{p.location}</h3>
                  <p className="point-coords">
                    {p.lat}, {p.lng}
                  </p>
                  <p className="point-desc">{p.description}</p>
                  <div className="point-card-actions">
                    <button className="btn btn-small btn-edit" onClick={() => handleEdit(p)}>
                      Edit
                    </button>
                    <button className="btn btn-small btn-delete" onClick={() => handleDelete(p.id)}>
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

export default App;
