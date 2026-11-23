import { Hono } from 'hono';
import type { Env } from '../env';
import { assistantReply, aiMode, miniPlan } from '../lib/ai';
import { clientKey, isSameOrigin, throttle } from '../lib/auth';
import { fail, ok, readJson, toInt, toNum } from '../lib/http';

const ai = new Hono<{ Bindings: Env }>();

ai.get('/status', async (c) => {
  const mode = aiMode(c.env);
  return ok(c, {
    mode,
    model: mode === 'openai' ? c.env.OPENAI_MODEL || 'gpt-4o-mini' : 'built-in travel engine',
    label:
      mode === 'openai'
        ? 'Live AI enabled'
        : 'Built-in travel engine — add OPENAI_API_KEY on the server to enable live conversational AI',
  });
});

ai.post('/assistant', async (c) => {
  if (!isSameOrigin(c)) return fail(c, 'Cross-site request blocked', 403);
  if (!throttle(clientKey(c, 'assistant'), 30, 60_000)) return fail(c, 'Too many messages. Give it a minute.', 429);
  const body = await readJson<Record<string, unknown>>(c);
  const message = String(body.message ?? '').trim();
  if (message.length < 2) return fail(c, 'Ask me something about your trip');
  const lat = toNum(body.lat, NaN);
  const lng = toNum(body.lng, NaN);
  const history = Array.isArray(body.history)
    ? (body.history as { role?: string; content?: string }[]).map((h) => ({ role: String(h.role ?? 'user'), content: String(h.content ?? '') }))
    : [];
  const reply = await assistantReply(c.env, {
    message,
    lat: Number.isFinite(lat) ? lat : undefined,
    lng: Number.isFinite(lng) ? lng : undefined,
    destinationId: toInt(body.destinationId, 0) || undefined,
    history,
  });
  return ok(c, reply);
});

ai.post('/mini-plan', async (c) => {
  if (!isSameOrigin(c)) return fail(c, 'Cross-site request blocked', 403);
  const body = await readJson<Record<string, unknown>>(c);
  const hours = Math.min(12, Math.max(0.5, toNum(body.hours, 3)));
  const lat = toNum(body.lat, NaN);
  const lng = toNum(body.lng, NaN);
  const plan = await miniPlan(c.env, {
    hours,
    lat: Number.isFinite(lat) ? lat : undefined,
    lng: Number.isFinite(lng) ? lng : undefined,
    interests: Array.isArray(body.interests) ? body.interests.map(String) : [],
    destinationId: toInt(body.destinationId, 0) || undefined,
  });
  return ok(c, plan);
});

export default ai;
