import { Hono } from 'hono';
import type { AppBindings } from '../types.js';
import { apiKeyDisplayPrefix, generateApiKey, generateId, hashToHex } from '@aired/core';
import { requireSession } from '../middleware/auth.js';
import { requireCsrfHeader } from '../middleware/csrf.js';
import { insertKey, listKeys, MAX_ACTIVE_KEYS, normalizeKeyName, revokeKey } from '../lib/api-keys.js';

/**
 * /api/me/keys: create, list and revoke API keys. A signed-in session only:
 * a key can't mint or revoke keys (requireSession).
 */
const keys = new Hono<AppBindings>();
keys.use('*', requireSession);
// Responses can carry a new key: never store them anywhere.
keys.use('*', async (c, next) => {
  await next();
  c.header('Cache-Control', 'no-store');
});

const unavailable = 'Could not reach the key store. Please try again.';

// GET /api/me/keys — active keys, newest first. Never the key itself.
keys.get('/', async (c) => {
  try {
    return c.json({ keys: await listKeys(c.env.DB, c.get('user')!.id), max: MAX_ACTIVE_KEYS });
  } catch (err) {
    console.error('API key list failed', err);
    return c.json({ error: unavailable }, 503);
  }
});

// POST /api/me/keys {name} — returns the key once.
keys.post('/', requireCsrfHeader, async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }
  const name = normalizeKeyName((body as { name?: unknown } | null)?.name);
  if (name === null) return c.json({ error: 'Give the key a name of 1 to 60 characters.' }, 400);

  const key = generateApiKey();
  const row = {
    id: `key_${generateId(16)}`,
    userId: c.get('user')!.id,
    name,
    prefix: apiKeyDisplayPrefix(key),
    keyHash: await hashToHex(key),
    createdAt: Date.now(),
  };
  let stored: boolean;
  try {
    stored = await insertKey(c.env.DB, row);
  } catch (err) {
    console.error('API key create failed', err);
    return c.json({ error: unavailable }, 503);
  }
  if (!stored) {
    return c.json({ error: `You can have up to ${MAX_ACTIVE_KEYS} keys. Revoke one first.`, code: 'key_limit' }, 409);
  }
  return c.json({ id: row.id, name, prefix: row.prefix, createdAt: row.createdAt, key }, 201);
});

// DELETE /api/me/keys/:id — revoke. Takes effect on the next request.
keys.delete('/:id', requireCsrfHeader, async (c) => {
  try {
    const ok = await revokeKey(c.env.DB, c.get('user')!.id, c.req.param('id') ?? '', Date.now());
    return ok ? c.json({ ok: true }) : c.json({ error: 'No such key' }, 404);
  } catch (err) {
    console.error('API key revoke failed', err);
    return c.json({ error: unavailable }, 503);
  }
});

export { keys };
