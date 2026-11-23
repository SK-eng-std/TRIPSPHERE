import { Hono } from 'hono';
import type { Env } from '../env';
import { clamp, fail, ok, toInt, toNum } from '../lib/http';
import {
  ProviderError,
  geocode,
  googlePhoto,
  nearbyPlaces,
  providerInfo,
  reverseGeocode,
  type NearbyKind,
} from '../lib/placesProvider';

const nearby = new Hono<{ Bindings: Env }>();

function coordinates(lat: unknown, lng: unknown): { lat: number; lng: number } | null {
  const la = toNum(lat, NaN);
  const ln = toNum(lng, NaN);
  if (!Number.isFinite(la) || !Number.isFinite(ln)) return null;
  if (la < -90 || la > 90 || ln < -180 || ln > 180) return null;
  return { lat: la, lng: ln };
}

function providerFailure(c: Parameters<typeof fail>[0], error: unknown) {
  if (error instanceof ProviderError) return fail(c, error.message, error.status);
  console.error('Nearby provider error', error);
  return fail(c, "We couldn't load nearby places right now. Please try again.", 502);
}

nearby.get('/nearby/config', (c) => ok(c, { provider: providerInfo(c.env) }));

nearby.get('/geo/search', async (c) => {
  const q = (c.req.query('q') || '').trim();
  if (q.length < 2) return ok(c, { results: [] });
  try {
    const results = await geocode(c.env, q);
    return ok(c, { results });
  } catch (error) {
    return providerFailure(c, error);
  }
});

nearby.get('/geo/reverse', async (c) => {
  const point = coordinates(c.req.query('lat'), c.req.query('lng'));
  if (!point) return fail(c, 'Provide a valid lat and lng.');
  try {
    const result = await reverseGeocode(c.env, point.lat, point.lng);
    return ok(c, { result });
  } catch (error) {
    return providerFailure(c, error);
  }
});

nearby.get('/nearby/places', async (c) => {
  const point = coordinates(c.req.query('lat'), c.req.query('lng'));
  if (!point) {
    return fail(c, 'A valid latitude and longitude are required. Use your current location or search a destination.');
  }
  const kind: NearbyKind = c.req.query('kind') === 'restaurant' ? 'restaurant' : 'hotel';
  const radiusKm = clamp(toNum(c.req.query('radius'), 5), 0.5, 30);
  const limit = clamp(toInt(c.req.query('limit'), 40), 1, 80);

  try {
    const result = await nearbyPlaces(c.env, {
      kind,
      lat: point.lat,
      lng: point.lng,
      radiusKm,
      limit,
      q: c.req.query('q') || undefined,
    });
    c.header('cache-control', 'public, max-age=60');
    return ok(c, {
      provider: result.provider,
      kind,
      origin: point,
      radiusKm,
      places: result.places,
      count: result.places.length,
      notice: result.notice,
      fetchedAt: new Date().toISOString(),
    });
  } catch (error) {
    return providerFailure(c, error);
  }
});

nearby.get('/nearby/photo', async (c) => {
  const ref = c.req.query('ref') || '';
  try {
    return await googlePhoto(c.env, ref);
  } catch (error) {
    return providerFailure(c, error);
  }
});

export default nearby;
