import type { Env } from '../env';
import { haversineKm, roadKm } from './geo';

/**
 * Live nearby discovery.
 *
 * Two real providers are supported, both called from the Worker (never the browser):
 *  - OpenStreetMap: Nominatim for geocoding + Overpass API for nearby hotels/restaurants. Keyless.
 *  - Google Places API (New): used automatically when GOOGLE_PLACES_API_KEY is configured,
 *    because it also returns ratings, review counts, price level, opening hours and photos.
 *
 * No sample or invented places are produced here. Fields a provider does not supply stay null,
 * and the client hides the related filter instead of guessing.
 */

export type NearbyKind = 'hotel' | 'restaurant';

export interface NearbyPlace {
  id: string;
  source: 'osm' | 'google';
  kind: NearbyKind;
  name: string;
  address: string | null;
  lat: number;
  lng: number;
  distanceKm: number;
  rating: number | null;
  reviews: number | null;
  priceBand: 'budget' | 'moderate' | 'premium' | 'luxury' | null;
  priceLabel: string | null;
  stars: number | null;
  hotelType: string | null;
  cuisines: string[];
  facilities: string[];
  phone: string | null;
  website: string | null;
  menuUrl: string | null;
  openingHours: string | null;
  openNow: boolean | null;
  photoUrl: string | null;
  detailsUrl: string | null;
  mapsUrl: string;
  directionsUrl: string;
  bookUrl: string | null;
  reserveUrl: string | null;
}

export interface ProviderInfo {
  id: 'osm' | 'google';
  label: string;
  attribution: string;
  attributionUrl: string;
  needsKey: boolean;
  hasRatings: boolean;
  hasPrices: boolean;
  hasPhotos: boolean;
  hasOpeningHours: boolean;
}

export interface GeoResult {
  id: string;
  name: string;
  label: string;
  lat: number;
  lng: number;
  type: string;
}

export class ProviderError extends Error {
  status: number;
  constructor(message: string, status = 502) {
    super(message);
    this.status = status;
  }
}

const NOMINATIM = 'https://nominatim.openstreetmap.org';
const OVERPASS = 'https://overpass-api.de/api/interpreter';

/** Overpass answers "at capacity" for minutes at a time; don't make every visitor wait on it. */
let overpassCooldownUntil = 0;

const CACHE_TTL = {
  geocode: 24 * 60 * 60 * 1000,
  nearby: 10 * 60 * 1000,
};

const cache = new Map<string, { at: number; value: unknown }>();
const inflight = new Map<string, Promise<unknown>>();

function memo<T>(key: string, ttl: number, producer: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttl) return Promise.resolve(hit.value as T);
  const pending = inflight.get(key);
  if (pending) return pending as Promise<T>;

  const promise = producer()
    .then((value) => {
      cache.set(key, { at: Date.now(), value });
      if (cache.size > 120) {
        const oldest = cache.keys().next().value;
        if (oldest) cache.delete(oldest);
      }
      return value;
    })
    .finally(() => inflight.delete(key));

  inflight.set(key, promise);
  return promise;
}

async function fetchWithTimeout(url: string, init: RequestInit = {}, ms = 18000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new ProviderError('The places provider took too long to answer. Please try again.', 504);
    }
    throw new ProviderError('Could not reach the places provider. Check the connection and try again.', 502);
  } finally {
    clearTimeout(timer);
  }
}

function userAgent(env: Env): string {
  // Nominatim's usage policy requires an identifying User-Agent. Override GEO_USER_AGENT
  // in production with your own contact URL.
  return env.GEO_USER_AGENT || 'TRIPSPHERE/1.0 (travel discovery; self-hosted)';
}

/* ------------------------------------------------------------------ */
/* provider selection                                                  */
/* ------------------------------------------------------------------ */

export function providerInfo(env: Env): ProviderInfo {
  if (env.GOOGLE_PLACES_API_KEY) {
    return {
      id: 'google',
      label: 'Google Places',
      attribution: 'Powered by Google',
      attributionUrl: 'https://developers.google.com/maps/documentation/places/web-service/policies',
      needsKey: true,
      hasRatings: true,
      hasPrices: true,
      hasPhotos: true,
      hasOpeningHours: true,
    };
  }
  return {
    id: 'osm',
    label: 'OpenStreetMap',
    attribution: '© OpenStreetMap contributors',
    attributionUrl: 'https://www.openstreetmap.org/copyright',
    needsKey: false,
    hasRatings: false,
    hasPrices: false,
    hasPhotos: true,
    hasOpeningHours: true,
  };
}

/* ------------------------------------------------------------------ */
/* geocoding (Nominatim)                                               */
/* ------------------------------------------------------------------ */

let lastGeocodeAt = 0;

async function waitForGeocodeSlot(): Promise<void> {
  // Nominatim asks for a maximum of one request per second.
  const wait = Math.max(0, 1100 - (Date.now() - lastGeocodeAt));
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  lastGeocodeAt = Date.now();
}

async function nominatimJson(env: Env, path: string): Promise<unknown> {
  await waitForGeocodeSlot();
  const response = await fetchWithTimeout(`${NOMINATIM}${path}`, {
    headers: {
      'user-agent': userAgent(env),
      accept: 'application/json',
      'accept-language': 'en',
    },
  });
  if (response.status === 429) {
    throw new ProviderError('The geocoding service is rate limiting requests. Wait a moment and try again.', 429);
  }
  if (!response.ok) {
    throw new ProviderError('Destination lookup is unavailable right now. Please try again.', 502);
  }
  return response.json();
}

interface NominatimResult {
  osm_type?: string;
  osm_id?: number;
  lat?: string;
  lon?: string;
  name?: string;
  display_name?: string;
  type?: string;
  category?: string;
  address?: Record<string, string>;
}

function displayName(item: NominatimResult): string {
  const address = item.address ?? {};
  return (
    item.name ||
    address.tourism ||
    address.hotel ||
    address.restaurant ||
    address.amenity ||
    address.building ||
    address.road ||
    (item.display_name ? item.display_name.split(',')[0] : '') ||
    'Unnamed place'
  );
}

export async function geocode(env: Env, query: string): Promise<GeoResult[]> {
  const q = query.trim();
  if (q.length < 2) return [];

  return memo(`geo:${q.toLowerCase()}`, CACHE_TTL.geocode, async () => {
    const path = `/search?format=jsonv2&addressdetails=1&limit=6&q=${encodeURIComponent(q)}`;
    const data = (await nominatimJson(env, path)) as NominatimResult[];
    if (!Array.isArray(data)) return [];
    return data
      .map((item) => {
        const lat = Number(item.lat);
        const lng = Number(item.lon);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
        const result: GeoResult = {
          id: `osm:${item.osm_type ?? 'place'}/${item.osm_id ?? `${lat},${lng}`}`,
          name: displayName(item),
          label: item.display_name ?? displayName(item),
          lat,
          lng,
          type: item.type || item.category || 'place',
        };
        return result;
      })
      .filter((item): item is GeoResult => item !== null);
  });
}

export async function reverseGeocode(env: Env, lat: number, lng: number): Promise<GeoResult | null> {
  return memo(`rev:${lat.toFixed(3)},${lng.toFixed(3)}`, CACHE_TTL.geocode, async () => {
    const path = `/reverse?format=jsonv2&zoom=14&lat=${lat}&lon=${lng}`;
    const data = (await nominatimJson(env, path)) as NominatimResult & { error?: string };
    if (!data || data.error) return null;
    const address = data.address ?? {};
    const name =
      address.city ||
      address.town ||
      address.village ||
      address.suburb ||
      address.county ||
      address.state ||
      'Your location';
    return {
      id: `osm:${data.osm_type ?? 'place'}/${data.osm_id ?? `${lat},${lng}`}`,
      name,
      label: data.display_name ?? name,
      lat,
      lng,
      type: data.type || 'place',
    };
  });
}

/* ------------------------------------------------------------------ */
/* OpenStreetMap / Overpass                                           */
/* ------------------------------------------------------------------ */

interface OverpassElement {
  type: 'node' | 'way' | 'relation';
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

function overpassQuery(kind: NearbyKind, lat: number, lng: number, radiusKm: number): string {
  const radius = Math.round(radiusKm * 1000);
  const selector =
    kind === 'hotel'
      ? '["tourism"~"^(hotel|guest_house|hostel|apartment|resort|motel|chalet)$"]'
      : '["amenity"~"^(restaurant|cafe|fast_food|food_court)$"]';
  return `[out:json][timeout:25];nwr${selector}["name"](around:${radius},${lat.toFixed(5)},${lng.toFixed(5)});out center 200;`;
}

async function overpassSearch(env: Env, kind: NearbyKind, lat: number, lng: number, radiusKm: number): Promise<OverpassElement[]> {
  if (Date.now() < overpassCooldownUntil) {
    throw new ProviderError('Overpass is at capacity; using the OpenStreetMap name index instead.', 503);
  }

  const query = overpassQuery(kind, lat, lng, radiusKm);
  const key = `ovp:${kind}:${lat.toFixed(3)},${lng.toFixed(3)}:${radiusKm}`;

  return memo(key, CACHE_TTL.nearby, async () => {
    const response = await fetchWithTimeout(
      env.OVERPASS_URL || OVERPASS,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          'user-agent': userAgent(env),
          accept: 'application/json',
        },
        body: new URLSearchParams({ data: query }).toString(),
      },
      4500,
    );
    if (response.status === 429 || response.status === 502 || response.status === 503) {
      overpassCooldownUntil = Date.now() + 180_000;
      throw new ProviderError('Overpass is at capacity; using the OpenStreetMap name index instead.', 503);
    }
    if (!response.ok) {
      throw new ProviderError('The map data service did not answer correctly.', 502);
    }
    const payload = (await response.json()) as { elements?: OverpassElement[] };
    return Array.isArray(payload.elements) ? payload.elements : [];
  });
}

/* ------------------------------------------------------------------ */
/* Nominatim category fallback (real OSM places, no key)              */
/* ------------------------------------------------------------------ */

interface NominatimPoi {
  osm_type?: string;
  osm_id?: number;
  lat?: string;
  lon?: string;
  name?: string;
  display_name?: string;
  category?: string;
  type?: string;
  address?: Record<string, string>;
  extratags?: Record<string, string>;
}

async function nominatimCategorySearch(
  env: Env,
  kind: NearbyKind,
  lat: number,
  lng: number,
  radiusKm: number,
): Promise<OverpassElement[]> {
  // A bounded viewbox keeps the fallback centred on the search point (a city-name
  // query would return results tens of kilometres away in large states like Goa).
  const dLat = radiusKm / 111.32;
  const dLng = radiusKm / (111.32 * Math.max(0.15, Math.cos((Math.abs(lat) * Math.PI) / 180)));
  const left = (lng - dLng).toFixed(5);
  const right = (lng + dLng).toFixed(5);
  const top = (lat + dLat).toFixed(5);
  const bottom = (lat - dLat).toFixed(5);
  const term = kind === 'hotel' ? 'hotels' : 'restaurants';
  const key = `nomcat:${kind}:${lat.toFixed(2)},${lng.toFixed(2)}:${radiusKm}`;

  return memo(key, CACHE_TTL.nearby, async () => {
    const path = `/search?format=jsonv2&addressdetails=1&extratags=1&bounded=1&limit=50&viewbox=${left},${top},${right},${bottom}&q=${encodeURIComponent(term)}`;
    const data = (await nominatimJson(env, path)) as NominatimPoi[];
    if (!Array.isArray(data)) return [];

    return data.map((item) => {
      const tags: Record<string, string> = { ...(item.extratags ?? {}) };
      if (item.category && item.type) tags[item.category] = item.type;
      if (item.name) tags.name = item.name;

      const address = item.address ?? {};
      if (address.road) tags['addr:street'] = address.road;
      if (address.house_number) tags['addr:housenumber'] = address.house_number;
      if (address.suburb) tags['addr:suburb'] = address.suburb;
      const city = address.city || address.town || address.village;
      if (city) tags['addr:city'] = city;
      if (address.postcode) tags['addr:postcode'] = address.postcode;

      return {
        type: (item.osm_type === 'way' || item.osm_type === 'relation' ? item.osm_type : 'node') as OverpassElement['type'],
        id: Number(item.osm_id ?? 0),
        lat: Number(item.lat),
        lon: Number(item.lon),
        tags,
      };
    });
  });
}

function titleCase(value: string): string {
  return value
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase())
    .trim();
}

function osmAddress(tags: Record<string, string>): string | null {
  if (tags['addr:full']) return tags['addr:full'];
  const street = [tags['addr:housenumber'], tags['addr:street']].filter(Boolean).join(' ');
  const parts = [
    street,
    tags['addr:suburb'] || tags['addr:neighbourhood'] || tags['addr:quarter'],
    tags['addr:city'] || tags['addr:town'] || tags['addr:village'] || tags['addr:district'],
    tags['addr:state'],
    tags['addr:postcode'],
  ].filter((part) => Boolean(part && String(part).trim()));
  const unique = parts.filter((part, index) => parts.indexOf(part) === index);
  return unique.length ? unique.join(', ') : null;
}

function osmPhoto(tags: Record<string, string>): string | null {
  const image = tags.image;
  if (image && /^https?:\/\//i.test(image)) return image;
  const commons = tags.wikimedia_commons;
  if (commons && commons.startsWith('File:')) {
    return `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(commons.slice(5))}?width=800`;
  }
  return null;
}

function osmFacilities(kind: NearbyKind, tags: Record<string, string>): string[] {
  const out: string[] = [];
  const add = (label: string) => {
    if (!out.includes(label)) out.push(label);
  };

  if (tags.internet_access && tags.internet_access !== 'no') add('Wi-Fi');
  if (tags.parking && tags.parking !== 'no') add('Parking');
  if (tags.swimming_pool === 'yes' || tags.leisure === 'swimming_pool') add('Pool');
  if (tags.air_conditioning === 'yes') add('Air conditioning');
  if (tags.wheelchair === 'yes') add('Wheelchair access');
  if (kind === 'hotel') {
    if (tags.breakfast === 'yes') add('Breakfast');
    if (tags.bar === 'yes') add('Bar');
    if (tags.restaurant === 'yes') add('Restaurant');
    if (tags.spa === 'yes') add('Spa');
  } else {
    if (tags.outdoor_seating === 'yes') add('Outdoor seating');
    if (tags.diet_vegetarian === 'yes' || tags['diet:vegetarian'] === 'yes' || tags['diet:vegetarian'] === 'only') add('Vegetarian');
    if (tags['diet:vegan'] === 'yes' || tags['diet:vegan'] === 'only') add('Vegan');
    if (tags.takeaway === 'yes') add('Takeaway');
    if (tags.delivery === 'yes') add('Delivery');
  }
  return out;
}

function osmCuisines(tags: Record<string, string>): string[] {
  const raw = tags.cuisine;
  if (!raw) return [];
  return raw
    .split(';')
    .map((item) => titleCase(item.trim()))
    .filter(Boolean);
}

function googleMapsUrl(lat: number, lng: number): string {
  return `https://www.google.com/maps/search/?api=1&query=${lat}%2C${lng}`;
}

function directionsLink(lat: number, lng: number): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${lat}%2C${lng}`;
}

function normalizeOsm(
  element: OverpassElement,
  kind: NearbyKind,
  originLat: number,
  originLng: number,
): NearbyPlace | null {
  const tags = element.tags ?? {};
  const name = (tags.name || tags['name:en'] || '').trim();
  if (!name) return null;

  const lat = element.lat ?? element.center?.lat;
  const lng = element.lon ?? element.center?.lon;
  if (typeof lat !== 'number' || typeof lng !== 'number') return null;

  const website = tags.website || tags['contact:website'] || null;
  const menu = tags['website:menu'] || tags.menu;
  const menuUrl = menu && /^https?:\/\//i.test(menu) ? menu : null;
  const stars = Number(tags.stars);
  const typeLabel = tags.tourism
    ? titleCase(tags.tourism)
    : tags.amenity
      ? titleCase(tags.amenity)
      : kind === 'hotel'
        ? 'Hotel'
        : 'Restaurant';

  return {
    id: `osm:${element.type}/${element.id}`,
    source: 'osm',
    kind,
    name,
    address: osmAddress(tags),
    lat,
    lng,
    distanceKm: roadKm(haversineKm(originLat, originLng, lat, lng)),
    rating: null,
    reviews: null,
    priceBand: null,
    priceLabel: null,
    stars: Number.isFinite(stars) && stars > 0 ? stars : null,
    hotelType: kind === 'hotel' ? typeLabel : tags.amenity ? typeLabel : null,
    cuisines: kind === 'restaurant' ? osmCuisines(tags) : [],
    facilities: osmFacilities(kind, tags),
    phone: tags.phone || tags['contact:phone'] || null,
    website,
    menuUrl,
    openingHours: tags.opening_hours || null,
    openNow: null,
    photoUrl: osmPhoto(tags),
    detailsUrl: `https://www.openstreetmap.org/${element.type}/${element.id}`,
    mapsUrl: googleMapsUrl(lat, lng),
    directionsUrl: directionsLink(lat, lng),
    bookUrl:
      kind === 'hotel'
        ? website || `https://www.google.com/travel/search?q=${encodeURIComponent(`${name} ${osmAddress(tags) ?? ''}`.trim())}`
        : null,
    reserveUrl:
      kind === 'restaurant'
        ? website || `https://www.google.com/search?q=${encodeURIComponent(`${name} reservation`)}`
        : null,
  };
}

/* ------------------------------------------------------------------ */
/* Google Places API (New)                                            */
/* ------------------------------------------------------------------ */

const GOOGLE_FIELD_MASK = [
  'places.id',
  'places.displayName',
  'places.formattedAddress',
  'places.location',
  'places.rating',
  'places.userRatingCount',
  'places.priceLevel',
  'places.types',
  'places.primaryTypeDisplayName',
  'places.photos',
  'places.currentOpeningHours.openNow',
  'places.currentOpeningHours.weekdayDescriptions',
  'places.regularOpeningHours.weekdayDescriptions',
  'places.websiteUri',
  'places.nationalPhoneNumber',
  'places.googleMapsUri',
].join(',');

interface GooglePlace {
  id?: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  location?: { latitude?: number; longitude?: number };
  rating?: number;
  userRatingCount?: number;
  priceLevel?: string;
  types?: string[];
  primaryTypeDisplayName?: { text?: string };
  photos?: { name?: string }[];
  currentOpeningHours?: { openNow?: boolean; weekdayDescriptions?: string[] };
  regularOpeningHours?: { weekdayDescriptions?: string[] };
  websiteUri?: string;
  nationalPhoneNumber?: string;
  googleMapsUri?: string;
}

function priceBand(level?: string): NearbyPlace['priceBand'] {
  switch (level) {
    case 'PRICE_LEVEL_FREE':
      return 'budget';
    case 'PRICE_LEVEL_INEXPENSIVE':
      return 'budget';
    case 'PRICE_LEVEL_MODERATE':
      return 'moderate';
    case 'PRICE_LEVEL_EXPENSIVE':
      return 'premium';
    case 'PRICE_LEVEL_VERY_EXPENSIVE':
      return 'luxury';
    default:
      return null;
  }
}

const PRICE_LABELS: Record<NonNullable<NearbyPlace['priceBand']>, string> = {
  budget: 'Budget',
  moderate: 'Moderate',
  premium: 'Premium',
  luxury: 'Luxury',
};

function googleFacilities(kind: NearbyKind, place: GooglePlace): string[] {
  const types = place.types ?? [];
  const out: string[] = [];
  if (kind === 'hotel') {
    if (types.includes('lodging')) out.push('Accommodation');
    if (types.includes('resort_hotel')) out.push('Resort');
  }
  return out;
}

async function googleNearby(
  env: Env,
  kind: NearbyKind,
  lat: number,
  lng: number,
  radiusKm: number,
): Promise<GooglePlace[]> {
  const key = env.GOOGLE_PLACES_API_KEY;
  if (!key) throw new ProviderError('Location search requires API configuration. Please configure the places provider.', 501);

  const cacheKey = `goog:${kind}:${lat.toFixed(3)},${lng.toFixed(3)}:${radiusKm}`;
  return memo(cacheKey, CACHE_TTL.nearby, async () => {
    const response = await fetchWithTimeout(
      'https://places.googleapis.com/v1/places:searchNearby',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-goog-api-key': key,
          'x-goog-fieldmask': GOOGLE_FIELD_MASK,
        },
        body: JSON.stringify({
          includedTypes: kind === 'hotel' ? ['hotel', 'lodging', 'resort_hotel'] : ['restaurant', 'cafe', 'fast_food_restaurant'],
          maxResultCount: 20,
          rankPreference: 'DISTANCE',
          languageCode: 'en',
          regionCode: 'IN',
          locationRestriction: {
            circle: {
              center: { latitude: lat, longitude: lng },
              radius: Math.min(50000, Math.max(100, radiusKm * 1000)),
            },
          },
        }),
      },
      15000,
    );

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      if (response.status === 400 || response.status === 403) {
        throw new ProviderError(
          `Google Places rejected the request. Check that GOOGLE_PLACES_API_KEY is valid and "Places API (New)" is enabled for the key. ${detail.slice(0, 160)}`.trim(),
          502,
        );
      }
      if (response.status === 429) {
        throw new ProviderError('Google Places rate limit reached. Wait a moment and try again.', 429);
      }
      throw new ProviderError('Google Places could not answer right now. Please try again.', 502);
    }

    const payload = (await response.json()) as { places?: GooglePlace[] };
    if (!Array.isArray(payload.places)) return [];
    return payload.places;
  });
}

function normalizeGoogle(
  place: GooglePlace,
  kind: NearbyKind,
  originLat: number,
  originLng: number,
): NearbyPlace | null {
  const lat = place.location?.latitude;
  const lng = place.location?.longitude;
  const name = place.displayName?.text?.trim();
  if (!name || typeof lat !== 'number' || typeof lng !== 'number') return null;

  const band = priceBand(place.priceLevel);
  const photo = place.photos?.[0]?.name;
  const hours =
    place.currentOpeningHours?.weekdayDescriptions?.join(' · ') ||
    place.regularOpeningHours?.weekdayDescriptions?.join(' · ') ||
    null;
  const website = place.websiteUri ?? null;
  const cuisines = Array.from(
    new Set(
      (place.types ?? [])
        .filter((type) => type.endsWith('_restaurant') || type === 'cafe' || type === 'bakery')
        .map((type) => titleCase(type.replace(/_restaurant$/, '')))
        .filter((label) => label !== 'Restaurant'),
    ),
  );

  return {
    id: `google:${place.id ?? `${lat},${lng}`}`,
    source: 'google',
    kind,
    name,
    address: place.formattedAddress ?? null,
    lat,
    lng,
    distanceKm: roadKm(haversineKm(originLat, originLng, lat, lng)),
    rating: typeof place.rating === 'number' ? place.rating : null,
    reviews: typeof place.userRatingCount === 'number' ? place.userRatingCount : null,
    priceBand: band,
    priceLabel: band ? PRICE_LABELS[band] : null,
    stars: null,
    hotelType: kind === 'hotel' ? place.primaryTypeDisplayName?.text ?? 'Hotel' : place.primaryTypeDisplayName?.text ?? 'Restaurant',
    cuisines,
    facilities: googleFacilities(kind, place),
    phone: place.nationalPhoneNumber ?? null,
    website,
    menuUrl: null,
    openingHours: hours,
    openNow: typeof place.currentOpeningHours?.openNow === 'boolean' ? place.currentOpeningHours.openNow : null,
    photoUrl: photo ? `/api/nearby/photo?ref=${encodeURIComponent(photo)}` : null,
    detailsUrl: place.googleMapsUri ?? null,
    mapsUrl: place.googleMapsUri ?? googleMapsUrl(lat, lng),
    directionsUrl: directionsLink(lat, lng),
    bookUrl:
      kind === 'hotel'
        ? website || `https://www.google.com/travel/search?q=${encodeURIComponent(`${name} ${place.formattedAddress ?? ''}`.trim())}`
        : null,
    reserveUrl:
      kind === 'restaurant'
        ? website || `https://www.google.com/search?q=${encodeURIComponent(`${name} reservation`)}`
        : null,
  };
}

/* ------------------------------------------------------------------ */
/* public API                                                          */
/* ------------------------------------------------------------------ */

export interface NearbyRequest {
  kind: NearbyKind;
  lat: number;
  lng: number;
  radiusKm: number;
  limit?: number;
  q?: string;
}

export interface NearbyResult {
  provider: ProviderInfo;
  places: NearbyPlace[];
  notice: string | null;
}

function dedupe(places: NearbyPlace[]): NearbyPlace[] {
  const seen = new Map<string, NearbyPlace>();
  for (const place of places) {
    const key = `${place.name.toLowerCase().replace(/[^a-z0-9]/g, '')}|${place.lat.toFixed(3)}|${place.lng.toFixed(3)}`;
    const existing = seen.get(key);
    if (!existing || (place.distanceKm < existing.distanceKm)) seen.set(key, place);
  }
  return Array.from(seen.values());
}

export async function nearbyPlaces(env: Env, request: NearbyRequest): Promise<NearbyResult> {
  const provider = providerInfo(env);
  const radiusKm = Math.min(30, Math.max(0.5, request.radiusKm));
  const limit = Math.min(80, Math.max(1, request.limit ?? 40));

  let places: NearbyPlace[];
  let notice: string | null = null;
  if (provider.id === 'google') {
    const raw = await googleNearby(env, request.kind, request.lat, request.lng, radiusKm);
    places = raw
      .map((place) => normalizeGoogle(place, request.kind, request.lat, request.lng))
      .filter((place): place is NearbyPlace => place !== null);
  } else {
    let raw: OverpassElement[];
    try {
      raw = await overpassSearch(env, request.kind, request.lat, request.lng, radiusKm);
    } catch (error) {
      if (!(error instanceof ProviderError) || error.status === 429) throw error;
      // Overpass is at capacity or unreachable: fall back to Nominatim's OSM index so the
      // user still gets real, named places instead of an empty screen.
      raw = await nominatimCategorySearch(env, request.kind, request.lat, request.lng, radiusKm);
      notice =
        'Overpass is busy, so these come from OpenStreetMap’s category search. They are real places, but ratings, prices, phone and website may be missing — try again later for full details.';
    }
    places = raw
      .map((element) => normalizeOsm(element, request.kind, request.lat, request.lng))
      .filter((place): place is NearbyPlace => place !== null);
  }

  let filtered = dedupe(places).filter((place) => place.distanceKm <= radiusKm + 0.2);
  const term = (request.q ?? '').trim().toLowerCase();
  if (term) {
    filtered = filtered.filter(
      (place) =>
        place.name.toLowerCase().includes(term) ||
        (place.address ?? '').toLowerCase().includes(term) ||
        place.cuisines.some((cuisine) => cuisine.toLowerCase().includes(term)),
    );
  }

  filtered.sort((a, b) => a.distanceKm - b.distanceKm);
  return { provider, places: filtered.slice(0, limit), notice };
}

export async function googlePhoto(env: Env, ref: string): Promise<Response> {
  const key = env.GOOGLE_PLACES_API_KEY;
  if (!key) throw new ProviderError('Photo proxy requires GOOGLE_PLACES_API_KEY.', 501);
  if (!/^places\/[A-Za-z0-9_-]+\/photos\/[A-Za-z0-9_-]+$/.test(ref)) {
    throw new ProviderError('Unknown photo reference.', 400);
  }
  const url = `https://places.googleapis.com/v1/${ref}/media?maxWidthPx=900&key=${encodeURIComponent(key)}`;
  const response = await fetchWithTimeout(url, {}, 15000);
  if (!response.ok) throw new ProviderError('Photo is unavailable.', response.status === 404 ? 404 : 502);
  const headers = new Headers();
  headers.set('content-type', response.headers.get('content-type') || 'image/jpeg');
  headers.set('cache-control', 'public, max-age=86400');
  return new Response(response.body, { status: 200, headers });
}
