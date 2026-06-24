import { useState, useEffect, useCallback, useMemo } from "react";
import {
  APIProvider,
  Map,
  AdvancedMarker,
  useMap,
  MapCameraChangedEvent,
  MapMouseEvent,
} from "@vis.gl/react-google-maps";
import "./MapPicker.css";

export interface FocusTarget {
  lat: number;
  lng: number;
  nonce: number; // changes each request so repeated clicks re-trigger
}

/** Pans/zooms the map whenever `target` changes. Must render inside <Map>. */
function MapFocuser({ target }: { target: FocusTarget | null }) {
  const map = useMap();
  useEffect(() => {
    if (!map || !target) return;
    map.panTo({ lat: target.lat, lng: target.lng });
    map.setZoom(20);
  }, [map, target]);
  return null;
}

const BENT_NM = { lat: 33.1581, lng: -105.8572 };
const DEFAULT_ZOOM = 14;

export interface PointMarker {
  id: string;
  lat: number;
  lng: number;
  location: string | null | undefined;
}

interface MapPickerProps {
  lat: string;
  lng: string;
  points: PointMarker[];
  onCoordChange: (lat: string, lng: string) => void;
  onPointSelect?: (id: string) => void;
  focusTarget?: FocusTarget | null;
}

/** Scale marker diameter relative to the default zoom so circles grow/shrink with the view. */
function markerSize(zoom: number): number {
  const size = 2 * Math.pow(2, zoom - DEFAULT_ZOOM);
  return Math.max(1, Math.min(20, size));   // 2px at default zoom (clamp 1px–20px)
}

function LocateButton() {
  const map = useMap();
  const [busy, setBusy] = useState(false);

  function handleLocate() {
    if (!map) return;
    setBusy(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        map.panTo({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        map.setZoom(18);
        setBusy(false);
      },
      () => {
        alert("Could not get your location.");
        setBusy(false);
      }
    );
  }

  return (
    <button className="map-locate-btn" onClick={handleLocate} disabled={busy} title="Go to my location">
      {busy ? "…" : "⊕ My Location"}
    </button>
  );
}

export default function MapPicker({ lat, lng, points, onCoordChange, onPointSelect, focusTarget }: MapPickerProps) {
  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string;

  const [zoom, setZoom] = useState(DEFAULT_ZOOM);

  const hasExisting = lat !== "" && lng !== "";
  const initialCenter = hasExisting
    ? { lat: parseFloat(lat), lng: parseFloat(lng) }
    : BENT_NM;

  const [marker, setMarker] = useState<google.maps.LatLngLiteral | null>(
    hasExisting ? { lat: parseFloat(lat), lng: parseFloat(lng) } : null
  );

  const handleCameraChange = useCallback((ev: MapCameraChangedEvent) => {
    setZoom(ev.detail.zoom);
  }, []);

  const handleMapClick = useCallback(
    (ev: MapMouseEvent) => {
      const clicked = ev.detail.latLng;
      if (!clicked) return;
      const newLat = clicked.lat;
      const newLng = clicked.lng;
      setMarker({ lat: newLat, lng: newLng });
      onCoordChange(newLat.toFixed(6), newLng.toFixed(6));
    },
    [onCoordChange]
  );

  const savedSize = markerSize(zoom);
  const draftSize = savedSize * 1.2;

  const draftVisible = useMemo(
    () =>
      marker && !points.some((p) => p.lat === marker.lat && p.lng === marker.lng),
    [marker, points]
  );

  if (!apiKey || apiKey === "YOUR_GOOGLE_MAPS_API_KEY") {
    return (
      <div className="map-picker">
        <div className="map-placeholder">
          <p>🗺️ Google Maps API key not set.</p>
          <p>
            Create a <code>.env</code> file in the project root with:
          </p>
          <pre>VITE_GOOGLE_MAPS_API_KEY=your-actual-key</pre>
          <p>
            Get a key at{" "}
            <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noreferrer">
              Google Cloud Console
            </a>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="map-picker">
      <APIProvider apiKey={apiKey}>
        <Map
          mapId="point-tracker-map"
          defaultCenter={initialCenter}
          defaultZoom={DEFAULT_ZOOM}
          mapTypeId="satellite"
          gestureHandling="greedy"
          disableDefaultUI={false}
          onClick={handleMapClick}
          onCameraChanged={handleCameraChange}
        >
          <MapFocuser target={focusTarget ?? null} />
          <LocateButton />
          {points.map((p) => (
            <AdvancedMarker
              key={p.id}
              position={{ lat: p.lat, lng: p.lng }}
              clickable
              onClick={() => onPointSelect?.(p.id)}
            >
              <div className="map-marker-hit" title={p.location ?? ""}>
                <div
                  className="map-marker-circle"
                  style={{
                    width: savedSize,
                    height: savedSize,
                    borderWidth: savedSize * 0.1,
                  }}
                />
              </div>
            </AdvancedMarker>
          ))}

          {draftVisible && (
            <AdvancedMarker position={marker}>
              <div
                className="map-marker-circle map-marker-draft"
                style={{
                  width: draftSize,
                  height: draftSize,
                  borderWidth: draftSize * 0.1,
                }}
              />
            </AdvancedMarker>
          )}
        </Map>
      </APIProvider>
    </div>
  );
}
