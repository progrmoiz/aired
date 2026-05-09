import { Hono } from 'hono';
import type { AppBindings } from '../types.js';

const dashboard = new Hono<AppBindings>();

// GET /dashboard — serve dashboard HTML to authenticated users
dashboard.get('/dashboard', async (c) => {
  const user = c.get('user');

  if (user === null || user === undefined) {
    return c.redirect('/auth/github?return=/dashboard', 302);
  }

  if (c.env.ASSETS) {
    return c.env.ASSETS.fetch(c.req.raw);
  }

  return c.text('Not found', 404);
});

export { dashboard };
