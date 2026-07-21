import proj4 from "proj4";

export type CoordinateUnits = "us-ft" | "m";

export interface CoordinateSystemOption {
  epsg: string;
  name: string;
  units: CoordinateUnits;
  definition: string;
  recommended?: boolean;
}

const NEW_MEXICO_SYSTEMS: CoordinateSystemOption[] = [
  {
    epsg: "2257",
    name: "NAD83 / New Mexico East (US survey feet)",
    units: "us-ft",
    definition: "+proj=tmerc +lat_0=31 +lon_0=-104.333333333333 +k=0.999909091 +x_0=165000 +y_0=0 +datum=NAD83 +units=us-ft +no_defs +type=crs",
  },
  {
    epsg: "2258",
    name: "NAD83 / New Mexico Central (US survey feet)",
    units: "us-ft",
    definition: "+proj=tmerc +lat_0=31 +lon_0=-106.25 +k=0.9999 +x_0=500000.0001016 +y_0=0 +datum=NAD83 +units=us-ft +no_defs +type=crs",
  },
  {
    epsg: "2259",
    name: "NAD83 / New Mexico West (US survey feet)",
    units: "us-ft",
    definition: "+proj=tmerc +lat_0=31 +lon_0=-107.833333333333 +k=0.999916667 +x_0=830000.0001016 +y_0=0 +datum=NAD83 +units=us-ft +no_defs +type=crs",
  },
];

function utmOption(lat: number, lng: number): CoordinateSystemOption {
  const zone = Math.max(1, Math.min(60, Math.floor((lng + 180) / 6) + 1));
  const north = lat >= 0;
  return {
    epsg: String((north ? 32600 : 32700) + zone),
    name: `WGS 84 / UTM zone ${zone}${north ? "N" : "S"} (meters)`,
    units: "m",
    definition: `+proj=utm +zone=${zone} ${north ? "" : "+south "}+datum=WGS84 +units=m +no_defs +type=crs`,
  };
}

function isNewMexico(lat: number, lng: number) {
  return lat >= 31 && lat <= 37.1 && lng >= -109.1 && lng <= -103;
}

export function coordinateOptionsForLocation(lat: number, lng: number): CoordinateSystemOption[] {
  const utm = utmOption(lat, lng);
  if (!isNewMexico(lat, lng)) return [{ ...utm, recommended: true }];

  // State Plane zone boundaries follow county lines, so this longitude-based
  // result is intentionally a recommendation that an administrator confirms.
  const recommendedEpsg = lng < -107 ? "2259" : lng > -105.2 ? "2257" : "2258";
  const statePlaneOptions: CoordinateSystemOption[] = NEW_MEXICO_SYSTEMS.map((item) => ({
    ...item,
    recommended: item.epsg === recommendedEpsg,
  }));
  return [...statePlaneOptions, utm];
}

export function coordinateSystemByEpsg(epsg: string, lat: number, lng: number) {
  return coordinateOptionsForLocation(lat, lng).find((item) => item.epsg === epsg)
    ?? NEW_MEXICO_SYSTEMS.find((item) => item.epsg === epsg)
    ?? (utmOption(lat, lng).epsg === epsg ? utmOption(lat, lng) : undefined);
}

export function projectCoordinate(
  lat: number,
  lng: number,
  epsg: string,
): { easting: number; northing: number } {
  const system = coordinateSystemByEpsg(epsg, lat, lng);
  if (!system) throw new Error(`EPSG:${epsg} is not supported by this app.`);
  const [easting, northing] = proj4("EPSG:4326", system.definition, [lng, lat]);
  if (!Number.isFinite(easting) || !Number.isFinite(northing)) {
    throw new Error("Coordinate conversion returned an invalid result.");
  }
  return { easting, northing };
}

export function unitsLabel(units: string | null | undefined) {
  return units === "us-ft" ? "US survey feet" : units === "m" ? "meters" : "Unknown units";
}
