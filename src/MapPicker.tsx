import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
  APIProvider,
  Map,
  AdvancedMarker,
  MapControl,
  ControlPosition,
  useMap,
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

function LocateButton({ onLocate }: { onLocate: (pos: google.maps.LatLngLiteral) => void }) {
  const map = useMap();
  const [busy, setBusy] = useState(false);

  function handleLocate() {
    if (!map) return;
    setBusy(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const loc = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        map.panTo(loc);
        map.setZoom(18);
        onLocate(loc);
        setBusy(false);
      },
      () => {
        alert("Could not get your location.");
        setBusy(false);
      }
    );
  }

  return (
    <MapControl position={ControlPosition.RIGHT_BOTTOM}>
      <button className="map-locate-btn" onClick={handleLocate} disabled={busy} title="My location">
        {busy ? (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="#1a73e8"><circle cx="12" cy="12" r="4"/></svg>
        ) : (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="#1a73e8" xmlns="http://www.w3.org/2000/svg">
            <path d="M12 8c-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4-1.79-4-4-4zm8.94 3A8.994 8.994 0 0 0 13 3.06V1h-2v2.06A8.994 8.994 0 0 0 3.06 11H1v2h2.06A8.994 8.994 0 0 0 11 20.94V23h2v-2.06A8.994 8.994 0 0 0 20.94 13H23v-2h-2.06zM12 19c-3.87 0-7-3.13-7-7s3.13-7 7-7 7 3.13 7 7-3.13 7-7 7z"/>
          </svg>
        )}
      </button>
    </MapControl>
  );
}

const BENT_NM = { lat: 33.1581, lng: -105.8572 };
const DEFAULT_ZOOM = 14;
/** Default geographic radius (meters) for circle markers when none is supplied. */
const DEFAULT_RADIUS_M = 25;

export interface PointMarker {
  id: string;
  lat: number;
  lng: number;
  location: string | null | undefined;
  color?: string;
  /** Geographic radius in meters for the rendered circle. Defaults to DEFAULT_RADIUS_M. */
  radius?: number;
}

interface MapPickerProps {
  lat: string;
  lng: string;
  points: PointMarker[];
  onCoordChange: (lat: string, lng: string) => void;
  onMarkerCancel?: () => void;
  onPointSelect?: (id: string) => void;
  focusTarget?: FocusTarget | null;
}

/**
 * Renders a true geographic-radius circle via the native `google.maps.Circle`
 * overlay. Unlike CSS-sized markers, the circle's geometry is correct in world
 * space at every zoom level — so the anchor never appears to drift when zooming.
 *
 * Note: `google.maps.Circle` does NOT support dashed strokes. The draft state is
 * conveyed via color/fill-opacity/weight instead.
 */
function CircleMarker({
  center,
  radius,
  fillColor,
  strokeColor,
  fillOpacity = 0.5,
  strokeWeight = 2,
  onClick,
}: {
  center: google.maps.LatLngLiteral;
  radius: number;
  fillColor: string;
  strokeColor: string;
  fillOpacity?: number;
  strokeWeight?: number;
  onClick?: () => void;
}) {
  const map = useMap();
  const circleRef = useRef<google.maps.Circle | null>(null);
  const clickRef = useRef<google.maps.MapsEventListener | null>(null);

  // Create / destroy the underlying circle overlay when the map mounts/unmounts.
  useEffect(() => {
    if (!map) return;
    const c = new google.maps.Circle({ map, center, radius });
    circleRef.current = c;
    return () => { c.setMap(null); clickRef.current?.remove(); clickRef.current = null; };
  }, [map]);

  // Apply option changes when props update.
  useEffect(() => {
    const c = circleRef.current;
    if (!c) return;
    c.setCenter(center);
    c.setRadius(radius);
    c.setOptions({
      fillColor,
      fillOpacity,
      strokeColor,
      strokeWeight,
      strokeOpacity: 0.9,
    });
  }, [center, radius, fillColor, strokeColor, fillOpacity, strokeWeight]);

  // (Re)bind click handler when it changes.
  useEffect(() => {
    const c = circleRef.current;
    if (!c || !onClick) return;
    clickRef.current = c.addListener("click", onClick);
    return () => { clickRef.current?.remove(); clickRef.current = null; };
  }, [onClick]);

  return null;
}


export default function MapPicker({ lat, lng, points, onCoordChange, onMarkerCancel, onPointSelect, focusTarget }: MapPickerProps) {
  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string;

  const hasExisting = lat !== "" && lng !== "";
  const initialCenter = hasExisting
    ? { lat: parseFloat(lat), lng: parseFloat(lng) }
    : BENT_NM;

  const [geoMarker, setGeoMarker] = useState<google.maps.LatLngLiteral | null>(null);

  const [marker, setMarker] = useState<google.maps.LatLngLiteral | null>(
    hasExisting ? { lat: parseFloat(lat), lng: parseFloat(lng) } : null
  );

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
        >
          <MapFocuser target={focusTarget ?? null} />
          <LocateButton onLocate={(pos) => setGeoMarker(pos)} />

          {geoMarker && (
            <AdvancedMarker position={geoMarker}>
              <div className="map-balloon">
                <button
                  className="map-balloon-cancel"
                  title="Cancel"
                  onClick={(e) => { e.stopPropagation(); setGeoMarker(null); }}
                >×</button>
                <svg width="32" height="42" viewBox="0 0 32 42" xmlns="http://www.w3.org/2000/svg">
                  <path d="M16 0C7.163 0 0 7.163 0 16c0 10 16 26 16 26S32 26 32 16C32 7.163 24.837 0 16 0z" fill="#e11d48"/>
                  <circle cx="16" cy="16" r="6" fill="#fff"/>
                </svg>
              </div>
            </AdvancedMarker>
          )}

          {points.map((p) => (
            <CircleMarker
              key={p.id}
              center={{ lat: p.lat, lng: p.lng }}
              radius={p.radius ?? DEFAULT_RADIUS_M}
              fillColor={p.color ?? "#e11d48"}
              strokeColor={p.color ?? "#b91c1c"}
              onClick={() => onPointSelect?.(p.id)}
            />
          ))}

          {draftVisible && (
            <>
              <CircleMarker
                center={marker!}
                radius={DEFAULT_RADIUS_M}
                fillColor="#3b82f6"
                strokeColor="#1d4ed8"
                fillOpacity={0.25}
                strokeWeight={3}
              />
              {/* Cancel button overlay — keeps the × clickable above the circle. */}
              <AdvancedMarker position={marker!}>
                <button
                  className="map-draft-cancel"
                  title="Cancel"
                  onClick={(e) => {
                    e.stopPropagation();
                    setMarker(null);
                    onMarkerCancel?.();
                  }}
                >×</button>
              </AdvancedMarker>
            </>
          )}
        </Map>
      </APIProvider>
    </div>
  );
}
