import JSZip from "jszip";
import { getUrl } from "aws-amplify/storage";
import {
  buildCsvText,
  downloadBlob,
  safeFilename,
  type ExportPoint,
  type ExportProject,
} from "./exportPoints";

/* ── File System Access API (typed inline to match App.tsx's existing style) ──
   No ambient @types dependency is added; the minimal shapes we use are
   declared here. Browsers without the API simply won't expose
   `showDirectoryPicker`, and the caller falls back to a ZIP. */

interface FsWritable {
  write: (data: Blob) => Promise<void>;
  close: () => Promise<void>;
}
interface FsFileHandle {
  createWritable: () => Promise<FsWritable>;
}
interface FsDirHandle {
  getFileHandle: (name: string, opts?: { create?: boolean }) => Promise<FsFileHandle>;
  getDirectoryHandle: (name: string, opts?: { create?: boolean }) => Promise<FsDirHandle>;
}

interface WindowWithDirectoryPicker {
  showDirectoryPicker?: (opts?: {
    mode?: "read" | "readwrite";
  }) => Promise<FsDirHandle>;
}

export function supportsDirectoryPicker(): boolean {
  return typeof window !== "undefined" &&
    typeof (window as WindowWithDirectoryPicker).showDirectoryPicker === "function";
}

export async function pickDirectory(): Promise<FsDirHandle | null> {
  const fn = (window as WindowWithDirectoryPicker).showDirectoryPicker;
  if (!fn) return null;
  try {
    return await fn({ mode: "readwrite" });
  } catch (err) {
    // User dismissed the picker — not an error, just a cancel.
    if ((err as DOMException)?.name === "AbortError") return null;
    throw err;
  }
}

/* ── Filename helpers ── */

/**
 * Recovers the original upload filename from an S3 key. Mirrors the helper in
 * App.tsx: strips the leading `{timestamp}-` and optional `{index}-` prefix
 * from the last path segment.
 *
 *   point-photos/<id>/1750000000000-2-site.jpg  →  site.jpg
 */
export function filenameFromKey(key: string): string {
  const last = key.split("/").pop() ?? "download";
  return last.replace(/^\d+-(\d+-)?/, "");
}

/** A stable, human-readable per-point folder name: `001 - Central Valve`. */
export function folderNameForPoint(point: ExportPoint): string {
  const num = point.pointNumber ?? 0;
  const padded = String(num).padStart(3, "0");
  const label = point.location?.trim() || (point.pointNumber != null ? `Point ${point.pointNumber}` : "Point");
  return safeFilename(`${padded} - ${label}`, `Point ${num}`);
}

/** Top-level export folder name: `2026-07-23 1430 - Bent NM`. */
export function exportFolderName(project: ExportProject, when = new Date()): string {
  const stamp = formatStamp(when);
  return safeFilename(`${stamp} - ${project.name}`, "export");
}

function formatStamp(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}${pad(date.getMinutes())}`
  );
}

/**
 * De-duplicate filenames within a single point folder by appending `-2`,
 * `-3`, etc. before the extension when names collide. Defensive: S3 keys embed
 * timestamps so this should rarely trigger, but original filenames can repeat.
 */
export function dedupeFilenames(names: string[]): string[] {
  const counts = new Map<string, number>();
  const result: string[] = [];
  for (const name of names) {
    const used = counts.get(name) ?? 0;
    counts.set(name, used + 1);
    if (used === 0) {
      result.push(name);
    } else {
      const dot = name.lastIndexOf(".");
      const base = dot === -1 ? name : name.slice(0, dot);
      const ext = dot === -1 ? "" : name.slice(dot);
      result.push(`${base}-${used + 1}${ext}`);
    }
  }
  return result;
}

/* ── Byte fetching ── */

/**
 * Fetch one media file's bytes. Resolves a fresh presigned URL per call (so a
 * long batch never trips a URL-expiry window) then fetches the blob. Works for
 * both images and videos — the key's URL is a plain GET regardless of type.
 */
export async function fetchBlob(key: string): Promise<Blob> {
  const { url } = await getUrl({ path: key });
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download ${filenameFromKey(key)} (HTTP ${res.status}).`);
  return res.blob();
}

/* ── Progress / cancel ── */

export interface ExportMediaProgress {
  /** Media files fully fetched so far. */
  fetched: number;
  /** Total media files to fetch. */
  total: number;
  /** Filename currently being fetched, for display. */
  current: string;
}

/** Thrown when the user cancels mid-export. Callers treat it as a clean stop. */
export class ExportCanceledError extends Error {
  constructor() {
    super("Export canceled.");
    this.name = "ExportCanceledError";
  }
}

function checkAbort(signal: AbortSignal) {
  if (signal.aborted) throw new ExportCanceledError();
}

/* ── Export paths ── */

interface ExportMediaArgs {
  project: ExportProject;
  points: ExportPoint[];
  /** CSV text to write alongside the media (built by the caller via buildCsvText). */
  csvText: string;
  onProgress?: (progress: ExportMediaProgress) => void;
  signal: AbortSignal;
}

/**
 * Write the folder tree into the user-picked directory via the File System
 * Access API. Streams each file to disk as it's fetched, so memory stays
 * bounded regardless of total size. Points with no media still get an empty
 * subfolder so the structure is uniform.
 */
export async function exportToDirectory({
  project,
  points,
  csvText,
  onProgress,
  signal,
  rootHandle,
}: ExportMediaArgs & { rootHandle: FsDirHandle }): Promise<void> {
  // Create the dated top-level folder inside the picked directory.
  const topFolder = exportFolderName(project);
  const root = await rootHandle.getDirectoryHandle(topFolder, { create: true });
  checkAbort(signal);

  // points.csv at the root of the export folder.
  const csvHandle = await root.getFileHandle("points.csv", { create: true });
  const csvWritable = await csvHandle.createWritable();
  await csvWritable.write(new Blob([csvText], { type: "text/csv;charset=utf-8" }));
  await csvWritable.close();
  checkAbort(signal);

  const total = points.reduce((sum, p) => sum + (p.photoKeys?.length ?? 0), 0);
  let fetched = 0;
  report(onProgress, { fetched, total, current: "" });

  for (const point of points) {
    checkAbort(signal);
    const folder = await root.getDirectoryHandle(folderNameForPoint(point), { create: true });
    const keys = (point.photoKeys ?? []).filter(Boolean);
    const fileNames = dedupeFilenames(keys.map(filenameFromKey));

    for (let i = 0; i < keys.length; i++) {
      checkAbort(signal);
      const key = keys[i];
      const name = fileNames[i];
      report(onProgress, { fetched, total, current: name });
      const blob = await fetchBlob(key);
      const fileHandle = await folder.getFileHandle(name, { create: true });
      const writable = await fileHandle.createWritable();
      await writable.write(blob);
      await writable.close();
      fetched += 1;
      report(onProgress, { fetched, total, current: name });
    }
  }
}

/**
 * Build the same folder tree inside a single ZIP and trigger a download. This
 * is the fallback for browsers without the File System Access API (Safari,
 * Firefox). Holds all blobs in memory until the ZIP is generated, so it's
 * best suited to moderate total sizes.
 */
export async function exportToZip({
  project,
  points,
  csvText,
  onProgress,
  signal,
}: ExportMediaArgs): Promise<void> {
  const zip = new JSZip();
  const topFolder = exportFolderName(project);
  zip.file(`${topFolder}/points.csv`, csvText);

  const total = points.reduce((sum, p) => sum + (p.photoKeys?.length ?? 0), 0);
  let fetched = 0;
  report(onProgress, { fetched, total, current: "" });

  for (const point of points) {
    checkAbort(signal);
    const folder = folderNameForPoint(point);
    const keys = (point.photoKeys ?? []).filter(Boolean);
    const fileNames = dedupeFilenames(keys.map(filenameFromKey));

    for (let i = 0; i < keys.length; i++) {
      checkAbort(signal);
      const key = keys[i];
      const name = fileNames[i];
      report(onProgress, { fetched, total, current: name });
      const blob = await fetchBlob(key);
      zip.file(`${topFolder}/${folder}/${name}`, blob);
      fetched += 1;
      report(onProgress, { fetched, total, current: name });
    }
  }

  checkAbort(signal);
  const blob = await zip.generateAsync({
    type: "blob",
    compression: "STORE", // media is already compressed; STORE avoids wasted CPU
  });
  downloadBlob(blob, `${topFolder}.zip`);
}

function report(
  onProgress: ((p: ExportMediaProgress) => void) | undefined,
  progress: ExportMediaProgress,
) {
  onProgress?.(progress);
}

export { buildCsvText };
