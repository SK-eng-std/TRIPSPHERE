import { Hono } from 'hono';
import type { Env } from '../env';
import { all, first, run } from '../lib/db';
import { currentUser, isSameOrigin } from '../lib/auth';
import { fail, ok, readJson, toInt, toNum } from '../lib/http';
import { randomToken } from '../lib/crypto';
import { generateItinerary } from '../lib/ai';
import { estimateBudget } from '../lib/planner';
import { destinationById } from '../lib/places';
import { notify } from '../lib/notify';
import type { PlanInput } from '../lib/planner';

const trips = new Hono<{ Bindings: Env }>();

interface TripBody {
  destinationId?: number;
  origin?: string;
  startDate?: string;
  endDate?: string;
  travellers?: number;
  budget?: number;
  transport?: string;
  interests?: string[];
  pace?: string;
  title?: string;
  summary?: string;
  mode?: string;
  items?: Record<string, unknown>[];
}

function planInput(body: TripBody): PlanInput {
  return {
    destinationId: toInt(body.destinationId, 0),
    origin: String(body.origin ?? '').slice(0, 120),
    startDate: body.startDate ? String(body.startDate) : undefined,
    endDate: body.endDate ? String(body.endDate) : undefined,
    travellers: Math.min(20, Math.max(1, toInt(body.travellers, 2))),
    budget: Math.max(0, toInt(body.budget, 20000)),
    transport: String(body.transport ?? 'car'),
    interests: Array.isArray(body.interests) ? body.interests.map(String).slice(0, 8) : [],
    pace: String(body.pace ?? 'balanced'),
  };
}

async function loadTrip(env: Env, id: number, userId: number) {
  const trip = await first<Record<string, unknown>>(
    env.DB,
    'SELECT * FROM itineraries WHERE id = ? AND user_id = ?',
    id,
    userId,
  );
  if (!trip) return null;
  const items = await all<Record<string, unknown>>(
    env.DB,
    'SELECT * FROM itinerary_items WHERE itinerary_id = ? ORDER BY day ASC, sort_order ASC, id ASC',
    id,
  );
  const destination = trip.destination_id ? await destinationById(env, Number(trip.destination_id)) : null;
  return {
    ...trip,
    interests: JSON.parse(String(trip.interests ?? '[]')),
    items,
    destination,
  };
}

trips.post('/generate', async (c) => {
  if (!isSameOrigin(c)) return fail(c, 'Cross-site request blocked', 403);
  const body = await readJson<TripBody>(c);
  const input = planInput(body);
  if (!input.destinationId) return fail(c, 'Choose a destination first');
  const destination = await destinationById(c.env, input.destinationId);
  if (!destination) return fail(c, 'Destination not found', 404);

  const plan = await generateItinerary(c.env, input);
  if (!plan) return fail(c, 'Could not build an itinerary for that destination', 500);
  return ok(c, { plan, destination });
});

trips.post('/share/:token', async (c) => fail(c, 'Not supported', 405));

trips.get('/share/:token', async (c) => {
  const token = c.req.param('token');
  const trip = await first<Record<string, unknown>>(c.env.DB, 'SELECT * FROM itineraries WHERE share_token = ?', token);
  if (!trip) return fail(c, 'This shared trip does not exist or the link has expired', 404);
  const items = await all<Record<string, unknown>>(
    c.env.DB,
    'SELECT * FROM itinerary_items WHERE itinerary_id = ? ORDER BY day ASC, sort_order ASC, id ASC',
    Number(trip.id),
  );
  const destination = trip.destination_id ? await destinationById(c.env, Number(trip.destination_id)) : null;
  const owner = await first<{ name: string }>(c.env.DB, 'SELECT name FROM users WHERE id = ?', Number(trip.user_id));
  return ok(c, {
    trip: {
      ...trip,
      interests: JSON.parse(String(trip.interests ?? '[]')),
      items,
      destination,
      ownerName: owner?.name?.split(' ')[0] ?? 'A traveller',
      shared: true,
    },
  });
});

trips.get('/', async (c) => {
  const user = await currentUser(c);
  if (!user) return fail(c, 'Sign in to see your trips', 401);
  const rows = await all<Record<string, unknown>>(
    c.env.DB,
    `SELECT i.*, d.name AS destination_name, d.image AS destination_image, d.state AS destination_state,
      (SELECT COUNT(*) FROM itinerary_items it WHERE it.itinerary_id = i.id) AS item_count
     FROM itineraries i LEFT JOIN destinations d ON d.id = i.destination_id
     WHERE i.user_id = ? ORDER BY i.start_date DESC, i.id DESC`,
    user.id,
  );
  return ok(c, {
    trips: rows.map((t) => ({ ...t, interests: JSON.parse(String(t.interests ?? '[]')) })),
  });
});

trips.post('/', async (c) => {
  if (!isSameOrigin(c)) return fail(c, 'Cross-site request blocked', 403);
  const user = await currentUser(c);
  if (!user) return fail(c, 'Sign in to save a trip', 401);
  const body = await readJson<TripBody>(c);
  const input = planInput(body);
  if (!input.destinationId) return fail(c, 'Choose a destination first');
  const destination = await destinationById(c.env, input.destinationId);
  if (!destination) return fail(c, 'Destination not found', 404);

  let planTitle = String(body.title ?? '').slice(0, 120);
  let planSummary = String(body.summary ?? '').slice(0, 700);
  let planMode = String(body.mode ?? 'smart-engine').slice(0, 30);
  let items = Array.isArray(body.items) ? body.items.slice(0, 60) : [];

  if (!items.length) {
    const generated = await generateItinerary(c.env, input);
    if (!generated) return fail(c, 'Could not build an itinerary', 500);
    planTitle = generated.title;
    planSummary = generated.summary;
    planMode = generated.mode;
    items = generated.items as unknown as Record<string, unknown>[];
  }

  const tripId = await run(
    c.env.DB,
    `INSERT INTO itineraries (user_id, title, origin, destination_id, start_date, end_date, travellers, budget, transport, interests, pace, status, summary, ai_mode)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'planned', ?, ?)`,
    user.id,
    planTitle || `${destination.name} trip`,
    input.origin || null,
    input.destinationId,
    input.startDate || null,
    input.endDate || null,
    input.travellers,
    input.budget,
    input.transport,
    JSON.stringify(input.interests),
    input.pace,
    planSummary,
    planMode,
  );

  let order = 0;
  for (const item of items) {
    const day = Math.min(14, Math.max(1, toNum(item.day, 1)));
    order += 1;
    await run(
      c.env.DB,
      `INSERT INTO itinerary_items (itinerary_id, day, slot, time, title, place_type, place_id, notes, duration_minutes, cost, lat, lng, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      tripId,
      day,
      String(item.slot ?? 'morning').slice(0, 20),
      String(item.time ?? '09:00').slice(0, 5),
      String(item.title ?? 'Stop').slice(0, 160),
      String(item.placeType ?? 'custom').slice(0, 20),
      item.placeId ? toInt(item.placeId, 0) : null,
      String(item.notes ?? '').slice(0, 400),
      Math.min(600, Math.max(15, toNum(item.durationMinutes, 90))),
      Math.max(0, toNum(item.cost, 0)),
      Number.isFinite(Number(item.lat)) ? Number(item.lat) : null,
      Number.isFinite(Number(item.lng)) ? Number(item.lng) : null,
      order,
    );
  }

  await notify(c.env, user.id, {
    title: 'Trip saved',
    body: `Your itinerary for ${destination.name} is ready. Add stays, tables or attractions whenever you like.`,
    kind: 'trip',
    link: `/trips/${tripId}`,
  });

  const trip = await loadTrip(c.env, tripId, user.id);
  return ok(c, { trip }, 201);
});

trips.get('/:id', async (c) => {
  const user = await currentUser(c);
  if (!user) return fail(c, 'Sign in to open this trip', 401);
  const trip = await loadTrip(c.env, toInt(c.req.param('id'), 0), user.id);
  if (!trip) return fail(c, 'Trip not found', 404);
  return ok(c, { trip });
});

trips.patch('/:id', async (c) => {
  if (!isSameOrigin(c)) return fail(c, 'Cross-site request blocked', 403);
  const user = await currentUser(c);
  if (!user) return fail(c, 'Sign in first', 401);
  const id = toInt(c.req.param('id'), 0);
  const existing = await first<{ id: number }>(c.env.DB, 'SELECT id FROM itineraries WHERE id = ? AND user_id = ?', id, user.id);
  if (!existing) return fail(c, 'Trip not found', 404);
  const body = await readJson<Record<string, unknown>>(c);
  const updates: string[] = [];
  const params: unknown[] = [];
  const fields: [string, (v: unknown) => unknown][] = [
    ['title', (v) => String(v).slice(0, 120)],
    ['start_date', (v) => String(v).slice(0, 10)],
    ['end_date', (v) => String(v).slice(0, 10)],
    ['status', (v) => String(v).slice(0, 20)],
    ['notes', (v) => String(v).slice(0, 1000)],
    ['travellers', (v) => Math.min(20, Math.max(1, toInt(v, 2)))],
    ['budget', (v) => Math.max(0, toInt(v, 0))],
  ];
  for (const [field, cast] of fields) {
    if (body[field] !== undefined) {
      updates.push(`${field} = ?`);
      params.push(cast(body[field]));
    }
  }
  if (!updates.length) return fail(c, 'Nothing to update');
  updates.push("updated_at = datetime('now')");
  await run(c.env.DB, `UPDATE itineraries SET ${updates.join(', ')} WHERE id = ? AND user_id = ?`, ...params, id, user.id);
  const trip = await loadTrip(c.env, id, user.id);
  return ok(c, { trip });
});

trips.delete('/:id', async (c) => {
  if (!isSameOrigin(c)) return fail(c, 'Cross-site request blocked', 403);
  const user = await currentUser(c);
  if (!user) return fail(c, 'Sign in first', 401);
  const id = toInt(c.req.param('id'), 0);
  await run(c.env.DB, 'DELETE FROM itineraries WHERE id = ? AND user_id = ?', id, user.id);
  return ok(c, { ok: true });
});

trips.post('/:id/share', async (c) => {
  if (!isSameOrigin(c)) return fail(c, 'Cross-site request blocked', 403);
  const user = await currentUser(c);
  if (!user) return fail(c, 'Sign in first', 401);
  const id = toInt(c.req.param('id'), 0);
  const trip = await first<{ id: number; share_token: string | null }>(
    c.env.DB,
    'SELECT id, share_token FROM itineraries WHERE id = ? AND user_id = ?',
    id,
    user.id,
  );
  if (!trip) return fail(c, 'Trip not found', 404);
  let token = trip.share_token;
  if (!token) {
    token = randomToken(9);
    await run(c.env.DB, 'UPDATE itineraries SET share_token = ? WHERE id = ? AND user_id = ?', token, id, user.id);
  }
  return ok(c, { token, path: `/share/${token}` });
});

trips.get('/:id/budget', async (c) => {
  const user = await currentUser(c);
  if (!user) return fail(c, 'Sign in first', 401);
  const trip = await first<Record<string, unknown>>(
    c.env.DB,
    'SELECT * FROM itineraries WHERE id = ? AND user_id = ?',
    toInt(c.req.param('id'), 0),
    user.id,
  );
  if (!trip) return fail(c, 'Trip not found', 404);
  const start = String(trip.start_date ?? '');
  const end = String(trip.end_date ?? '');
  const nights = start && end ? Math.max(1, Math.round((Date.parse(end) - Date.parse(start)) / 86_400_000)) : 2;
  const stay = await first<{ price_per_night: number }>(
    c.env.DB,
    `SELECT h.price_per_night FROM itinerary_items i JOIN hotels h ON h.id = i.place_id
     WHERE i.itinerary_id = ? AND i.place_type = 'hotel' ORDER BY i.sort_order ASC LIMIT 1`,
    Number(trip.id),
  ).catch(() => null);
  const estimate = trip.destination_id
    ? await estimateBudget(c.env, {
        destinationId: Number(trip.destination_id),
        nights,
        travellers: Number(trip.travellers ?? 2),
        transport: String(trip.transport ?? 'car'),
        hotelPrice: stay?.price_per_night,
      })
    : null;
  const items = await all<{ cost: number; place_type: string }>(
    c.env.DB,
    'SELECT cost, place_type FROM itinerary_items WHERE itinerary_id = ?',
    Number(trip.id),
  );
  return ok(c, {
    estimate,
    bookedBudget: Number(trip.budget ?? 0),
    itineraryCost: items.reduce((sum, i) => sum + Number(i.cost ?? 0), 0),
    items: items.length,
  });
});

trips.post('/:id/items', async (c) => {
  if (!isSameOrigin(c)) return fail(c, 'Cross-site request blocked', 403);
  const user = await currentUser(c);
  if (!user) return fail(c, 'Sign in first', 401);
  const id = toInt(c.req.param('id'), 0);
  const trip = await first<{ id: number; travellers: number }>(
    c.env.DB,
    'SELECT id, travellers FROM itineraries WHERE id = ? AND user_id = ?',
    id,
    user.id,
  );
  if (!trip) return fail(c, 'Trip not found', 404);
  const body = await readJson<Record<string, unknown>>(c);
  const placeType = String(body.placeType ?? 'custom');
  const placeId = toInt(body.placeId, 0);
  const travellers = Math.max(1, Number(trip.travellers ?? 1));
  let title = String(body.title ?? 'New stop').slice(0, 160);
  let lat: number | null = null;
  let lng: number | null = null;
  let cost = 0;
  let notes = String(body.notes ?? '').slice(0, 400);

  if (placeId && placeType === 'attraction') {
    const row = await first<{ name: string; lat: number; lng: number; entry_fee: number; summary: string }>(
      c.env.DB,
      'SELECT name, lat, lng, entry_fee, summary FROM attractions WHERE id = ?',
      placeId,
    );
    if (row) {
      title = row.name;
      lat = row.lat;
      lng = row.lng;
      cost = row.entry_fee * travellers;
      notes = notes || row.summary;
    }
  } else if (placeId && placeType === 'restaurant') {
    const row = await first<{ name: string; lat: number; lng: number; price_for_two: number; cuisine: string }>(
      c.env.DB,
      'SELECT name, lat, lng, price_for_two, cuisine FROM restaurants WHERE id = ?',
      placeId,
    );
    if (row) {
      title = row.name;
      lat = row.lat;
      lng = row.lng;
      cost = Math.round((row.price_for_two / 2) * travellers);
      notes = notes || row.cuisine;
    }
  } else if (placeId && placeType === 'hotel') {
    const row = await first<{ name: string; lat: number; lng: number; price_per_night: number }>(
      c.env.DB,
      'SELECT name, lat, lng, price_per_night FROM hotels WHERE id = ?',
      placeId,
    );
    if (row) {
      title = row.name;
      lat = row.lat;
      lng = row.lng;
      notes = notes || `Nightly rate from ₹${row.price_per_night}`;
    }
  }

  const day = Math.min(14, Math.max(1, toInt(body.day, 1)));
  const maxOrder = await first<{ max_order: number }>(
    c.env.DB,
    'SELECT COALESCE(MAX(sort_order), 0) AS max_order FROM itinerary_items WHERE itinerary_id = ?',
    id,
  );
  const itemId = await run(
    c.env.DB,
    `INSERT INTO itinerary_items (itinerary_id, day, slot, time, title, place_type, place_id, notes, duration_minutes, cost, lat, lng, sort_order)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    day,
    String(body.slot ?? 'afternoon').slice(0, 20),
    String(body.time ?? '15:00').slice(0, 5),
    title,
    placeType.slice(0, 20),
    placeId || null,
    notes,
    Math.min(600, Math.max(15, toNum(body.durationMinutes, 90))),
    cost,
    lat,
    lng,
    Number(maxOrder?.max_order ?? 0) + 1,
  );
  await run(c.env.DB, "UPDATE itineraries SET updated_at = datetime('now') WHERE id = ?", id);
  return ok(c, { id: itemId, title, lat, lng, cost }, 201);
});

trips.patch('/:id/items/:itemId', async (c) => {
  if (!isSameOrigin(c)) return fail(c, 'Cross-site request blocked', 403);
  const user = await currentUser(c);
  if (!user) return fail(c, 'Sign in first', 401);
  const id = toInt(c.req.param('id'), 0);
  const trip = await first<{ id: number }>(c.env.DB, 'SELECT id FROM itineraries WHERE id = ? AND user_id = ?', id, user.id);
  if (!trip) return fail(c, 'Trip not found', 404);
  const itemId = toInt(c.req.param('itemId'), 0);
  const body = await readJson<Record<string, unknown>>(c);
  const updates: string[] = [];
  const params: unknown[] = [];
  const fields: [string, (v: unknown) => unknown][] = [
    ['title', (v) => String(v).slice(0, 160)],
    ['notes', (v) => String(v).slice(0, 400)],
    ['time', (v) => String(v).slice(0, 5)],
    ['slot', (v) => String(v).slice(0, 20)],
    ['day', (v) => Math.min(14, Math.max(1, toInt(v, 1)))],
    ['duration_minutes', (v) => Math.min(600, Math.max(15, toInt(v, 90)))],
    ['cost', (v) => Math.max(0, toInt(v, 0))],
  ];
  for (const [field, cast] of fields) {
    if (body[field] !== undefined) {
      updates.push(`${field} = ?`);
      params.push(cast(body[field]));
    }
  }
  if (!updates.length) return fail(c, 'Nothing to update');
  await run(
    c.env.DB,
    `UPDATE itinerary_items SET ${updates.join(', ')} WHERE id = ? AND itinerary_id = ?`,
    ...params,
    itemId,
    id,
  );
  return ok(c, { ok: true });
});

trips.delete('/:id/items/:itemId', async (c) => {
  if (!isSameOrigin(c)) return fail(c, 'Cross-site request blocked', 403);
  const user = await currentUser(c);
  if (!user) return fail(c, 'Sign in first', 401);
  const id = toInt(c.req.param('id'), 0);
  const trip = await first<{ id: number }>(c.env.DB, 'SELECT id FROM itineraries WHERE id = ? AND user_id = ?', id, user.id);
  if (!trip) return fail(c, 'Trip not found', 404);
  await run(c.env.DB, 'DELETE FROM itinerary_items WHERE id = ? AND itinerary_id = ?', toInt(c.req.param('itemId'), 0), id);
  return ok(c, { ok: true });
});

trips.post('/:id/items/:itemId/move', async (c) => {
  if (!isSameOrigin(c)) return fail(c, 'Cross-site request blocked', 403);
  const user = await currentUser(c);
  if (!user) return fail(c, 'Sign in first', 401);
  const id = toInt(c.req.param('id'), 0);
  const trip = await first<{ id: number }>(c.env.DB, 'SELECT id FROM itineraries WHERE id = ? AND user_id = ?', id, user.id);
  if (!trip) return fail(c, 'Trip not found', 404);
  const itemId = toInt(c.req.param('itemId'), 0);
  const body = await readJson<{ direction?: string }>(c);
  const direction = body.direction === 'up' ? -1 : 1;
  const items = await all<{ id: number; day: number; sort_order: number }>(
    c.env.DB,
    'SELECT id, day, sort_order FROM itinerary_items WHERE itinerary_id = ? ORDER BY day ASC, sort_order ASC, id ASC',
    id,
  );
  const index = items.findIndex((i) => i.id === itemId);
  if (index < 0) return fail(c, 'Stop not found', 404);
  const current = items[index];
  const neighbourIndex = direction === -1 ? index - 1 : index + 1;
  const neighbour = items[neighbourIndex];
  if (!neighbour || neighbour.day !== current.day) return fail(c, 'Cannot move further in that direction');
  await run(c.env.DB, 'UPDATE itinerary_items SET sort_order = ? WHERE id = ?', neighbour.sort_order, current.id);
  await run(c.env.DB, 'UPDATE itinerary_items SET sort_order = ? WHERE id = ?', current.sort_order, neighbour.id);
  return ok(c, { ok: true });
});

export default trips;
