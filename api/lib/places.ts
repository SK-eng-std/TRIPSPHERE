import type { Env } from '../env';
import { all, first, parseJsonArray } from './db';
import { roadKm, haversineKm, travelMinutes } from './geo';

export type PlaceType = 'hotel' | 'restaurant' | 'attraction';

export interface PlaceQuery {
  type: PlaceType;
  q?: string;
  destinationId?: number;
  destinationSlug?: string;
  lat?: number;
  lng?: number;
  radiusKm?: number;
  minPrice?: number;
  maxPrice?: number;
  minRating?: number;
  cuisine?: string;
  category?: string;
  amenity?: string;
  hiddenOnly?: boolean;
  sort?: 'recommended' | 'distance' | 'price' | 'rating';
  limit?: number;
}

export interface Place {
  id: number;
  type: PlaceType;
  slug: string;
  name: string;
  summary: string;
  description: string;
  image: string;
  lat: number;
  lng: number;
  price: number;
  priceUnit: string;
  rating: number;
  reviews: number;
  tags: string[];
  kind: string;
  destination: { id: number; name: string; slug: string };
  distanceKm: number | null;
  travelMinutes: number | null;
  isHidden: boolean;
  extra: Record<string, string | number | null>;
}

const CONFIG: Record<PlaceType, { from: string; select: string; priceUnit: string; order: string }> = {
  hotel: {
    from: 'hotels p JOIN destinations d ON d.id = p.destination_id',
    select: `p.id, p.slug, p.name, p.summary, p.description, p.image, p.lat, p.lng,
      p.price_per_night AS price, p.rating, p.reviews_count AS reviews, p.amenities AS tags,
      p.type AS kind, 0 AS is_hidden, p.check_in_time, p.check_out_time, p.address, p.rooms_total`,
    priceUnit: 'per night',
    order: 'p.price_per_night',
  },
  restaurant: {
    from: 'restaurants p JOIN destinations d ON d.id = p.destination_id',
    select: `p.id, p.slug, p.name, p.summary, p.description, p.image, p.lat, p.lng,
      p.price_for_two AS price, p.rating, p.reviews_count AS reviews, p.cuisine AS tags,
      'restaurant' AS kind, 0 AS is_hidden, p.opening_hours, p.opens_at, p.closes_at, p.address, p.menu_summary`,
    priceUnit: 'for two',
    order: 'p.price_for_two',
  },
  attraction: {
    from: 'attractions p JOIN destinations d ON d.id = p.destination_id',
    select: `p.id, p.slug, p.name, p.summary, p.description, p.image, p.lat, p.lng,
      p.entry_fee AS price, p.rating, p.reviews_count AS reviews, p.category AS tags,
      p.category AS kind, p.is_hidden, p.opening_hours, p.entry_fee, p.avg_visit_minutes, p.tips, p.unesco`,
    priceUnit: 'entry',
    order: 'p.rating',
  },
};

type RawPlace = Record<string, unknown>;

function mapPlace(type: PlaceType, row: RawPlace, lat?: number, lng?: number): Place {
  const tagsRaw = row.tags;
  const tags =
    type === 'hotel'
      ? parseJsonArray(tagsRaw)
      : type === 'restaurant'
        ? String(tagsRaw ?? '')
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
        : [String(tagsRaw ?? '')].filter(Boolean);

  const plat = Number(row.lat);
  const plng = Number(row.lng);
  let distanceKm: number | null = null;
  if (typeof lat === 'number' && typeof lng === 'number') {
    distanceKm = roadKm(haversineKm(lat, lng, plat, plng));
  }

  const extra: Record<string, string | number | null> = {};
  for (const key of ['check_in_time', 'check_out_time', 'address', 'rooms_total', 'opening_hours', 'opens_at', 'closes_at', 'menu_summary', 'avg_visit_minutes', 'tips', 'unesco']) {
    if (row[key] !== undefined && row[key] !== null) extra[key] = row[key] as string | number;
  }

  return {
    id: Number(row.id),
    type,
    slug: String(row.slug),
    name: String(row.name),
    summary: String(row.summary),
    description: String(row.description),
    image: String(row.image),
    lat: plat,
    lng: plng,
    price: Number(row.price ?? 0),
    priceUnit: CONFIG[type].priceUnit,
    rating: Number(row.rating ?? 0),
    reviews: Number(row.reviews ?? 0),
    tags,
    kind: String(row.kind ?? type),
    destination: {
      id: Number(row.destination_id),
      name: String(row.destination_name),
      slug: String(row.destination_slug),
    },
    distanceKm,
    travelMinutes: distanceKm === null ? null : travelMinutes(distanceKm),
    isHidden: Number(row.is_hidden ?? 0) === 1,
    extra,
  };
}

export async function listPlaces(env: Env, query: PlaceQuery): Promise<Place[]> {
  const cfg = CONFIG[query.type];
  const where: string[] = ['1 = 1'];
  const params: unknown[] = [];

  if (query.q) {
    where.push('(p.name LIKE ? OR p.summary LIKE ? OR d.name LIKE ?)');
    const like = `%${query.q}%`;
    params.push(like, like, like);
  }
  if (query.destinationId) {
    where.push('p.destination_id = ?');
    params.push(query.destinationId);
  }
  if (query.destinationSlug) {
    where.push('d.slug = ?');
    params.push(query.destinationSlug);
  }
  if (typeof query.minPrice === 'number') {
    where.push(`${cfg.order} >= ?`);
    params.push(query.minPrice);
  }
  if (typeof query.maxPrice === 'number' && query.maxPrice > 0) {
    where.push(`${cfg.order} <= ?`);
    params.push(query.maxPrice);
  }
  if (typeof query.minRating === 'number' && query.minRating > 0) {
    where.push('p.rating >= ?');
    params.push(query.minRating);
  }
  if (query.cuisine && query.type === 'restaurant') {
    where.push('p.cuisine LIKE ?');
    params.push(`%${query.cuisine}%`);
  }
  if (query.category && query.type === 'attraction') {
    where.push('p.category = ?');
    params.push(query.category);
  }
  if (query.amenity && query.type === 'hotel') {
    where.push('p.amenities LIKE ?');
    params.push(`%${query.amenity}%`);
  }
  if (query.hiddenOnly && query.type === 'attraction') {
    where.push('p.is_hidden = 1');
  }

  const limit = Math.min(Math.max(query.limit ?? 24, 1), 80);
  const sql = `SELECT ${cfg.select}, d.id AS destination_id, d.name AS destination_name, d.slug AS destination_slug
    FROM ${cfg.from}
    WHERE ${where.join(' AND ')}
    LIMIT 400`;

  const rows = await all<RawPlace>(env.DB, sql, ...params);
  let places = rows.map((row) => mapPlace(query.type, row, query.lat, query.lng));

  if (query.radiusKm && typeof query.lat === 'number') {
    places = places.filter((p) => p.distanceKm !== null && p.distanceKm <= query.radiusKm!);
  }

  const sort = query.sort ?? 'recommended';
  if (sort === 'distance' && typeof query.lat === 'number') {
    places.sort((a, b) => (a.distanceKm ?? 1e9) - (b.distanceKm ?? 1e9));
  } else if (sort === 'price') {
    places.sort((a, b) => a.price - b.price);
  } else if (sort === 'rating') {
    places.sort((a, b) => b.rating - a.rating);
  } else {
    places.sort((a, b) => b.rating * Math.log10(b.reviews + 10) - a.rating * Math.log10(a.reviews + 10));
  }

  return places.slice(0, limit);
}

export async function getPlace(env: Env, type: PlaceType, slug: string, lat?: number, lng?: number): Promise<Place | null> {
  const cfg = CONFIG[type];
  const row = await first<RawPlace>(
    env.DB,
    `SELECT ${cfg.select}, d.id AS destination_id, d.name AS destination_name, d.slug AS destination_slug,
      d.lat AS destination_lat, d.lng AS destination_lng
     FROM ${cfg.from} WHERE p.slug = ?`,
    slug,
  );
  if (!row) return null;
  const place = mapPlace(type, row, lat, lng);
  const nearby = await all<RawPlace>(
    env.DB,
    `SELECT p.slug, p.name, p.rating, p.price_per_night AS price FROM hotels p
     WHERE p.destination_id = ? AND p.slug <> ? ORDER BY p.price_per_night ASC LIMIT 3`,
    place.destination.id,
    slug,
  ).catch(() => []);
  return Object.assign(place, {
    destinationCoords: { lat: Number(row.destination_lat), lng: Number(row.destination_lng) },
    otherStays: nearby.map((n) => ({ slug: n.slug, name: n.name, rating: Number(n.rating), price: Number(n.price) })),
  });
}

export interface Destination {
  id: number;
  slug: string;
  name: string;
  state: string;
  region: string;
  tagline: string;
  summary: string;
  description: string;
  image: string;
  lat: number;
  lng: number;
  best_season: string;
  ideal_days: number;
  avg_daily_budget: number;
  interests: string[];
  is_hidden: boolean;
  popularity: number;
  unesco: boolean;
  attraction_count: number;
  hotel_count: number;
  restaurant_count: number;
  from_price: number | null;
  distanceKm: number | null;
}

type RawDestination = Record<string, unknown>;

function mapDestination(row: RawDestination, lat?: number, lng?: number): Destination {
  const dlat = Number(row.lat);
  const dlng = Number(row.lng);
  return {
    id: Number(row.id),
    slug: String(row.slug),
    name: String(row.name),
    state: String(row.state),
    region: String(row.region),
    tagline: String(row.tagline),
    summary: String(row.summary),
    description: String(row.description),
    image: String(row.image),
    lat: dlat,
    lng: dlng,
    best_season: String(row.best_season),
    ideal_days: Number(row.ideal_days),
    avg_daily_budget: Number(row.avg_daily_budget),
    interests: parseJsonArray(row.interests),
    is_hidden: Number(row.is_hidden) === 1,
    popularity: Number(row.popularity),
    unesco: Number(row.unesco) === 1,
    attraction_count: Number(row.attraction_count ?? 0),
    hotel_count: Number(row.hotel_count ?? 0),
    restaurant_count: Number(row.restaurant_count ?? 0),
    from_price: row.from_price === null || row.from_price === undefined ? null : Number(row.from_price),
    distanceKm:
      typeof lat === 'number' && typeof lng === 'number' ? roadKm(haversineKm(lat, lng, dlat, dlng)) : null,
  };
}

const DESTINATION_SELECT = `SELECT d.*,
  (SELECT COUNT(*) FROM attractions a WHERE a.destination_id = d.id) AS attraction_count,
  (SELECT COUNT(*) FROM hotels h WHERE h.destination_id = d.id) AS hotel_count,
  (SELECT COUNT(*) FROM restaurants r WHERE r.destination_id = d.id) AS restaurant_count,
  (SELECT MIN(h.price_per_night) FROM hotels h WHERE h.destination_id = d.id) AS from_price
  FROM destinations d`;

export async function listDestinations(
  env: Env,
  opts: { q?: string; region?: string; interest?: string; hidden?: boolean; unesco?: boolean; limit?: number; lat?: number; lng?: number; ids?: number[] },
): Promise<Destination[]> {
  const where: string[] = ['1 = 1'];
  const params: unknown[] = [];
  if (opts.q) {
    where.push('(d.name LIKE ? OR d.state LIKE ? OR d.summary LIKE ? OR d.tagline LIKE ?)');
    const like = `%${opts.q}%`;
    params.push(like, like, like, like);
  }
  if (opts.region) {
    where.push('d.region = ?');
    params.push(opts.region);
  }
  if (opts.interest) {
    where.push('d.interests LIKE ?');
    params.push(`%"${opts.interest}"%`);
  }
  if (opts.hidden) where.push('d.is_hidden = 1');
  if (opts.unesco) where.push('d.unesco = 1');
  if (opts.ids && opts.ids.length) {
    where.push(`d.id IN (${opts.ids.map(() => '?').join(',')})`);
    params.push(...opts.ids);
  }
  const limit = Math.min(Math.max(opts.limit ?? 24, 1), 60);
  const rows = await all<RawDestination>(
    env.DB,
    `${DESTINATION_SELECT} WHERE ${where.join(' AND ')} ORDER BY d.popularity DESC LIMIT ${limit}`,
    ...params,
  );
  return rows.map((row) => mapDestination(row, opts.lat, opts.lng));
}

export async function getDestinationBySlug(env: Env, slug: string, lat?: number, lng?: number) {
  const row = await first<RawDestination>(env.DB, `${DESTINATION_SELECT} WHERE d.slug = ?`, slug);
  if (!row) return null;
  const destination = mapDestination(row, lat, lng);
  const attractions = await all<RawDestination>(
    env.DB,
    'SELECT * FROM attractions WHERE destination_id = ? ORDER BY is_hidden ASC, rating DESC',
    destination.id,
  );
  const hotels = await all<RawDestination>(
    env.DB,
    'SELECT * FROM hotels WHERE destination_id = ? ORDER BY price_per_night ASC',
    destination.id,
  );
  const restaurants = await all<RawDestination>(
    env.DB,
    'SELECT * FROM restaurants WHERE destination_id = ? ORDER BY rating DESC',
    destination.id,
  );
  const guides = await all<RawDestination>(
    env.DB,
    'SELECT slug, title, excerpt, image, category, read_minutes FROM guides WHERE destination_id = ?',
    destination.id,
  );
  return {
    destination,
    attractions: attractions.map((a) => mapPlace('attraction', { ...a, destination_id: destination.id, destination_name: destination.name, destination_slug: destination.slug })),
    hotels: hotels.map((h) => mapPlace('hotel', { ...h, destination_id: destination.id, destination_name: destination.name, destination_slug: destination.slug })),
    restaurants: restaurants.map((r) => mapPlace('restaurant', { ...r, destination_id: destination.id, destination_name: destination.name, destination_slug: destination.slug })),
    guides,
  };
}

export async function destinationById(env: Env, id: number) {
  const row = await first<RawDestination>(env.DB, `${DESTINATION_SELECT} WHERE d.id = ?`, id);
  return row ? mapDestination(row) : null;
}
