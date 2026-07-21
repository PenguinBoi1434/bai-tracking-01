import JSZip from "jszip";
import { projectCoordinate, unitsLabel } from "./survey";

export interface ExportPoint {
  id: string;
  date: string;
  location?: string | null;
  description?: string | null;
  lat: number;
  lng: number;
  pointNumber?: number | null;
  elevation?: number | null;
}

export interface ExportProject {
  name: string;
  coordinateSystemEpsg?: string | null;
  coordinateSystemName?: string | null;
  coordinateUnits?: string | null;
  verticalDatum?: string | null;
  elevationUnits?: string | null;
}

function csvCell(value: string | number | null | undefined) {
  const text = value == null ? "" : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function safeFilename(value: string, fallback = "export") {
  const safe = value.trim().replace(/[<>:"/\\|?*\x00-\x1f]/g, "-").replace(/\s+/g, " ").slice(0, 100);
  return safe || fallback;
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export async function exportSelectedPoints({
  project,
  points,
  filename,
}: {
  project: ExportProject;
  points: ExportPoint[];
  filename: string;
}) {
  if (!project.coordinateSystemEpsg) throw new Error("The project coordinate system is not configured.");
  if (points.length === 0) throw new Error("Select at least one point.");

  const numbers = points.map((point) => point.pointNumber).filter((value): value is number => value != null);
  if (numbers.length !== points.length) throw new Error("Every selected point needs a point number before export.");
  if (new Set(numbers).size !== numbers.length) throw new Error("Selected point numbers must be unique.");

  const zip = new JSZip();
  const converted = points.map((point) => {
    const xy = projectCoordinate(point.lat, point.lng, project.coordinateSystemEpsg!);
    return { point, ...xy };
  });

  const csvRows = ["Date,Name,X,Y,Z"];
  const pnezdRows: string[] = [];
  for (const item of converted) {
    const z = item.point.elevation ?? 0;
    csvRows.push([
      item.point.date,
      item.point.location ?? `Point ${item.point.pointNumber}`,
      item.easting.toFixed(3),
      item.northing.toFixed(3),
      z.toFixed(3),
    ].map(csvCell).join(","));
    pnezdRows.push([
      item.point.pointNumber,
      item.northing.toFixed(3),
      item.easting.toFixed(3),
      z.toFixed(3),
      item.point.location || item.point.description || "",
    ].map(csvCell).join(","));
  }

  zip.file("points.csv", `\uFEFF${csvRows.join("\r\n")}\r\n`);
  zip.file("points-pnezd.csv", `${pnezdRows.join("\r\n")}\r\n`);

  const missingElevation = points.filter((point) => point.elevation == null).length;
  zip.file("README.txt", [
    `Project: ${project.name}`,
    `Coordinate system: EPSG:${project.coordinateSystemEpsg} ${project.coordinateSystemName ?? ""}`,
    `Horizontal units: ${unitsLabel(project.coordinateUnits)}`,
    `Vertical datum: ${project.verticalDatum || "Not specified"}`,
    `Elevation units: ${project.elevationUnits || "Not specified"}`,
    `Points: ${points.length}`,
    `Points exported with 0.000 because elevation was missing: ${missingElevation}`,
    "PNEZD order: Point Number, Northing, Easting, Elevation, Description",
    "points.csv columns: Date, Name, X (Easting), Y (Northing), Z (Elevation).",
  ].join("\r\n"));

  const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 6 } });
  downloadBlob(blob, `${safeFilename(filename, project.name)}.zip`);
}
