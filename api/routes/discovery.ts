import { Hono } from 'hono';
import type { Env } from '../env';
import { all, first } from '../lib/db';
import { fail, ok, toInt, toNum } from '../lib/http';
import {
  getDestinationBySlug,
  getPlace,
  listDestinations,
  listPlaces,
  type PlaceType,
} from '../lib/places';
import { currentUser } from '../lib/auth';
import { attractionScore, INTEREST_CATEGORIES } from '../lib/planner';

const discovery = new Hono<{ Bindings: Env }>();

function coords(c: { req: { query: (k: string) => string | undefined } }) {
  const lat = toNum(c.req.query('lat'), NaN);
  const lng = toNum(c.req.query('lng'), NaN);
  return {
    lat: Number.isFinite(lat) ? lat : undefined,
    lng: Number.isFinite(lng) ? lng : undefined,
  };
}

discovery.get('/destinations', async (c) => {
  const { lat, lng } = coords(c);
  const destinations = await listDestinations(c.env, {
    q: c.req.query('q') || undefined,
    region: c.req.query('region') || undefined,
    interest: c.req.query('interest') || undefined,
    hidden: c.req.query('hidden') === '1',
    unesco: c.req.query('unesco') === '1',
    limit: toInt(c.req.query('limit'), 24),
    lat,
    lng,
  });
  return ok(c, { destinations, count: destinations.length });
});

discovery.get('/destinations/:slug', async (c) => {
  const { lat, lng } = coords(c);
  const result = await getDestinationBySlug(c.env, c.req.param('slug'), lat, lng);
  if (!result) return fail(c, 'Destination not found', 404);
  return ok(c, result);
});

discovery.get('/places', async (c) => {
  const type = (c.req.query('type') || 'attraction') as PlaceType;
  if (!['hotel', 'restaurant', 'attraction'].includes(type)) return fail(c, 'Unknown place type');
  const { lat, lng } = coords(c);
  const places = await listPlaces(c.env, {
    type,
    q: c.req.query('q') || undefined,
    destinationId: toInt(c.req.query('destinationId'), 0) || undefined,
    destinationSlug: c.req.query('destination') || undefined,
    lat,
    lng,
    radiusKm: toNum(c.req.query('radius'), 0) || undefined,
    minPrice: toNum(c.req.query('minPrice'), 0) || undefined,
    maxPrice: toNum(c.req.query('maxPrice'), 0) || undefined,
    minRating: toNum(c.req.query('minRating'), 0) || undefined,
    cuisine: c.req.query('cuisine') || undefined,
    category: c.req.query('category') || undefined,
    amenity: c.req.query('amenity') || undefined,
    hiddenOnly: c.req.query('hidden') === '1',
    sort: (c.req.query('sort') as 'recommended' | 'distance' | 'price' | 'rating') || undefined,
    limit: toInt(c.req.query('limit'), 24),
  });
  return ok(c, { places, count: places.length });
});

discovery.get('/places/:type/:slug', async (c) => {
  const type = c.req.param('type') as PlaceType;
  if (!['hotel', 'restaurant', 'attraction'].includes(type)) return fail(c, 'Unknown place type');
  const { lat, lng } = coords(c);
  const place = await getPlace(c.env, type, c.req.param('slug'), lat, lng);
  if (!place) return fail(c, 'Place not found', 404);
  const destination = await getDestinationBySlug(c.env, place.destination.slug);
  return ok(c, { place, destination: destination?.destination ?? null });
});

discovery.get('/nearby', async (c) => {
  const { lat, lng } = coords(c);
  if (typeof lat !== 'number' || typeof lng !== 'number') {
    return fail(c, 'Location is required. Enable location access or pass lat and lng.');
  }
  const radius = Math.min(200, Math.max(1, toNum(c.req.query('radius'), 25)));
  const [attractions, hotels, restaurants] = await Promise.all([
    listPlaces(c.env, { type: 'attraction', lat, lng, radiusKm: radius, sort: 'distance', limit: 12 }),
    listPlaces(c.env, { type: 'hotel', lat, lng, radiusKm: Math.max(radius, 25), sort: 'distance', limit: 8 }),
    listPlaces(c.env, { type: 'restaurant', lat, lng, radiusKm: Math.max(radius, 25), sort: 'distance', limit: 8 }),
  ]);
  const destinations = (await listDestinations(c.env, { lat, lng, limit: 40 }))
    .filter((d) => d.distanceKm !== null && d.distanceKm <= Math.max(radius * 4, 100))
    .slice(0, 6);
  const hidden = destinations.filter((d) => d.is_hidden);
  return ok(c, { lat, lng, radius, attractions, hotels, restaurants, destinations, hidden });
});

discovery.get('/search', async (c) => {
  const q = (c.req.query('q') || '').trim();
  if (q.length < 2) return ok(c, { destinations: [], places: [] });
  const { lat, lng } = coords(c);
  const destinations = await listDestinations(c.env, { q, limit: 5, lat, lng });
  const [hotels, restaurants, attractions] = await Promise.all([
    listPlaces(c.env, { type: 'hotel', q, limit: 3, lat, lng }),
    listPlaces(c.env, { type: 'restaurant', q, limit: 3, lat, lng }),
    listPlaces(c.env, { type: 'attraction', q, limit: 4, lat, lng }),
  ]);
  return ok(c, { destinations, places: [...hotels, ...restaurants, ...attractions] });
});

discovery.get('/recommendations', async (c) => {
  const user = await currentUser(c);
  let interests: string[] = (c.req.query('interests') || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  let budgetLevel = c.req.query('budget') || 'mid';
  let homeLat: number | undefined;
  let homeLng: number | undefined;

  if (user) {
    const prefs = await first<{ interests: string; budget_level: string }>(
      c.env.DB,
      'SELECT interests, budget_level FROM user_preferences WHERE user_id = ?',
      user.id,
    );
    if (prefs) {
      const saved = JSON.parse(String(prefs.interests ?? '[]')) as string[];
      if (!interests.length) interests = saved.map((s) => s.toLowerCase());
      budgetLevel = prefs.budget_level || budgetLevel;
    }
  }

  const visited = user
    ? await all<{ destination_id: number }>(c.env.DB, 'SELECT destination_id FROM heritage_passport WHERE user_id = ?', user.id)
    : [];
  const visitedIds = new Set(visited.map((v) => v.destination_id));

  const destinations = await listDestinations(c.env, { limit: 60, lat: homeLat, lng: homeLng });
  const budgetCap = budgetLevel === 'budget' ? 2800 : budgetLevel === 'luxury' ? 6000 : 4000;

  const scored = destinations
    .map((d) => {
      let score = d.popularity * 0.1;
      const matches = d.interests.filter((i) => interests.includes(i));
      score += matches.length * 14;
      if (d.avg_daily_budget <= budgetCap) score += 8;
      if (visitedIds.has(d.id)) score -= 12;
      if (d.is_hidden) score += 6;
      const reason = matches.length
        ? `Matches your interest in ${matches.slice(0, 2).join(' and ')}`
        : d.avg_daily_budget <= budgetCap
          ? 'Fits comfortably inside your budget'
          : 'A different direction from your usual trips';
      return { ...d, matchScore: Math.round(score), reason };
    })
    .sort((a, b) => b.matchScore - a.matchScore);

  const dna = interests.map((interest) => ({
    interest,
    strength: destinations.filter((d) => d.interests.includes(interest)).length,
  }));

  return ok(c, {
    recommendations: scored.slice(0, 8),
    dna,
    interests,
    budgetLevel,
    personalised: Boolean(user && interests.length),
  });
});

discovery.get('/guides', async (c) => {
  const guides = await all<Record<string, unknown>>(
    c.env.DB,
    `SELECT g.slug, g.title, g.excerpt, g.image, g.category, g.read_minutes, g.author, g.destination_id,
      d.name AS destination_name, d.slug AS destination_slug
     FROM guides g LEFT JOIN destinations d ON d.id = g.destination_id ORDER BY g.id ASC`,
  );
  return ok(c, { guides });
});

discovery.get('/guides/:slug', async (c) => {
  const guide = await first<Record<string, unknown>>(
    c.env.DB,
    `SELECT g.*, d.name AS destination_name, d.slug AS destination_slug
     FROM guides g LEFT JOIN destinations d ON d.id = g.destination_id WHERE g.slug = ?`,
    c.req.param('slug'),
  );
  if (!guide) return fail(c, 'Guide not found', 404);
  return ok(c, { guide });
});

discovery.get('/travel-dna', async (c) => {
  const user = await currentUser(c);
  if (!user) return fail(c, 'Sign in to see your Travel DNA', 401);
  const prefs = await first<{ interests: string; budget_level: string; pace: string }>(
    c.env.DB,
    'SELECT interests, budget_level, pace FROM user_preferences WHERE user_id = ?',
    user.id,
  );
  const visited = await all<{ interests: string; name: string }>(
    c.env.DB,
    `SELECT d.interests, d.name FROM heritage_passport hp JOIN destinations d ON d.id = hp.destination_id WHERE hp.user_id = ?`,
    user.id,
  );
  const interests = new Set<string>(JSON.parse(String(prefs?.interests ?? '[]')) as string[]);
  for (const row of visited) {
    for (const i of JSON.parse(String(row.interests ?? '[]')) as string[]) interests.add(i);
  }
  const dna = Array.from(interests).map((interest) => {
    const cats = INTEREST_CATEGORIES[interest.toLowerCase()] ?? [];
    const items = visited.filter((v) => (JSON.parse(String(v.interests ?? '[]')) as string[]).includes(interest));
    return {
      interest,
      categories: cats,
      destinationsVisited: items.length,
      strength: Math.min(100, 25 + items.length * 20 + (prefs?.interests.includes(interest) ? 25 : 0)),
    };
  });
  return ok(c, {
    dna: dna.sort((a, b) => b.strength - a.strength),
    visitedCount: visited.length,
    budgetLevel: prefs?.budget_level ?? 'mid',
    pace: prefs?.pace ?? 'balanced',
    topInterest: dna.sort((a, b) => b.strength - a.strength)[0]?.interest ?? null,
  });
});

export { attractionScore };
export default discovery;
