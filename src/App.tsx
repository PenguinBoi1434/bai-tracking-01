import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { useAuthenticator } from "@aws-amplify/ui-react";
import { generateClient } from "aws-amplify/data";
import { uploadData, getUrl, remove } from "aws-amplify/storage";
import type { Schema } from "../amplify/data/resource";
import MapPicker from "./MapPicker";
import type { PointMarker, FocusTarget } from "./MapPicker";
import "./App.css";

const client = generateClient<Schema>();

const VIDEO_RE = /\.(mp4|mov|webm|avi|mkv|m4v|ogv)$/i;
function isVideoKey(key: string): boolean {
  return VIDEO_RE.test(key);
}

/** Recover the original filename from a stored key like ".../<ts>-<i>-<name>". */
function filenameFromKey(key: string): string {
  const last = key.split("/").pop() ?? "download";
  return last.replace(/^\d+-(\d+-)?/, "");
}

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
  const { user, signOut } = useAuthenticator((context) => [context.user]);
  const [points, setPoints] = useState<Schema["Point"]["type"][]>([]);
  const [form, setForm] = useState<PointFormData>(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [focusTarget, setFocusTarget] = useState<FocusTarget | null>(null);

  function zoomToPoint(p: { lat: number; lng: number }) {
    setFocusTarget({ lat: p.lat, lng: p.lng, nonce: Date.now() });
  }

  // ── Attribute editor (opened by clicking a point on the map) ──
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<PointFormData>(emptyForm);
  const [detailPhotos, setDetailPhotos] = useState<string[]>([]);
  const [photoUrls, setPhotoUrls] = useState<Record<string, string>>({});
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [uploadMsg, setUploadMsg] = useState<{ ok: boolean; text: string } | null>(
    null
  );
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const photoInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetchPoints();
  }, []);

  // Resolve S3 keys to viewable URLs whenever the selected point's photos change.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const entries = await Promise.all(
        detailPhotos.map(async (key) => {
          const { url } = await getUrl({ path: key });
          return [key, url.toString()] as const;
        })
      );
      if (!cancelled) setPhotoUrls(Object.fromEntries(entries));
    })();
    return () => {
      cancelled = true;
    };
  }, [detailPhotos]);

  // Keyboard controls for the full-size photo lightbox.
  useEffect(() => {
    if (lightboxIndex === null) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setLightboxIndex(null);
      else if (e.key === "ArrowLeft") lightboxPrev();
      else if (e.key === "ArrowRight") lightboxNext();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lightboxIndex, detailPhotos.length]);

  const selectedPoint = useMemo(
    () => points.find((p) => p.id === selectedId) ?? null,
    [points, selectedId]
  );

  function openDetail(id: string) {
    const point = points.find((p) => p.id === id);
    if (!point) return;
    setSelectedId(id);
    setDetail({
      date: point.date,
      time: point.time ?? "",
      location: point.location ?? "",
      lng: String(point.lng),
      lat: String(point.lat),
      description: point.description ?? "",
    });
    setDetailPhotos((point.photos ?? []).filter((p): p is string => !!p));
    setPendingFiles([]);
    setUploadMsg(null);
  }

  function closeDetail() {
    setSelectedId(null);
    setDetailPhotos([]);
    setPhotoUrls({});
    setPendingFiles([]);
    setUploadMsg(null);
    setLightboxIndex(null);
  }

  function lightboxPrev() {
    setLightboxIndex((cur) =>
      cur === null ? null : (cur - 1 + detailPhotos.length) % detailPhotos.length
    );
  }

  function lightboxNext() {
    setLightboxIndex((cur) =>
      cur === null ? null : (cur + 1) % detailPhotos.length
    );
  }

  async function handleDownload() {
    if (lightboxIndex === null) return;
    const key = detailPhotos[lightboxIndex];
    const url = photoUrls[key];
    if (!url) return;
    setBusy(true);
    try {
      const res = await fetch(url);
      const blob = await res.blob();
      const suggestedName = filenameFromKey(key);

      // Preferred: native "Save As" dialog so the user picks name + location
      // (Chromium browsers). Falls through to a normal download otherwise.
      const picker = (
        window as unknown as {
          showSaveFilePicker?: (opts?: {
            suggestedName?: string;
          }) => Promise<{
            createWritable: () => Promise<{
              write: (data: Blob) => Promise<void>;
              close: () => Promise<void>;
            }>;
          }>;
        }
      ).showSaveFilePicker;

      if (picker) {
        try {
          const handle = await picker({ suggestedName });
          const writable = await handle.createWritable();
          await writable.write(blob);
          await writable.close();
          return;
        } catch (err) {
          if ((err as DOMException)?.name === "AbortError") return; // user cancelled
          console.warn("Save picker failed, falling back to download:", err);
        }
      }

      // Fallback: triggers a normal download to the browser's default location.
      const objUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objUrl;
      a.download = suggestedName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(objUrl);
    } catch (err) {
      // Last resort: open the file in a new tab if a direct download fails.
      console.error("Download failed, opening in new tab:", err);
      window.open(url, "_blank", "noopener");
    } finally {
      setBusy(false);
    }
  }

  async function handleLightboxDelete() {
    if (lightboxIndex === null) return;
    const key = detailPhotos[lightboxIndex];
    const remaining = detailPhotos.length - 1;
    setBusy(true);
    await remove({ path: key }).catch(() => {});
    setDetailPhotos((prev) => prev.filter((k) => k !== key));
    setBusy(false);
    setLightboxIndex(remaining <= 0 ? null : Math.min(lightboxIndex, remaining - 1));
  }

  function handleDetailChange(
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
  ) {
    setDetail({ ...detail, [e.target.name]: e.target.value });
  }

  async function handleApply() {
    if (!selectedId) return;
    setBusy(true);
    await client.models.Point.update({
      id: selectedId,
      date: detail.date,
      time: detail.time,
      location: detail.location,
      description: detail.description,
      photos: detailPhotos,
    });
    setBusy(false);
    closeDetail();
    await fetchPoints();
  }

  async function handleDeleteSelected() {
    if (!selectedId) return;
    setBusy(true);
    // Remove the point's photos from storage, then the record itself.
    await Promise.all(detailPhotos.map((path) => remove({ path }).catch(() => {})));
    await client.models.Point.delete({ id: selectedId });
    setBusy(false);
    closeDetail();
    await fetchPoints();
  }

  function handlePhotosPicked(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = ""; // allow re-selecting the same file later
    if (files.length === 0) return;
    setPendingFiles((prev) => [...prev, ...files]);
    setUploadMsg(null);
  }

  function handleRemovePending(index: number) {
    setPendingFiles((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleUpload() {
    if (!selectedId || pendingFiles.length === 0) return;
    setBusy(true);
    setUploadMsg(null);
    try {
      const newKeys: string[] = [];
      for (let i = 0; i < pendingFiles.length; i++) {
        const file = pendingFiles[i];
        const key = `point-photos/${selectedId}/${Date.now()}-${i}-${file.name}`;
        await uploadData({ path: key, data: file }).result;
        newKeys.push(key);
      }
      const count = newKeys.length;
      setDetailPhotos((prev) => [...prev, ...newKeys]);
      setPendingFiles([]);
      setUploadMsg({
        ok: true,
        text: `${count} photo${count > 1 ? "s" : ""} uploaded successfully.`,
      });
    } catch (err) {
      console.error("Photo upload failed:", err);
      setUploadMsg({
        ok: false,
        text: `Upload failed: ${err instanceof Error ? err.message : String(err)}`,
      });
    } finally {
      setBusy(false);
    }
  }

  async function handleRemovePhoto(key: string) {
    setBusy(true);
    await remove({ path: key }).catch(() => {});
    setDetailPhotos((prev) => prev.filter((k) => k !== key));
    setBusy(false);
  }

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

    let lat = parseFloat(form.lat);
    let lng = parseFloat(form.lng);

    if (!form.lat || !form.lng || isNaN(lat) || isNaN(lng)) {
      const useGPS = window.confirm(
        "No location set on the map. Use your current GPS location?"
      );
      if (useGPS) {
        try {
          const pos = await new Promise<GeolocationPosition>((resolve, reject) =>
            navigator.geolocation.getCurrentPosition(resolve, reject)
          );
          lat = pos.coords.latitude;
          lng = pos.coords.longitude;
          setForm((prev) => ({ ...prev, lat: String(lat), lng: String(lng) }));
        } catch {
          alert("Could not get your location. Please click the map to set a point.");
          return;
        }
      } else {
        return;
      }
    }

    const payload = {
      date: form.date,
      time: form.time,
      location: form.location,
      lng,
      lat,
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
      time: point.time ?? "",
      location: point.location ?? "",
      lng: String(point.lng),
      lat: String(point.lat),
      description: point.description ?? "",
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
        <div className="header-left">
          <img src="/bai-engineers-logo.png" alt="Bai Engineers" className="header-logo" />
          <h1>Point Tracker</h1>
        </div>
        <div className="header-user">
          <span className="header-email">{user?.signInDetails?.loginId}</span>
          <button className="btn btn-secondary btn-small" onClick={signOut}>
            Sign out
          </button>
        </div>
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
              <label className="field-wide">
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
              <label className="field-wide">
                Description
                <input
                  name="description"
                  type="text"
                  placeholder="Describe this point..."
                  value={form.description}
                  onChange={handleChange}
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
            </div>
          </form>
        </section>

        <section className="map-section">
          <MapPicker
            lat={form.lat}
            lng={form.lng}
            points={pointMarkers}
            onCoordChange={handleCoordChange}
            onPointSelect={openDetail}
            focusTarget={focusTarget}
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
                  <p className="point-desc">{p.description}</p>
                  <div className="point-card-actions">
                    <button className="btn btn-small btn-zoom" onClick={() => zoomToPoint(p)}>
                      Zoom
                    </button>
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

      {selectedPoint && (
        <div className="attr-overlay" onClick={closeDetail}>
          <div className="attr-window" onClick={(e) => e.stopPropagation()}>
            <div className="attr-window-header">
              <h2>Point Details</h2>
              <button
                type="button"
                className="attr-close"
                title="Close"
                onClick={closeDetail}
                disabled={busy}
              >
                ×
              </button>
            </div>

            <label>
              Date
              <input
                name="date"
                type="date"
                value={detail.date}
                onChange={handleDetailChange}
              />
            </label>

            <label>
              Time
              <input
                name="time"
                type="time"
                value={detail.time}
                onChange={handleDetailChange}
              />
            </label>

            <label>
              Location
              <input
                name="location"
                type="text"
                value={detail.location}
                onChange={handleDetailChange}
              />
            </label>

            <label>
              Description
              <textarea
                name="description"
                value={detail.description}
                onChange={handleDetailChange}
                rows={3}
              />
            </label>

            <div className="attr-photos">
              {detailPhotos.length === 0 ? (
                <p className="attr-photos-empty">No photos yet.</p>
              ) : (
                detailPhotos.map((key, index) => (
                  <div key={key} className="attr-photo">
                    {photoUrls[key] ? (
                      isVideoKey(key) ? (
                        <video
                          src={photoUrls[key]}
                          muted
                          onClick={() => setLightboxIndex(index)}
                          title="Click to enlarge"
                        />
                      ) : (
                        <img
                          src={photoUrls[key]}
                          alt="Point"
                          onClick={() => setLightboxIndex(index)}
                          title="Click to enlarge"
                        />
                      )
                    ) : (
                      <span className="attr-photo-loading">Loading…</span>
                    )}
                    <button
                      type="button"
                      className="attr-photo-remove"
                      title="Remove photo"
                      onClick={() => handleRemovePhoto(key)}
                      disabled={busy}
                    >
                      ×
                    </button>
                  </div>
                ))
              )}
            </div>

            {pendingFiles.length > 0 && (
              <div className="attr-pending">
                <p className="attr-pending-title">
                  {pendingFiles.length} photo
                  {pendingFiles.length > 1 ? "s" : ""} ready to upload:
                </p>
                <ul>
                  {pendingFiles.map((f, i) => (
                    <li key={`${f.name}-${i}`}>
                      <span>{f.name}</span>
                      <button
                        type="button"
                        className="attr-pending-remove"
                        onClick={() => handleRemovePending(i)}
                        disabled={busy}
                      >
                        ×
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {uploadMsg && (
              <p
                className={
                  uploadMsg.ok ? "attr-upload-msg" : "attr-upload-msg attr-upload-err"
                }
              >
                {uploadMsg.ok ? "✓ " : "⚠ "}
                {uploadMsg.text}
              </p>
            )}

            <input
              ref={photoInputRef}
              type="file"
              accept="image/*,video/*"
              multiple
              hidden
              onChange={handlePhotosPicked}
            />

            <div className="attr-actions">
              <button
                className="btn btn-primary"
                onClick={handleApply}
                disabled={busy}
              >
                Apply
              </button>
              <button
                className="btn btn-secondary"
                onClick={() => photoInputRef.current?.click()}
                disabled={busy}
              >
                Photo/Video
              </button>
              <button
                className="btn btn-primary"
                onClick={handleUpload}
                disabled={busy || pendingFiles.length === 0}
              >
                {busy && pendingFiles.length > 0 ? "Uploading…" : "Upload"}
              </button>
              <button
                className="btn btn-delete"
                onClick={handleDeleteSelected}
                disabled={busy}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {selectedPoint && lightboxIndex !== null && detailPhotos[lightboxIndex] && (
        <div className="lightbox-overlay" onClick={() => setLightboxIndex(null)}>
          <button
            className="lightbox-close"
            title="Close"
            onClick={() => setLightboxIndex(null)}
          >
            ×
          </button>

          {detailPhotos.length > 1 && (
            <button
              className="lightbox-nav lightbox-prev"
              title="Previous"
              onClick={(e) => {
                e.stopPropagation();
                lightboxPrev();
              }}
            >
              ‹
            </button>
          )}

          <div className="lightbox-content" onClick={(e) => e.stopPropagation()}>
            {isVideoKey(detailPhotos[lightboxIndex]) ? (
              <video
                src={photoUrls[detailPhotos[lightboxIndex]]}
                controls
                autoPlay
              />
            ) : (
              <img
                src={photoUrls[detailPhotos[lightboxIndex]]}
                alt={`Photo ${lightboxIndex + 1}`}
              />
            )}
            <div className="lightbox-bar">
              <span className="lightbox-counter">
                {lightboxIndex + 1} / {detailPhotos.length}
              </span>
              <button
                className="btn btn-secondary"
                onClick={handleDownload}
                disabled={busy}
              >
                Download
              </button>
              <button
                className="btn btn-delete"
                onClick={handleLightboxDelete}
                disabled={busy}
              >
                Delete
              </button>
            </div>
          </div>

          {detailPhotos.length > 1 && (
            <button
              className="lightbox-nav lightbox-next"
              title="Next"
              onClick={(e) => {
                e.stopPropagation();
                lightboxNext();
              }}
            >
              ›
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export default App;
