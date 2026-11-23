import { useCallback, useEffect, useState } from 'react';

const STORAGE_KEY = 'tripsphere.location';

export interface GeoState {
  lat: number | null;
  lng: number | null;
  status: 'idle' | 'loading' | 'ready' | 'denied' | 'error';
  error: string | null;
}

function readStored(): { lat: number; lng: number } | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { lat: number; lng: number };
    if (typeof parsed.lat === 'number' && typeof parsed.lng === 'number') return parsed;
  } catch {
    return null;
  }
  return null;
}

export function useGeo() {
  const [state, setState] = useState<GeoState>(() => {
    const stored = readStored();
    return stored
      ? { lat: stored.lat, lng: stored.lng, status: 'ready', error: null }
      : { lat: null, lng: null, status: 'idle', error: null };
  });

  const request = useCallback(() => {
    if (!navigator.geolocation) {
      setState({ lat: null, lng: null, status: 'error', error: 'This browser does not support location access.' });
      return;
    }
    setState((prev) => ({ ...prev, status: 'loading', error: null }));
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const coords = { lat: position.coords.latitude, lng: position.coords.longitude };
        try {
          sessionStorage.setItem(STORAGE_KEY, JSON.stringify(coords));
        } catch {
          /* storage may be unavailable */
        }
        setState({ ...coords, status: 'ready', error: null });
      },
      (error) => {
        const denied = error.code === error.PERMISSION_DENIED;
        setState({
          lat: null,
          lng: null,
          status: denied ? 'denied' : 'error',
          error: denied
            ? 'Location permission was declined. You can still search by destination.'
            : 'Could not get your location. Try again or search by destination.',
        });
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 300000 },
    );
  }, []);

  return { ...state, request };
}

export function formatINR(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return `₹${Math.round(value).toLocaleString('en-IN')}`;
}

export function formatDate(value: string | null | undefined, opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' }): string {
  if (!value) return '';
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en-IN', opts);
}

export function dateRange(start?: string | null, end?: string | null): string {
  if (!start && !end) return 'Dates are flexible';
  if (start && end) return `${formatDate(start)} – ${formatDate(end, { day: 'numeric', month: 'short', year: 'numeric' })}`;
  return formatDate(start || end, { day: 'numeric', month: 'short', year: 'numeric' });
}

function localIso(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function addDays(date: string, days: number): string {
  const base = date ? new Date(`${date}T00:00:00`) : new Date();
  base.setDate(base.getDate() + days);
  return localIso(base);
}

export function todayIso(): string {
  return localIso(new Date());
}

export function nightsBetween(checkIn: string, checkOut: string): number {
  if (!checkIn || !checkOut) return 1;
  const diff = (Date.parse(checkOut) - Date.parse(checkIn)) / 86_400_000;
  return Number.isFinite(diff) && diff > 0 ? Math.round(diff) : 1;
}

export function timeAgo(value: string): string {
  const then = Date.parse(value.includes('T') ? value : `${value.replace(' ', 'T')}Z`);
  if (Number.isNaN(then)) return '';
  const minutes = Math.round((Date.now() - then) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} day${days === 1 ? '' : 's'} ago`;
  return new Date(then).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** Leaflet map helper: builds an OpenStreetMap directions link without an API key. */
export function directionsUrl(lat: number, lng: number, label = ''): string {
  return `https://www.openstreetmap.org/directions?from=&to=${lat}%2C${lng}#map=14/${lat}/${lng}${label ? `&label=${encodeURIComponent(label)}` : ''}`;
}

/** Genuine external search link for live hotel availability. */
export function hotelSearchUrl(name: string, city: string): string {
  return `https://www.google.com/travel/search?q=${encodeURIComponent(`${name} ${city}`)}`;
}

/** Genuine external search link for restaurant reservations / details. */
export function restaurantSearchUrl(name: string, city: string): string {
  return `https://www.google.com/search?q=${encodeURIComponent(`${name} ${city} restaurant reservation`)}`;
}
