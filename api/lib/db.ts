export async function all<T>(db: D1Database, sql: string, ...params: unknown[]): Promise<T[]> {
  const stmt = params.length ? db.prepare(sql).bind(...params) : db.prepare(sql);
  const result = await stmt.all<T>();
  return result.results ?? [];
}

export async function first<T>(db: D1Database, sql: string, ...params: unknown[]): Promise<T | null> {
  const rows = await all<T>(db, sql, ...params);
  return rows.length ? rows[0] : null;
}

export async function run(db: D1Database, sql: string, ...params: unknown[]): Promise<number> {
  const stmt = params.length ? db.prepare(sql).bind(...params) : db.prepare(sql);
  const result = await stmt.run();
  return Number((result.meta as Record<string, unknown>)?.last_row_id ?? result.meta?.changes ?? 0);
}

export function parseJsonArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value !== 'string' || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return value
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }
}
