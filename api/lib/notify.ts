import type { Env } from '../env';
import { run } from './db';

export async function notify(
  env: Env,
  userId: number,
  input: { title: string; body: string; kind?: string; link?: string },
): Promise<void> {
  await run(
    env.DB,
    'INSERT INTO notifications (user_id, title, body, kind, link) VALUES (?, ?, ?, ?, ?)',
    userId,
    input.title.slice(0, 140),
    input.body.slice(0, 400),
    input.kind ?? 'info',
    input.link ?? null,
  ).catch(() => 0);
}
