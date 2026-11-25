/**
 * Checks a Stripe webhook's `Stripe-Signature` header (`t=<unix>,v1=<hex>[,v1=...]`).
 * Stripe signs `${t}.${rawBody}` with HMAC-SHA256, keyed with the whole
 * `whsec_...` secret as UTF-8. Any v1 may match (several appear while a secret
 * is being rolled); v0 is a test-mode scheme and is ignored.
 * Never throws: anything malformed is just a bad signature.
 */
export async function verifyStripeSignature(
  payload: string,
  header: string | null | undefined,
  secret: string,
  nowSec: number,
  toleranceSec = 300,
): Promise<boolean> {
  try {
    if (!header || !secret) return false;

    let t: string | null = null;
    const signatures: string[] = [];
    for (const part of header.split(',')) {
      const eq = part.indexOf('=');
      if (eq === -1) continue;
      const key = part.slice(0, eq).trim();
      const value = part.slice(eq + 1).trim();
      if (key === 't') t = value;
      else if (key === 'v1' && /^[0-9a-f]{64}$/.test(value)) signatures.push(value);
    }
    if (t === null || !/^\d+$/.test(t) || signatures.length === 0) return false;
    if (Math.abs(nowSec - Number(t)) > toleranceSec) return false;

    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
    );
    const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(`${t}.${payload}`)));
    const expected = Array.from(mac, (b) => b.toString(16).padStart(2, '0')).join('');

    let ok = false;
    for (const sig of signatures) {
      if (constantTimeEqual(expected, sig)) ok = true;
    }
    return ok;
  } catch {
    return false;
  }
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
