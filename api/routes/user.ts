import { Hono } from 'hono';
import type { Env } from '../env';
import { all, first, run } from '../lib/db';
import { currentUser, isSameOrigin } from '../lib/auth';
import { fail, ok, readJson, toInt } from '../lib/http';
import { randomToken } from '../lib/crypto';
import { notify } from '../lib/notify';
import { estimateBudget } from '../lib/planner';

const userRoutes = new Hono<{ Bindings: Env }>();

const PLACE_TYPES = ['destination', 'attraction', 'hotel', 'restaurant'] as const;
type SavedType = (typeof PLACE_TYPES)[number];

async function resolveSaved(env: Env, userId: number) {
  const rows = await all<{ id: number; place_type: SavedType; place_id: number; created_at: string }>(
    env.DB,
    'SELECT id, place_type, place_id, created_at FROM saved_places WHERE user_id = ? ORDER BY id DESC',
    userId,
  );
  if (!rows.length) return [];

  const ids = (type: SavedType) => rows.filter((r) => r.place_type === type).map((r) => r.place_id);
  const lookup = async (table: string, type: SavedType) => {
    const list = ids(type);
    if (!list.length) return new Map<number, Record<string, unknown>>();
    const found = await all<Record<string, unknown>>(
      env.DB,
      `SELECT id, name, slug, image, summary${type === 'hotel' ? ', price_per_night AS price' : type === 'restaurant' ? ', price_for_two AS price' : type === 'attraction' ? ', entry_fee AS price' : ', avg_daily_budget AS price'} FROM ${table} WHERE id IN (${list.map(() => '?').join(',')})`,
      ...list,
    );
    return new Map(found.map((row) => [Number(row.id), row]));
  };

  const [hotels, restaurants, attractions, destinations] = await Promise.all([
    lookup('hotels', 'hotel'),
    lookup('restaurants', 'restaurant'),
    lookup('attractions', 'attraction'),
    lookup('destinations', 'destination'),
  ]);

  const index: Record<SavedType, Map<number, Record<string, unknown>>> = {
    hotel: hotels,
    restaurant: restaurants,
    attraction: attractions,
    destination: destinations,
  };
  const hrefs: Record<SavedType, (slug: string) => string> = {
    hotel: (slug) => `/hotels/${slug}`,
    restaurant: (slug) => `/restaurants/${slug}`,
    attraction: (slug) => `/attractions?q=${encodeURIComponent(slug)}`,
    destination: (slug) => `/explore/${slug}`,
  };

  return rows
    .map((row) => {
      const record = index[row.place_type]?.get(row.place_id);
      if (!record) return null;
      return {
        id: row.id,
        placeType: row.place_type,
        placeId: row.place_id,
        name: String(record.name),
        slug: String(record.slug),
        image: String(record.image),
        summary: String(record.summary),
        price: record.price ?? null,
        href: hrefs[row.place_type](String(record.slug)),
        savedAt: row.created_at,
      };
    })
    .filter(Boolean);
}

userRoutes.get('/saved', async (c) => {
  const current = await currentUser(c);
  if (!current) return fail(c, 'Sign in first', 401);
  return ok(c, { saved: await resolveSaved(c.env, current.id) });
});

userRoutes.post('/saved', async (c) => {
  if (!isSameOrigin(c)) return fail(c, 'Cross-site request blocked', 403);
  const current = await currentUser(c);
  if (!current) return fail(c, 'Sign in to save places', 401);
  const body = await readJson<Record<string, unknown>>(c);
  const placeType = String(body.placeType ?? '') as SavedType;
  const placeId = toInt(body.placeId, 0);
  if (!PLACE_TYPES.includes(placeType) || !placeId) return fail(c, 'Invalid place');

  const existing = await first<{ id: number }>(
    c.env.DB,
    'SELECT id FROM saved_places WHERE user_id = ? AND place_type = ? AND place_id = ?',
    current.id,
    placeType,
    placeId,
  );
  if (existing) {
    await run(c.env.DB, 'DELETE FROM saved_places WHERE id = ?', existing.id);
    return ok(c, { saved: false });
  }
  await run(
    c.env.DB,
    'INSERT INTO saved_places (user_id, place_type, place_id) VALUES (?, ?, ?)',
    current.id,
    placeType,
    placeId,
  );
  return ok(c, { saved: true });
});

userRoutes.get('/preferences', async (c) => {
  const current = await currentUser(c);
  if (!current) return fail(c, 'Sign in first', 401);
  const prefs = await first<Record<string, unknown>>(
    c.env.DB,
    'SELECT * FROM user_preferences WHERE user_id = ?',
    current.id,
  );
  return ok(c, {
    preferences: prefs
      ? { ...prefs, interests: JSON.parse(String(prefs.interests ?? '[]')) }
      : { interests: [], budget_level: 'mid', pace: 'balanced', transport: 'car' },
  });
});

userRoutes.put('/preferences', async (c) => {
  if (!isSameOrigin(c)) return fail(c, 'Cross-site request blocked', 403);
  const current = await currentUser(c);
  if (!current) return fail(c, 'Sign in first', 401);
  const body = await readJson<Record<string, unknown>>(c);
  const interests = Array.isArray(body.interests) ? body.interests.map(String).slice(0, 12) : [];
  const budgetLevel = ['budget', 'mid', 'luxury'].includes(String(body.budgetLevel)) ? String(body.budgetLevel) : 'mid';
  const pace = ['slow', 'balanced', 'packed'].includes(String(body.pace)) ? String(body.pace) : 'balanced';
  const transport = String(body.transport ?? 'car').slice(0, 20);
  const dietary = String(body.dietary ?? '').slice(0, 120);

  await run(
    c.env.DB,
    `INSERT INTO user_preferences (user_id, interests, budget_level, pace, transport, dietary, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(user_id) DO UPDATE SET interests = excluded.interests, budget_level = excluded.budget_level,
       pace = excluded.pace, transport = excluded.transport, dietary = excluded.dietary, updated_at = datetime('now')`,
    current.id,
    JSON.stringify(interests),
    budgetLevel,
    pace,
    transport,
    dietary || null,
  );
  return ok(c, { preferences: { interests, budgetLevel, pace, transport, dietary } });
});

userRoutes.patch('/profile', async (c) => {
  if (!isSameOrigin(c)) return fail(c, 'Cross-site request blocked', 403);
  const current = await currentUser(c);
  if (!current) return fail(c, 'Sign in first', 401);
  const body = await readJson<Record<string, unknown>>(c);
  const name = body.name !== undefined ? String(body.name).trim().slice(0, 80) : undefined;
  const bio = body.bio !== undefined ? String(body.bio).slice(0, 300) : undefined;
  const homeCity = body.homeCity !== undefined ? String(body.homeCity).slice(0, 80) : undefined;
  const phone = body.phone !== undefined ? String(body.phone).slice(0, 30) : undefined;

  if (name !== undefined) {
    if (name.length < 2) return fail(c, 'Name is too short');
    await run(c.env.DB, 'UPDATE users SET name = ? WHERE id = ?', name, current.id);
  }
  await run(
    c.env.DB,
    `INSERT INTO user_profiles (user_id, bio, home_city, phone) VALUES (?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET bio = COALESCE(excluded.bio, user_profiles.bio),
       home_city = COALESCE(excluded.home_city, user_profiles.home_city), phone = COALESCE(excluded.phone, user_profiles.phone)`,
    current.id,
    bio ?? null,
    homeCity ?? null,
    phone ?? null,
  );
  const profile = await first<Record<string, unknown>>(c.env.DB, 'SELECT * FROM user_profiles WHERE user_id = ?', current.id);
  return ok(c, { profile, name: name ?? current.name });
});

const BADGES = [
  { id: 'first-step', label: 'First Step', description: 'Log your first destination in the passport', threshold: 1 },
  { id: 'explorer', label: 'Explorer', description: 'Visit five destinations', threshold: 5 },
  { id: 'heritage-keeper', label: 'Heritage Keeper', description: 'Visit three UNESCO destinations', threshold: 3 },
  { id: 'wanderer', label: 'Wanderer', description: 'Save three trips', threshold: 3 },
  { id: 'photographer', label: 'Photographer', description: 'Upload five travel photographs', threshold: 5 },
  { id: 'hidden-gem-hunter', label: 'Hidden Gem Hunter', description: 'Reach two hidden-gem destinations', threshold: 2 },
  { id: 'planner', label: 'Master Planner', description: 'Generate a shared itinerary', threshold: 1 },
  { id: 'foodie', label: 'Table Hunter', description: 'Log three restaurant reservations', threshold: 3 },
];

userRoutes.get('/passport', async (c) => {
  const current = await currentUser(c);
  if (!current) return fail(c, 'Sign in first', 401);
  const entries = await all<Record<string, unknown>>(
    c.env.DB,
    `SELECT hp.*, d.name AS destination_name, d.slug AS destination_slug, d.state, d.image, d.unesco, d.is_hidden
     FROM heritage_passport hp JOIN destinations d ON d.id = hp.destination_id
     WHERE hp.user_id = ? ORDER BY hp.visited_on DESC`,
    current.id,
  );
  const trips = await first<{ c: number; shared: number }>(
    c.env.DB,
    'SELECT COUNT(*) AS c, SUM(CASE WHEN share_token IS NOT NULL THEN 1 ELSE 0 END) AS shared FROM itineraries WHERE user_id = ?',
    current.id,
  );
  const photos = await first<{ c: number }>(c.env.DB, 'SELECT COUNT(*) AS c FROM travel_photos WHERE user_id = ?', current.id);
  const reservations = await first<{ c: number }>(
    c.env.DB,
    'SELECT COUNT(*) AS c FROM restaurant_reservations WHERE user_id = ?',
    current.id,
  );

  const uniqueDestinations = new Set(entries.map((e) => Number(e.destination_id))).size;
  const unescoCount = new Set(entries.filter((e) => Number(e.unesco) === 1).map((e) => Number(e.destination_id))).size;
  const hiddenCount = new Set(entries.filter((e) => Number(e.is_hidden) === 1).map((e) => Number(e.destination_id))).size;

  const metrics: Record<string, number> = {
    'first-step': uniqueDestinations,
    explorer: uniqueDestinations,
    'heritage-keeper': unescoCount,
    wanderer: Number(trips?.c ?? 0),
    photographer: Number(photos?.c ?? 0),
    'hidden-gem-hunter': hiddenCount,
    planner: Number(trips?.shared ?? 0),
    foodie: Number(reservations?.c ?? 0),
  };

  const badges = BADGES.map((badge) => ({
    ...badge,
    progress: Math.min(100, Math.round(((metrics[badge.id] ?? 0) / badge.threshold) * 100)),
    earned: (metrics[badge.id] ?? 0) >= badge.threshold,
  }));

  return ok(c, {
    entries,
    stats: {
      destinations: uniqueDestinations,
      entries: entries.length,
      unesco: unescoCount,
      hidden: hiddenCount,
      trips: Number(trips?.c ?? 0),
      photos: Number(photos?.c ?? 0),
      stamps: entries.length,
    },
    badges,
  });
});

userRoutes.post('/passport', async (c) => {
  if (!isSameOrigin(c)) return fail(c, 'Cross-site request blocked', 403);
  const current = await currentUser(c);
  if (!current) return fail(c, 'Sign in first', 401);
  const body = await readJson<Record<string, unknown>>(c);
  const destinationId = toInt(body.destinationId, 0);
  const visitedOn = String(body.visitedOn ?? new Date().toISOString().slice(0, 10));
  const notes = String(body.notes ?? '').slice(0, 400);
  const rating = Math.min(5, Math.max(1, toInt(body.rating, 5)));
  const attractionId = toInt(body.attractionId, 0) || null;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(visitedOn)) return fail(c, 'Choose a valid visit date');
  const destination = await first<{ id: number; name: string }>(c.env.DB, 'SELECT id, name FROM destinations WHERE id = ?', destinationId);
  if (!destination) return fail(c, 'Destination not found', 404);

  const id = await run(
    c.env.DB,
    'INSERT INTO heritage_passport (user_id, destination_id, attraction_id, visited_on, notes, rating) VALUES (?, ?, ?, ?, ?, ?)',
    current.id,
    destinationId,
    attractionId,
    visitedOn,
    notes || null,
    rating,
  );
  await notify(c.env, current.id, {
    title: `Passport stamp added: ${destination.name}`,
    body: 'Your digital travel passport has a new entry.',
    kind: 'passport',
    link: '/passport',
  });
  return ok(c, { id }, 201);
});

userRoutes.delete('/passport/:id', async (c) => {
  if (!isSameOrigin(c)) return fail(c, 'Cross-site request blocked', 403);
  const current = await currentUser(c);
  if (!current) return fail(c, 'Sign in first', 401);
  await run(
    c.env.DB,
    'DELETE FROM heritage_passport WHERE id = ? AND user_id = ?',
    toInt(c.req.param('id'), 0),
    current.id,
  );
  return ok(c, { ok: true });
});

userRoutes.get('/photos', async (c) => {
  const current = await currentUser(c);
  if (!current) return fail(c, 'Sign in first', 401);
  const photos = await all<Record<string, unknown>>(
    c.env.DB,
    `SELECT p.id, p.caption, p.object_key, p.created_at, p.destination_id, d.name AS destination_name, d.slug AS destination_slug
     FROM travel_photos p LEFT JOIN destinations d ON d.id = p.destination_id
     WHERE p.user_id = ? ORDER BY p.created_at DESC`,
    current.id,
  );
  return ok(c, {
    photos: photos.map((p) => ({ ...p, url: `/api/photos/${p.id}/file` })),
  });
});

userRoutes.post('/photos', async (c) => {
  if (!isSameOrigin(c)) return fail(c, 'Cross-site request blocked', 403);
  const current = await currentUser(c);
  if (!current) return fail(c, 'Sign in first', 401);
  let form: FormData;
  try {
    form = await c.req.formData();
  } catch {
    return fail(c, 'Upload a photo file');
  }
  const entry = form.get('file');
  if (!entry || typeof entry === 'string') return fail(c, 'Upload a photo file');
  const file = entry as File;
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) return fail(c, 'Use a JPEG, PNG or WebP image');
  if (file.size > 5 * 1024 * 1024) return fail(c, 'Photos must be under 5 MB');

  const buffer = await file.arrayBuffer();
  const extension = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg';
  const key = `photos/${current.id}/${randomToken(8)}.${extension}`;
  await c.env.FILES.put(key, buffer, { httpMetadata: { contentType: file.type } });

  const caption = String(form.get('caption') ?? '').slice(0, 200);
  const destinationId = toInt(form.get('destinationId'), 0) || null;
  const tripId = toInt(form.get('itineraryId'), 0) || null;
  const id = await run(
    c.env.DB,
    'INSERT INTO travel_photos (user_id, itinerary_id, destination_id, caption, object_key, content_type) VALUES (?, ?, ?, ?, ?, ?)',
    current.id,
    tripId,
    destinationId,
    caption,
    key,
    file.type,
  );
  return ok(c, { photo: { id, caption, url: `/api/photos/${id}/file` } }, 201);
});

userRoutes.get('/photos/:id/file', async (c) => {
  const current = await currentUser(c);
  if (!current) return fail(c, 'Sign in first', 401);
  const photo = await first<{ object_key: string; content_type: string; user_id: number }>(
    c.env.DB,
    'SELECT object_key, content_type, user_id FROM travel_photos WHERE id = ?',
    toInt(c.req.param('id'), 0),
  );
  if (!photo || photo.user_id !== current.id) return fail(c, 'Photo not found', 404);
  const object = await c.env.FILES.get(photo.object_key);
  if (!object) return fail(c, 'Photo file missing', 404);
  return new Response(object.body as unknown as BodyInit, {
    headers: {
      'content-type': photo.content_type,
      'cache-control': 'private, max-age=3600',
      'x-content-type-options': 'nosniff',
    },
  });
});

userRoutes.delete('/photos/:id', async (c) => {
  if (!isSameOrigin(c)) return fail(c, 'Cross-site request blocked', 403);
  const current = await currentUser(c);
  if (!current) return fail(c, 'Sign in first', 401);
  const photo = await first<{ id: number; object_key: string }>(
    c.env.DB,
    'SELECT id, object_key FROM travel_photos WHERE id = ? AND user_id = ?',
    toInt(c.req.param('id'), 0),
    current.id,
  );
  if (!photo) return fail(c, 'Photo not found', 404);
  await c.env.FILES.delete(photo.object_key).catch(() => undefined);
  await run(c.env.DB, 'DELETE FROM travel_photos WHERE id = ? AND user_id = ?', photo.id, current.id);
  return ok(c, { ok: true });
});

userRoutes.get('/notifications', async (c) => {
  const current = await currentUser(c);
  if (!current) return fail(c, 'Sign in first', 401);
  const notifications = await all<Record<string, unknown>>(
    c.env.DB,
    'SELECT id, title, body, kind, link, read, created_at FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 40',
    current.id,
  );
  const unread = notifications.filter((n) => Number(n.read) === 0).length;
  return ok(c, { notifications, unread });
});

userRoutes.post('/notifications/read', async (c) => {
  if (!isSameOrigin(c)) return fail(c, 'Cross-site request blocked', 403);
  const current = await currentUser(c);
  if (!current) return fail(c, 'Sign in first', 401);
  await run(c.env.DB, 'UPDATE notifications SET read = 1 WHERE user_id = ?', current.id);
  return ok(c, { ok: true });
});

userRoutes.delete('/notifications', async (c) => {
  if (!isSameOrigin(c)) return fail(c, 'Cross-site request blocked', 403);
  const current = await currentUser(c);
  if (!current) return fail(c, 'Sign in first', 401);
  await run(c.env.DB, 'DELETE FROM notifications WHERE user_id = ?', current.id);
  return ok(c, { ok: true });
});

userRoutes.get('/expenses', async (c) => {
  const current = await currentUser(c);
  if (!current) return fail(c, 'Sign in first', 401);
  const itineraryId = toInt(c.req.query('itineraryId'), 0);
  const expenses = await all<Record<string, unknown>>(
    c.env.DB,
    `SELECT e.*, i.title AS itinerary_title FROM travel_expenses e
     LEFT JOIN itineraries i ON i.id = e.itinerary_id
     WHERE e.user_id = ? ${itineraryId ? 'AND e.itinerary_id = ?' : ''} ORDER BY e.spent_on DESC, e.id DESC`,
    ...(itineraryId ? [current.id, itineraryId] : [current.id]),
  );
  const totals: Record<string, number> = {};
  for (const expense of expenses) {
    const category = String(expense.category);
    totals[category] = (totals[category] ?? 0) + Number(expense.amount);
  }
  return ok(c, { expenses, totals, total: Object.values(totals).reduce((a, b) => a + b, 0) });
});

userRoutes.post('/expenses', async (c) => {
  if (!isSameOrigin(c)) return fail(c, 'Cross-site request blocked', 403);
  const current = await currentUser(c);
  if (!current) return fail(c, 'Sign in first', 401);
  const body = await readJson<Record<string, unknown>>(c);
  const category = ['accommodation', 'food', 'transport', 'activities', 'other'].includes(String(body.category))
    ? String(body.category)
    : 'other';
  const amount = Math.max(1, toInt(body.amount, 0));
  const label = String(body.label ?? category).slice(0, 120);
  const spentOn = /^\d{4}-\d{2}-\d{2}$/.test(String(body.spentOn)) ? String(body.spentOn) : new Date().toISOString().slice(0, 10);
  const itineraryId = toInt(body.itineraryId, 0) || null;
  if (!amount) return fail(c, 'Enter an amount');
  const id = await run(
    c.env.DB,
    'INSERT INTO travel_expenses (user_id, itinerary_id, category, label, amount, spent_on) VALUES (?, ?, ?, ?, ?, ?)',
    current.id,
    itineraryId,
    category,
    label,
    amount,
    spentOn,
  );
  return ok(c, { id }, 201);
});

userRoutes.delete('/expenses/:id', async (c) => {
  if (!isSameOrigin(c)) return fail(c, 'Cross-site request blocked', 403);
  const current = await currentUser(c);
  if (!current) return fail(c, 'Sign in first', 401);
  await run(c.env.DB, 'DELETE FROM travel_expenses WHERE id = ? AND user_id = ?', toInt(c.req.param('id'), 0), current.id);
  return ok(c, { ok: true });
});

userRoutes.get('/budget/estimate', async (c) => {
  const destinationId = toInt(c.req.query('destinationId'), 0);
  if (!destinationId) return fail(c, 'Choose a destination');
  const estimate = await estimateBudget(c.env, {
    destinationId,
    nights: Math.min(30, Math.max(1, toInt(c.req.query('nights'), 2))),
    travellers: Math.min(20, Math.max(1, toInt(c.req.query('travellers'), 2))),
    transport: c.req.query('transport') || 'car',
    hotelPrice: toInt(c.req.query('hotelPrice'), 0) || undefined,
  });
  if (!estimate) return fail(c, 'Destination not found', 404);
  return ok(c, { estimate });
});

userRoutes.get('/dashboard', async (c) => {
  const current = await currentUser(c);
  if (!current) return fail(c, 'Sign in first', 401);
  const today = new Date().toISOString().slice(0, 10);

  const [profile, preferences, trips, bookings, reservations, saved, passport, photos, notifications, dna] = await Promise.all([
    first<Record<string, unknown>>(c.env.DB, 'SELECT * FROM user_profiles WHERE user_id = ?', current.id),
    first<Record<string, unknown>>(c.env.DB, 'SELECT * FROM user_preferences WHERE user_id = ?', current.id),
    all<Record<string, unknown>>(
      c.env.DB,
      `SELECT i.id, i.title, i.start_date, i.end_date, i.status, i.travellers, i.budget, i.ai_mode,
        d.name AS destination_name, d.slug AS destination_slug, d.image AS destination_image,
        (SELECT COUNT(*) FROM itinerary_items it WHERE it.itinerary_id = i.id) AS item_count
       FROM itineraries i LEFT JOIN destinations d ON d.id = i.destination_id
       WHERE i.user_id = ? ORDER BY i.start_date DESC, i.id DESC`,
      current.id,
    ),
    all<Record<string, unknown>>(
      c.env.DB,
      `SELECT b.id, b.reference, b.check_in, b.check_out, b.nights, b.guests, b.rooms, b.total_amount, b.status, b.mode,
        h.name AS hotel_name, h.slug AS hotel_slug, h.image AS hotel_image, d.name AS destination_name
       FROM hotel_bookings b JOIN hotels h ON h.id = b.hotel_id JOIN destinations d ON d.id = h.destination_id
       WHERE b.user_id = ? ORDER BY b.id DESC LIMIT 8`,
      current.id,
    ),
    all<Record<string, unknown>>(
      c.env.DB,
      `SELECT r.id, r.reference, r.date, r.time, r.guests, r.status, r.mode, res.name AS restaurant_name,
        res.slug AS restaurant_slug, res.image AS restaurant_image, res.cuisine, d.name AS destination_name
       FROM restaurant_reservations r JOIN restaurants res ON res.id = r.restaurant_id
       JOIN destinations d ON d.id = res.destination_id
       WHERE r.user_id = ? ORDER BY r.id DESC LIMIT 8`,
      current.id,
    ),
    resolveSaved(c.env, current.id),
    first<{ entries: number; destinations: number; unesco: number }>(
      c.env.DB,
      `SELECT COUNT(*) AS entries,
        COUNT(DISTINCT hp.destination_id) AS destinations,
        COUNT(DISTINCT CASE WHEN d.unesco = 1 THEN hp.destination_id END) AS unesco
       FROM heritage_passport hp JOIN destinations d ON d.id = hp.destination_id WHERE hp.user_id = ?`,
      current.id,
    ),
    all<Record<string, unknown>>(
      c.env.DB,
      'SELECT id, caption, created_at FROM travel_photos WHERE user_id = ? ORDER BY id DESC LIMIT 6',
      current.id,
    ),
    all<Record<string, unknown>>(
      c.env.DB,
      'SELECT id, title, body, kind, link, read, created_at FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 8',
      current.id,
    ),
    first<{ interests: string; budget_level: string }>(
      c.env.DB,
      'SELECT interests, budget_level FROM user_preferences WHERE user_id = ?',
      current.id,
    ),
  ]);

  const upcoming = trips.filter((t) => String(t.status) === 'planned' && (!t.end_date || String(t.end_date) >= today));
  const past = trips.filter((t) => String(t.status) === 'completed' || (t.end_date && String(t.end_date) < today));

  return ok(c, {
    user: current,
    profile,
    preferences: preferences
      ? { ...preferences, interests: JSON.parse(String(preferences.interests ?? '[]')) }
      : { interests: [], budget_level: 'mid', pace: 'balanced', transport: 'car' },
    trips: { upcoming, past, all: trips },
    bookings,
    reservations,
    saved,
    passport: passport ?? { entries: 0, destinations: 0, unesco: 0 },
    photos: photos.map((p) => ({ ...p, url: `/api/photos/${p.id}/file` })),
    notifications,
    unread: notifications.filter((n) => Number(n.read) === 0).length,
    travelDNA: dna ? JSON.parse(String(dna.interests ?? '[]')) : [],
  });
});

export default userRoutes;
