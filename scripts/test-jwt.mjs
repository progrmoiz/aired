#!/usr/bin/env node
/**
 * JWT smoke-test runner for aired session tokens.
 * Run from repo root: node scripts/test-jwt.mjs
 *
 * jose is a dependency of @aired/worker. If it is not hoisted to the repo
 * root node_modules, we import from the worker's local node_modules.
 */

// jose import — try hoisted first, fall back to worker-local
let jose;
try {
  jose = await import('jose');
} catch {
  const workerJose = new URL('../apps/worker/node_modules/jose/dist/webapi/index.js', import.meta.url);
  jose = await import(workerJose.href);
}

const { SignJWT, jwtVerify } = jose;

// ---------------------------------------------------------------------------
// Constants (mirrors packages/core/src/constants.ts)
// ---------------------------------------------------------------------------
const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60; // 2592000
const SEVEN_DAYS_SECONDS = 7 * 24 * 60 * 60;

// ---------------------------------------------------------------------------
// Helpers (mirrors apps/worker/src/lib/jwt.ts logic)
// ---------------------------------------------------------------------------

function secretKey(secret) {
  return new TextEncoder().encode(secret);
}

function isValidUUID(s) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}

function generateOpaqueId() {
  return crypto.randomUUID();
}

async function signSession(claims, secret) {
  const now = Math.floor(Date.now() / 1000);
  const jti = generateOpaqueId();
  return new SignJWT({
    sub: String(claims.sub),
    login: claims.login,
    email: claims.email ?? null,
    name: claims.name ?? null,
    jti,
    v: 1,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt(now)
    .setExpirationTime(now + SESSION_MAX_AGE_SECONDS)
    .sign(secretKey(secret));
}

async function verifySession(token, secret) {
  if (typeof token !== 'string') {
    return { ok: false, reason: 'not_a_string' };
  }
  if (token === '') {
    return { ok: false, reason: 'empty_token' };
  }
  const segments = token.split('.');
  if (segments.length !== 3) {
    return { ok: false, reason: `invalid_segment_count:${segments.length}` };
  }
  try {
    const { payload } = await jwtVerify(token, secretKey(secret), {
      algorithms: ['HS256'],
    });
    const sub = typeof payload.sub === 'string' ? parseInt(payload.sub, 10) : NaN;
    const { login, email, name, jti, iat, exp, v } = payload;
    if (
      isNaN(sub) ||
      typeof login !== 'string' ||
      typeof jti !== 'string' ||
      typeof iat !== 'number' ||
      typeof exp !== 'number'
    ) {
      return { ok: false, reason: 'invalid_claims' };
    }
    if (!isValidUUID(jti)) {
      return { ok: false, reason: 'invalid_jti' };
    }
    if (v !== 1) {
      return { ok: false, reason: 'unsupported_version' };
    }
    return {
      ok: true,
      claims: {
        sub,
        login,
        email: typeof email === 'string' ? email : null,
        name: typeof name === 'string' ? name : null,
        iat,
        exp,
        jti,
        v: 1,
      },
    };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }
}

function shouldReissue(claims, now) {
  const nowSeconds = Math.floor(now / 1000);
  const ageSeconds = nowSeconds - claims.iat;
  return ageSeconds > SEVEN_DAYS_SECONDS && nowSeconds < claims.exp;
}

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function b64url(obj) {
  return Buffer.from(JSON.stringify(obj)).toString('base64url');
}

function makeToken(header, payload, signature = '') {
  return `${b64url(header)}.${b64url(payload)}.${signature}`;
}

let passed = 0;
let failed = 0;

function pass(label) {
  console.log(`  PASS  ${label}`);
  passed++;
}

function fail(label, detail) {
  console.error(`  FAIL  ${label}: ${detail}`);
  failed++;
}

async function test(label, fn) {
  try {
    await fn();
    pass(label);
  } catch (err) {
    fail(label, err instanceof Error ? err.message : String(err));
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message ?? 'assertion failed');
}

// ---------------------------------------------------------------------------
// Test cases
// ---------------------------------------------------------------------------

const SECRET = 'test-secret-key-for-smoke-tests';

console.log('\nJWT smoke tests\n');

// (a) Round-trip: sign + verify
await test('(a) round-trip sign + verify', async () => {
  const token = await signSession({ sub: 42, login: 'alice', email: 'alice@example.com', name: 'Alice' }, SECRET);
  const result = await verifySession(token, SECRET);
  assert(result.ok, `expected ok, got reason: ${result.reason}`);
  assert(result.claims.sub === 42, `sub mismatch: ${result.claims.sub}`);
  assert(result.claims.login === 'alice', `login mismatch: ${result.claims.login}`);
  assert(result.claims.v === 1, `v mismatch: ${result.claims.v}`);
  assert(isValidUUID(result.claims.jti), `invalid jti: ${result.claims.jti}`);
});

// (b) Tampered signature rejected
await test('(b) tampered signature rejected', async () => {
  const token = await signSession({ sub: 1, login: 'bob', email: null, name: null }, SECRET);
  const parts = token.split('.');
  // Flip a byte in the signature
  const tamperedSig = parts[2].slice(0, -1) + (parts[2].slice(-1) === 'a' ? 'b' : 'a');
  const tampered = `${parts[0]}.${parts[1]}.${tamperedSig}`;
  const result = await verifySession(tampered, SECRET);
  assert(!result.ok, 'expected tampered token to fail');
});

// (c) Expired token rejected
await test('(c) expired token rejected', async () => {
  const pastIat = Math.floor(Date.now() / 1000) - SESSION_MAX_AGE_SECONDS - 100;
  const pastExp = pastIat + SESSION_MAX_AGE_SECONDS - 200; // already expired
  const jti = generateOpaqueId();
  const token = await new SignJWT({
    sub: '1',
    login: 'carol',
    email: null,
    name: null,
    jti,
    v: 1,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt(pastIat)
    .setExpirationTime(pastExp)
    .sign(secretKey(SECRET));
  const result = await verifySession(token, SECRET);
  assert(!result.ok, 'expected expired token to fail');
});

// (d) alg=none rejected
await test('(d) alg=none rejected', async () => {
  const header = { alg: 'none' };
  const payload = { sub: '1', login: 'dave', email: null, name: null, jti: generateOpaqueId(), v: 1, iat: Math.floor(Date.now()/1000), exp: Math.floor(Date.now()/1000)+3600 };
  const token = `${b64url(header)}.${b64url(payload)}.`;
  const result = await verifySession(token, SECRET);
  assert(!result.ok, 'expected alg=none token to fail');
});

// (e) RS256-signed token rejected
await test('(e) RS256-signed token rejected', async () => {
  // Construct a fake RS256 token header (can't actually sign RS256 without a key pair,
  // but jose will reject it at algorithm check before signature verification)
  const header = { alg: 'RS256' };
  const payload = { sub: '1', login: 'eve', email: null, name: null, jti: generateOpaqueId(), v: 1, iat: Math.floor(Date.now()/1000), exp: Math.floor(Date.now()/1000)+3600 };
  const token = `${b64url(header)}.${b64url(payload)}.fakesig`;
  const result = await verifySession(token, SECRET);
  assert(!result.ok, 'expected RS256 token to fail');
});

// (f) Malformed jti rejected (not a UUID)
await test('(f) malformed jti rejected', async () => {
  const now = Math.floor(Date.now() / 1000);
  const token = await new SignJWT({
    sub: '1',
    login: 'frank',
    email: null,
    name: null,
    jti: 'not-a-uuid',
    v: 1,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt(now)
    .setExpirationTime(now + SESSION_MAX_AGE_SECONDS)
    .sign(secretKey(SECRET));
  const result = await verifySession(token, SECRET);
  assert(!result.ok, 'expected malformed jti to fail');
  assert(result.reason === 'invalid_jti', `expected reason invalid_jti, got: ${result.reason}`);
});

// (g) shouldReissue: true at day 8, false at day 6
await test('(g) shouldReissue true at day 8, false at day 6', async () => {
  const iat = Math.floor(Date.now() / 1000) - (8 * 24 * 60 * 60); // 8 days ago
  const exp = iat + SESSION_MAX_AGE_SECONDS;
  const claims = { sub: 1, login: 'g', email: null, name: null, iat, exp, jti: generateOpaqueId(), v: /** @type {1} */ (1) };

  const nowMs = Date.now();
  const atDay8 = shouldReissue(claims, nowMs);
  assert(atDay8, 'shouldReissue should be true at day 8');

  // Simulate day 6 (only 6 days elapsed)
  const iat6 = Math.floor(Date.now() / 1000) - (6 * 24 * 60 * 60);
  const exp6 = iat6 + SESSION_MAX_AGE_SECONDS;
  const claims6 = { ...claims, iat: iat6, exp: exp6 };
  const atDay6 = shouldReissue(claims6, nowMs);
  assert(!atDay6, 'shouldReissue should be false at day 6');
});

// (h) 2-segment input rejected
await test('(h) 2-segment input rejected', async () => {
  const result = await verifySession('header.payload', SECRET);
  assert(!result.ok, 'expected 2-segment token to fail');
});

// (i) 4-segment input rejected
await test('(i) 4-segment input rejected', async () => {
  const result = await verifySession('a.b.c.d', SECRET);
  assert(!result.ok, 'expected 4-segment token to fail');
});

// (j) Empty string rejected
await test('(j) empty string rejected', async () => {
  const result = await verifySession('', SECRET);
  assert(!result.ok, 'expected empty string to fail');
  assert(result.reason === 'empty_token', `expected reason empty_token, got: ${result.reason}`);
});

// (k) Non-string (undefined) rejected
await test('(k) non-string (undefined) rejected', async () => {
  const result = await verifySession(undefined, SECRET);
  assert(!result.ok, 'expected undefined to fail');
  assert(result.reason === 'not_a_string', `expected reason not_a_string, got: ${result.reason}`);
});

// (l) v:2 token rejected with reason unsupported_version
await test('(l) v:2 token rejected with unsupported_version', async () => {
  const now = Math.floor(Date.now() / 1000);
  const token = await new SignJWT({
    sub: '1',
    login: 'luna',
    email: null,
    name: null,
    jti: generateOpaqueId(),
    v: 2,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt(now)
    .setExpirationTime(now + SESSION_MAX_AGE_SECONDS)
    .sign(secretKey(SECRET));
  const result = await verifySession(token, SECRET);
  assert(!result.ok, 'expected v:2 token to fail');
  assert(result.reason === 'unsupported_version', `expected reason unsupported_version, got: ${result.reason}`);
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log(`\n${passed + failed} cases: ${passed} passed, ${failed} failed\n`);

if (failed > 0) {
  process.exit(1);
}
