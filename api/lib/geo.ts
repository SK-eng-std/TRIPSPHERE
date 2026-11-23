const EARTH_KM = 6371;

export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return Math.round(EARTH_KM * 2 * Math.asin(Math.sqrt(a)) * 10) / 10;
}

/** Straight-line distance adjusted for the Indian road network. */
export function roadKm(straightKm: number): number {
  return Math.round(straightKm * 1.28 * 10) / 10;
}

/** Estimated driving time in minutes at a conservative average speed. */
export function travelMinutes(km: number): number {
  return Math.max(5, Math.round((km / 32) * 60 + 4));
}

export function addMinutes(time: string, minutes: number): string {
  const [h, m] = time.split(':').map(Number);
  const total = (h || 0) * 60 + (m || 0) + minutes;
  const hh = Math.floor((total % 1440) / 60);
  const mm = total % 60;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

export function distanceToMock(lat: number, lng: number, userLat?: number, userLng?: number): number | null {
  if (typeof userLat !== 'number' || typeof userLng !== 'number') return null;
  return roadKm(haversineKm(userLat, userLng, lat, lng));
}
