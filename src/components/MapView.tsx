import { useEffect, useRef } from 'react';
import * as L from 'leaflet';

export interface MapMarker {
  lat: number;
  lng: number;
  title: string;
  subtitle?: string;
  address?: string;
  href?: string;
  image?: string;
  index?: number;
  kind?: 'attraction' | 'hotel' | 'restaurant' | 'destination' | 'stop';
}

interface MapViewProps {
  markers: MapMarker[];
  path?: { lat: number; lng: number }[];
  center?: [number, number];
  zoom?: number;
  height?: number | string;
  scrollZoom?: boolean;
  /** Index of the marker to focus (opens its popup and pans to it). */
  activeIndex?: number;
  /** Fired when a numbered marker is clicked, so a result card can highlight. */
  onMarkerClick?: (index: number) => void;
  /** The searched origin: shown as its own marker and included in the view. */
  origin?: { lat: number; lng: number; label?: string };
}

const kindClass: Record<string, string> = {
  attraction: '',
  stop: '',
  hotel: 'gold',
  restaurant: 'sage',
  destination: 'ink',
};

export default function MapView({
  markers,
  path,
  center,
  zoom = 11,
  height = 380,
  scrollZoom = false,
  activeIndex,
  onMarkerClick,
  origin,
}: MapViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);
  const markerRefs = useRef(new Map<number, L.Marker>());
  const clickRef = useRef(onMarkerClick);

  useEffect(() => {
    clickRef.current = onMarkerClick;
  }, [onMarkerClick]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current, {
      scrollWheelZoom: scrollZoom,
      zoomControl: true,
      attributionControl: true,
    });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 18,
      attribution: '&copy; OpenStreetMap contributors',
    }).addTo(map);
    mapRef.current = map;
    layerRef.current = L.layerGroup().addTo(map);
    return () => {
      map.remove();
      mapRef.current = null;
      layerRef.current = null;
    };
  }, [scrollZoom]);

  const originLat = origin?.lat;
  const originLng = origin?.lng;
  const originLabel = origin?.label;

  useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!map || !layer) return;
    layer.clearLayers();
    markerRefs.current.clear();

    const bounds: L.LatLngTuple[] = [];

    if (typeof originLat === 'number' && typeof originLng === 'number') {
      const icon = L.divIcon({
        className: 'ts-pin origin',
        html: '<span class="dot"></span>',
        iconSize: [18, 18],
        iconAnchor: [9, 9],
        popupAnchor: [0, -12],
      });
      L.marker([originLat, originLng], { icon, zIndexOffset: 500 })
        .bindPopup(
          `<div class="map-popup"><strong>${escapeHtml(originLabel || 'Search location')}</strong><div class="pop-sub">Search centre</div></div>`,
        )
        .addTo(layer);
      bounds.push([originLat, originLng]);
    }

    markers.forEach((marker) => {
      const numbered = typeof marker.index === 'number';
      const icon = L.divIcon({
        className: `ts-pin ${kindClass[marker.kind ?? 'attraction'] ?? ''} ${numbered ? 'numbered' : ''}`,
        html: numbered ? `<span class="num">${marker.index}</span>` : '<span class="dot"></span>',
        iconSize: numbered ? [26, 26] : [16, 16],
        iconAnchor: numbered ? [13, 13] : [8, 8],
        popupAnchor: [0, numbered ? -16 : -10],
      });

      const popup = `<div class="map-popup">
        ${marker.image ? `<img src="${escapeHtml(marker.image)}" alt="" loading="lazy" />` : ''}
        <strong>${escapeHtml(marker.title)}</strong>
        ${marker.subtitle ? `<div class="pop-sub">${escapeHtml(marker.subtitle)}</div>` : ''}
        ${marker.address ? `<div class="pop-addr">${escapeHtml(marker.address)}</div>` : ''}
        ${marker.href ? `<a href="${escapeHtml(marker.href)}">View details →</a>` : ''}
      </div>`;

      const leafletMarker = L.marker([marker.lat, marker.lng], {
        icon,
        zIndexOffset: numbered ? marker.index! * 10 : 0,
        title: marker.title,
      })
        .bindPopup(popup)
        .addTo(layer);

      if (numbered) {
        const index = marker.index!;
        markerRefs.current.set(index, leafletMarker);
        leafletMarker.on('click', () => clickRef.current?.(index));
      }
      bounds.push([marker.lat, marker.lng]);
    });

    if (path && path.length > 1) {
      const points = path.map((p) => [p.lat, p.lng] as L.LatLngTuple);
      L.polyline(points, { color: '#ffffff', weight: 6, opacity: 0.85 }).addTo(layer);
      L.polyline(points, {
        color: '#315BEB',
        weight: 3,
        opacity: 0.9,
        dashArray: '1 9',
        lineCap: 'round',
      }).addTo(layer);
    }

    if (!path && markers.length === 0 && typeof originLat === 'number' && typeof originLng === 'number') {
      map.setView([originLat, originLng], Math.max(zoom, 13));
    } else if (bounds.length === 1) {
      map.setView(bounds[0], Math.max(zoom, 13));
    } else if (bounds.length > 1) {
      map.fitBounds(L.latLngBounds(bounds), { padding: [38, 38], maxZoom: 14 });
    } else if (center) {
      map.setView(center, zoom);
    } else {
      map.setView([20.5937, 78.9629], 4);
    }
  }, [markers, path, center, zoom, originLat, originLng, originLabel]);

  useEffect(() => {
    if (typeof activeIndex !== 'number') return;
    const map = mapRef.current;
    const marker = markerRefs.current.get(activeIndex);
    if (!map || !marker) return;
    map.panTo(marker.getLatLng(), { animate: true });
    marker.openPopup();
  }, [activeIndex, markers]);

  return (
    <div className="map-shell" style={{ height }}>
      <div ref={containerRef} className="map" style={{ height }} />
    </div>
  );
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] ?? char,
  );
}
