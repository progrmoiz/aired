/**
 * D1 rows for aired's CLI device sign-in (auth_tokens, migration 0007). Only
 * the SHA-256 of the device code is stored. A code is approved once by a
 * signed-in person and collected once by the CLI. Only type imports, so tests
 * run this against the real migration on node:sqlite. Times are Unix ms.
 */

export type DeviceAuthRow = {
  user_code: string;
  expires_at: number;
  approved_user_id: number | null;
  approved_auth_time: number | null;
  consumed_at: number | null;
};

/** Store a new code; false if the user code is taken (the caller retries). */
export async function createDeviceAuth(
  db: D1Database,
  row: { deviceHash: string; userCode: string; now: number; expiresAt: number },
): Promise<boolean> {
  // Expired codes are no use to anyone: clear them so their user codes free up.
  await db.prepare('DELETE FROM auth_tokens WHERE expires_at < ?').bind(row.now).run();
  const r = await db
    .prepare(
      `INSERT INTO auth_tokens (device_hash, user_code, created_at, expires_at)
       VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING`,
    )
    .bind(row.deviceHash, row.userCode, row.now, row.expiresAt)
    .run();
  return (r.meta?.changes ?? 0) === 1;
}

/**
 * Approve a live, unapproved code for this account. authTime is when the
 * approving person signed in. False if there's no such code.
 */
export async function approveDeviceAuth(
  db: D1Database,
  userCode: string,
  userId: number,
  authTime: number,
  now: number,
): Promise<boolean> {
  const r = await db
    .prepare(
      `UPDATE auth_tokens SET approved_user_id = ?, approved_auth_time = ?
       WHERE user_code = ? AND approved_user_id IS NULL AND consumed_at IS NULL AND expires_at > ?`,
    )
    .bind(userId, authTime, userCode, now)
    .run();
  return (r.meta?.changes ?? 0) === 1;
}

export async function readDeviceAuth(db: D1Database, deviceHash: string): Promise<DeviceAuthRow | null> {
  return db
    .prepare('SELECT user_code, expires_at, approved_user_id, approved_auth_time, consumed_at FROM auth_tokens WHERE device_hash = ?')
    .bind(deviceHash)
    .first<DeviceAuthRow>();
}

/**
 * Collect an approved code, once: the account and when its approver signed
 * in. Null if not approved, expired or already collected.
 */
export async function consumeDeviceAuth(
  db: D1Database,
  deviceHash: string,
  now: number,
): Promise<{ userId: number; authTime: number | null } | null> {
  const row = await db
    .prepare(
      `UPDATE auth_tokens SET consumed_at = ?
       WHERE device_hash = ? AND approved_user_id IS NOT NULL AND consumed_at IS NULL AND expires_at > ?
       RETURNING approved_user_id, approved_auth_time`,
    )
    .bind(now, deviceHash, now)
    .first<{ approved_user_id: number; approved_auth_time: number | null }>();
  return row ? { userId: row.approved_user_id, authTime: row.approved_auth_time } : null;
}
