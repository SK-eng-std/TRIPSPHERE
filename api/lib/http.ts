import type { Context } from 'hono';

export function ok<T>(c: Context, data: T, status = 200) {
  return c.json(data as object, status as 200);
}

export function fail(c: Context, message: string, status = 400) {
  return c.json({ error: message }, status as 400);
}

export async function readJson<T = Record<string, unknown>>(c: Context): Promise<T> {
  try {
    return (await c.req.json()) as T;
  } catch {
    return {} as T;
  }
}

export function toInt(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n) : fallback;
}

export function toNum(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(value);
}
