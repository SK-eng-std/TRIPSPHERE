import { Hono } from 'hono';
import type { Env } from '../env';
import { all, first } from '../lib/db';
import { currentUser, isSameOrigin } from '../lib/auth';
import { fail, ok, readJson, toInt } from '../lib/http';
import { bookingReference } from '../lib/crypto';
import { run } from '../lib/db';
import { notify } from '../lib/notify';

const bookings = new Hono<{ Bindings: Env }>();

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function nightsBetween(checkIn: string, checkOut: string): number {
  return Math.round((Date.parse(checkOut) - Date.parse(checkIn)) / 86_400_000);
}

bookings.post('/hotels', async (c) => {
  if (!isSameOrigin(c)) return fail(c, 'Cross-site request blocked', 403);
  const user = await currentUser(c);
  if (!user) return fail(c, 'Sign in to request a stay', 401);
  const body = await readJson<Record<string, unknown>>(c);
  const hotelId = toInt(body.hotelId, 0);
  const checkIn = String(body.checkIn ?? '');
  const checkOut = String(body.checkOut ?? '');
  const rooms = Math.min(6, Math.max(1, toInt(body.rooms, 1)));
  const guests = Math.min(12, Math.max(1, toInt(body.guests, 2)));
  const note = String(body.note ?? '').slice(0, 300);

  if (!DATE_RE.test(checkIn) || !DATE_RE.test(checkOut)) return fail(c, 'Choose valid check-in and check-out dates');
  if (checkIn < todayIso()) return fail(c, 'Check-in cannot be in the past');
  if (checkOut <= checkIn) return fail(c, 'Check-out must be after check-in');
  const nights = nightsBetween(checkIn, checkOut);
  if (nights > 30) return fail(c, 'Stays are limited to 30 nights per request');

  const hotel = await first<{ id: number; name: string; price_per_night: number; rooms_total: number }>(
    c.env.DB,
    'SELECT id, name, price_per_night, rooms_total FROM hotels WHERE id = ?',
    hotelId,
  );
  if (!hotel) return fail(c, 'Hotel not found', 404);
  if (rooms > hotel.rooms_total) return fail(c, `That property only has ${hotel.rooms_total} rooms`);
  if (guests > rooms * 3) return fail(c, 'That many guests need more rooms');

  const total = hotel.price_per_night * rooms * nights;
  const reference = bookingReference('TSH');

  await run(
    c.env.DB,
    `INSERT INTO hotel_bookings (user_id, hotel_id, reference, check_in, check_out, guests, rooms, nights, total_amount, status, mode, note)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'requested', 'demo', ?)`,
    user.id,
    hotel.id,
    reference,
    checkIn,
    checkOut,
    guests,
    rooms,
    nights,
    total,
    note,
  );

  await notify(c.env, user.id, {
    title: `Stay request logged: ${hotel.name}`,
    body: `${nights} night${nights > 1 ? 's' : ''} from ${checkIn}. Reference ${reference}. This is a demo-mode request, not a confirmed booking.`,
    kind: 'booking',
    link: '/profile?tab=bookings',
  });

  return ok(
    c,
    {
      booking: {
        reference,
        hotelId: hotel.id,
        hotelName: hotel.name,
        checkIn,
        checkOut,
        nights,
        rooms,
        guests,
        total,
        status: 'requested',
        mode: 'demo',
      },
      notice:
        'Demo mode: this stay request is saved to your account, but no payment was taken and no room is held. Confirm live availability and rates with the property or a booking partner before you travel.',
    },
    201,
  );
});

bookings.get('/hotels', async (c) => {
  const user = await currentUser(c);
  if (!user) return fail(c, 'Sign in first', 401);
  const rows = await all<Record<string, unknown>>(
    c.env.DB,
    `SELECT b.*, h.name AS hotel_name, h.image AS hotel_image, h.slug AS hotel_slug, h.address AS hotel_address,
      d.name AS destination_name
     FROM hotel_bookings b JOIN hotels h ON h.id = b.hotel_id JOIN destinations d ON d.id = h.destination_id
     WHERE b.user_id = ? ORDER BY b.created_at DESC`,
    user.id,
  );
  return ok(c, { bookings: rows });
});

bookings.post('/hotels/:id/cancel', async (c) => {
  if (!isSameOrigin(c)) return fail(c, 'Cross-site request blocked', 403);
  const user = await currentUser(c);
  if (!user) return fail(c, 'Sign in first', 401);
  const id = toInt(c.req.param('id'), 0);
  await run(
    c.env.DB,
    "UPDATE hotel_bookings SET status = 'cancelled' WHERE id = ? AND user_id = ? AND status = 'requested'",
    id,
    user.id,
  );
  return ok(c, { ok: true });
});

bookings.post('/restaurants', async (c) => {
  if (!isSameOrigin(c)) return fail(c, 'Cross-site request blocked', 403);
  const user = await currentUser(c);
  if (!user) return fail(c, 'Sign in to request a table', 401);
  const body = await readJson<Record<string, unknown>>(c);
  const restaurantId = toInt(body.restaurantId, 0);
  const date = String(body.date ?? '');
  const time = String(body.time ?? '');
  const guests = Math.min(12, Math.max(1, toInt(body.guests, 2)));
  const note = String(body.note ?? '').slice(0, 300);

  if (!DATE_RE.test(date)) return fail(c, 'Choose a valid reservation date');
  if (date < todayIso()) return fail(c, 'Reservation date cannot be in the past');
  if (!TIME_RE.test(time)) return fail(c, 'Choose a valid time');

  const restaurant = await first<{
    id: number; name: string; opens_at: string; closes_at: string; reservation_url: string | null;
  }>(c.env.DB, 'SELECT id, name, opens_at, closes_at, reservation_url FROM restaurants WHERE id = ?', restaurantId);
  if (!restaurant) return fail(c, 'Restaurant not found', 404);

  const latest = restaurant.closes_at > '00:00' ? restaurant.closes_at : '23:59';
  if (time < restaurant.opens_at || time >= latest) {
    return fail(c, `That venue serves between ${restaurant.opens_at} and ${restaurant.closes_at}. Pick a time inside those hours.`);
  }

  const reference = bookingReference('TSR');
  await run(
    c.env.DB,
    `INSERT INTO restaurant_reservations (user_id, restaurant_id, reference, date, time, guests, status, mode, note)
     VALUES (?, ?, ?, ?, ?, ?, 'requested', 'demo', ?)`,
    user.id,
    restaurant.id,
    reference,
    date,
    time,
    guests,
    note,
  );

  await notify(c.env, user.id, {
    title: `Table request logged: ${restaurant.name}`,
    body: `${guests} guest${guests > 1 ? 's' : ''} on ${date} at ${time}. Reference ${reference}. Demo mode — the venue has not confirmed this table.`,
    kind: 'reservation',
    link: '/profile?tab=reservations',
  });

  return ok(
    c,
    {
      reservation: {
        reference,
        restaurantId: restaurant.id,
        restaurantName: restaurant.name,
        date,
        time,
        guests,
        status: 'requested',
        mode: 'demo',
      },
      notice:
        'Demo mode: the request is saved and visible in your dashboard, but the restaurant has not confirmed the table. Use the external reservation link for a live booking.',
    },
    201,
  );
});

bookings.get('/restaurants', async (c) => {
  const user = await currentUser(c);
  if (!user) return fail(c, 'Sign in first', 401);
  const rows = await all<Record<string, unknown>>(
    c.env.DB,
    `SELECT r.*, res.name AS restaurant_name, res.image AS restaurant_image, res.slug AS restaurant_slug,
      res.cuisine AS restaurant_cuisine, d.name AS destination_name
     FROM restaurant_reservations r JOIN restaurants res ON res.id = r.restaurant_id
     JOIN destinations d ON d.id = res.destination_id
     WHERE r.user_id = ? ORDER BY r.created_at DESC`,
    user.id,
  );
  return ok(c, { reservations: rows });
});

bookings.post('/restaurants/:id/cancel', async (c) => {
  if (!isSameOrigin(c)) return fail(c, 'Cross-site request blocked', 403);
  const user = await currentUser(c);
  if (!user) return fail(c, 'Sign in first', 401);
  await run(
    c.env.DB,
    "UPDATE restaurant_reservations SET status = 'cancelled' WHERE id = ? AND user_id = ? AND status = 'requested'",
    toInt(c.req.param('id'), 0),
    user.id,
  );
  return ok(c, { ok: true });
});

export default bookings;
