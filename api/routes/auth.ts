import { Hono } from 'hono';
import type { Env } from '../env';
import { all, first, run } from '../lib/db';
import { hashPassword, verifyPassword } from '../lib/crypto';
import { clearSession, clientKey, currentUser, isSameOrigin, sessionSecret, setSession, throttle } from '../lib/auth';
import { fail, isEmail, ok, readJson } from '../lib/http';
import { notify } from '../lib/notify';

const auth = new Hono<{ Bindings: Env }>();

interface AuthBody {
  name?: string;
  email?: string;
  password?: string;
}

auth.post('/register', async (c) => {
  if (!isSameOrigin(c)) return fail(c, 'Cross-site request blocked', 403);
  if (!throttle(clientKey(c, 'register'), 8, 60_000)) return fail(c, 'Too many attempts. Try again in a minute.', 429);
  if (!sessionSecret(c.env, c.req.url)) return fail(c, 'Authentication is not configured on this deployment', 500);
  const body = await readJson<AuthBody>(c);
  const name = String(body.name ?? '').trim();
  const email = String(body.email ?? '').trim().toLowerCase();
  const password = String(body.password ?? '');

  if (name.length < 2 || name.length > 80) return fail(c, 'Please enter your name (2–80 characters)');
  if (!isEmail(email)) return fail(c, 'Please enter a valid email address');
  if (password.length < 8) return fail(c, 'Password must be at least 8 characters');

  const existing = await first<{ id: number }>(c.env.DB, 'SELECT id FROM users WHERE email = ?', email);
  if (existing) return fail(c, 'An account with that email already exists. Try signing in.', 409);

  const hash = await hashPassword(password);
  const userId = await run(c.env.DB, 'INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)', name, email, hash);
  if (!userId) return fail(c, 'Could not create the account. Please try again.', 500);

  await run(c.env.DB, 'INSERT INTO user_profiles (user_id, home_city) VALUES (?, ?)', userId, null).catch(() => 0);
  await run(
    c.env.DB,
    "INSERT INTO user_preferences (user_id, interests, budget_level, pace, transport) VALUES (?, '[]', 'mid', 'balanced', 'car')",
    userId,
  ).catch(() => 0);
  await notify(c.env, userId, {
    title: 'Welcome to TRIPSPHERE',
    body: 'Your travel passport is open. Set your Travel DNA to get recommendations that match your style.',
    kind: 'welcome',
    link: '/profile?tab=preferences',
  });

  await setSession(c, userId);
  return ok(c, { user: { id: userId, name, email } }, 201);
});

auth.post('/login', async (c) => {
  if (!isSameOrigin(c)) return fail(c, 'Cross-site request blocked', 403);
  if (!throttle(clientKey(c, 'login'), 12, 60_000)) return fail(c, 'Too many attempts. Try again in a minute.', 429);
  if (!sessionSecret(c.env, c.req.url)) return fail(c, 'Authentication is not configured on this deployment', 500);
  const body = await readJson<AuthBody>(c);
  const email = String(body.email ?? '').trim().toLowerCase();
  const password = String(body.password ?? '');
  if (!email || !password) return fail(c, 'Email and password are required');

  const user = await first<{ id: number; name: string; email: string; password_hash: string }>(
    c.env.DB,
    'SELECT id, name, email, password_hash FROM users WHERE email = ?',
    email,
  );
  if (!user || !(await verifyPassword(password, user.password_hash))) {
    return fail(c, 'Email or password is incorrect', 401);
  }
  await setSession(c, user.id);
  return ok(c, { user: { id: user.id, name: user.name, email: user.email } });
});

auth.post('/logout', async (c) => {
  clearSession(c);
  return ok(c, { ok: true });
});

auth.get('/me', async (c) => {
  const user = await currentUser(c);
  if (!user) return ok(c, { user: null });
  const profile = await first<Record<string, unknown>>(c.env.DB, 'SELECT * FROM user_profiles WHERE user_id = ?', user.id);
  const preferences = await first<Record<string, unknown>>(c.env.DB, 'SELECT * FROM user_preferences WHERE user_id = ?', user.id);
  const counts = await first<{ trips: number; bookings: number; reservations: number; saved: number; passport: number }>(
    c.env.DB,
    `SELECT
      (SELECT COUNT(*) FROM itineraries WHERE user_id = ?) AS trips,
      (SELECT COUNT(*) FROM hotel_bookings WHERE user_id = ?) AS bookings,
      (SELECT COUNT(*) FROM restaurant_reservations WHERE user_id = ?) AS reservations,
      (SELECT COUNT(*) FROM saved_places WHERE user_id = ?) AS saved,
      (SELECT COUNT(*) FROM heritage_passport WHERE user_id = ?) AS passport`,
    user.id,
    user.id,
    user.id,
    user.id,
    user.id,
  );
  return ok(c, {
    user,
    profile: profile ?? null,
    preferences: preferences
      ? { ...preferences, interests: JSON.parse(String(preferences.interests ?? '[]')) }
      : null,
    counts: counts ?? { trips: 0, bookings: 0, reservations: 0, saved: 0, passport: 0 },
  });
});

export default auth;
