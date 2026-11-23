import type { Context } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import type { Env, SessionUser } from '../env';
import { signToken, verifyToken } from './crypto';
import { first } from './db';

const COOKIE_NAME = 'ts_session';
const SESSION_SECONDS = 60 * 60 * 24 * 30;
const DEV_SECRET = 'local-development-only-secret-do-not-deploy';

export type Ctx = Context<{ Bindings: Env }>;

/**
 * Resolves the session signing key. The development placeholder is accepted only
 * on loopback, so a deployment that forgets to set a real secret cannot serve auth.
 */
export function sessionSecret(env: Env, requestUrl: string): string | null {
  if (!env.JWT_SECRET) return null;
  if (env.JWT_SECRET === DEV_SECRET) {
    try {
      const host = new URL(requestUrl).hostname;
      if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(host)) return null;
    } catch {
      return null;
    }
  }
  return env.JWT_SECRET;
}

export async function currentUser(c: Ctx): Promise<SessionUser | null> {
  const secret = sessionSecret(c.env, c.req.url);
  if (!secret) return null;
  const token = getCookie(c, COOKIE_NAME);
  if (!token) return null;
  const payload = await verifyToken(token, secret);
  if (!payload || typeof payload.sub !== 'number') return null;
  const row = await first<SessionUser>(
    c.env.DB,
    'SELECT id, name, email FROM users WHERE id = ?',
    payload.sub,
  );
  return row ?? null;
}

export async function setSession(c: Ctx, userId: number): Promise<void> {
  const secret = sessionSecret(c.env, c.req.url);
  if (!secret) throw new Error('JWT_SECRET is not configured');
  const token = await signToken(
    { sub: userId, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + SESSION_SECONDS },
    secret,
  );
  const secure = new URL(c.req.url).protocol === 'https:';
  setCookie(c, COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'Lax',
    path: '/',
    maxAge: SESSION_SECONDS,
    secure,
  });
}

export function clearSession(c: Ctx): void {
  deleteCookie(c, COOKIE_NAME, { path: '/' });
}

/** Rejects cross-site state changes while allowing same-origin browser requests. */
export function isSameOrigin(c: Ctx): boolean {
  const origin = c.req.header('origin');
  if (!origin) return true;
  try {
    return new URL(origin).host === new URL(c.req.url).host;
  } catch {
    return false;
  }
}

const buckets = new Map<string, { count: number; reset: number }>();

/** Small per-isolate throttle for sensitive endpoints. Best-effort, not a global limiter. */
export function throttle(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || bucket.reset < now) {
    buckets.set(key, { count: 1, reset: now + windowMs });
    return true;
  }
  bucket.count += 1;
  if (buckets.size > 5000) buckets.clear();
  return bucket.count <= limit;
}

export function clientKey(c: Ctx, scope: string): string {
  const ip = c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for') || 'local';
  return `${scope}:${ip}`;
}
