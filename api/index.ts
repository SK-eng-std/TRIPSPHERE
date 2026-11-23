import { Hono } from 'hono';
import type { Env } from './env';
import authRoutes from './routes/auth';
import discoveryRoutes from './routes/discovery';
import tripRoutes from './routes/trips';
import bookingRoutes from './routes/bookings';
import userRoutes from './routes/user';
import aiRoutes from './routes/ai';
import nearbyRoutes from './routes/nearby';

const app = new Hono<{ Bindings: Env }>();

app.use('*', async (c, next) => {
  await next();
  c.header('x-content-type-options', 'nosniff');
  c.header('referrer-policy', 'strict-origin-when-cross-origin');
  c.header('x-frame-options', 'SAMEORIGIN');
});

app.use('/api/*', async (c, next) => {
  await next();
  if (!c.res.headers.get('cache-control')) c.header('cache-control', 'no-store');
});

app.route('/api/auth', authRoutes);
app.route('/api/bookings', bookingRoutes);
app.route('/api/trips', tripRoutes);
app.route('/api/itineraries', tripRoutes);
app.route('/api/ai', aiRoutes);
app.route('/api', userRoutes);
app.route('/api', nearbyRoutes);
app.route('/api', discoveryRoutes);

app.get('/api/health', (c) =>
  c.json({
    ok: true,
    service: 'tripsphere',
    ai: c.env.OPENAI_API_KEY ? 'openai' : 'smart-engine',
    time: new Date().toISOString(),
  }),
);

app.all('/api/*', (c) => c.json({ error: 'Endpoint not found' }, 404));

app.get('*', async (c) => {
  const response = await c.env.ASSETS.fetch(c.req.raw);
  // Never let a browser hold an old HTML shell while hashed assets have moved on.
  if (response.headers.get('content-type')?.includes('text/html')) {
    const headers = new Headers(response.headers);
    headers.set('cache-control', 'no-cache');
    return new Response(response.body, { status: response.status, headers });
  }
  return response;
});

app.onError((err, c) => {
  console.error('TRIPSPHERE API error', err);
  if (c.req.path.startsWith('/api/')) {
    return c.json({ error: 'Something went wrong on our side. Please try again.' }, 500);
  }
  return c.text('Unexpected error', 500);
});

export default app;
