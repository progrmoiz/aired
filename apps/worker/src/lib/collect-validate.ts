/**
 * What a viewer may save with aired.collect.save, and what update_data may
 * push. JSON only: a top-level object (or, for live data, any JSON value),
 * bounded in bytes, depth, keys, items and string length
 * (lib/collect-limits.ts).
 *
 * Abuse rule, in the spirit of lib/spam.ts: aired is not a backend for
 * collecting passwords or payment details, which is what a phishing page
 * would use it for. An entry is refused when a field is named like a
 * secret (password, card number, CVV, SSN, seed phrase, one-time code) or a
 * value looks like a card number (13 to 19 digits that pass the Luhn check).
 * Narrow on purpose: quiz answers, names, emails and workout logs never
 * match. Refusals are logged as collect_blocked, so a page that keeps
 * trying can be looked at and taken down through the abuse flow.
 *
 * No imports beyond the limits, so tests load it directly.
 */

import {
  ENTRY_KEY_MAX,
  RECORD_KEY_MAX,
  RECORD_MAX_BYTES,
  RECORD_MAX_DEPTH,
  RECORD_MAX_ITEMS,
  RECORD_MAX_KEYS,
  RECORD_STRING_MAX,
} from "./collect-limits.ts";

export type Invalid = { ok: false; code: "invalid_record" | "too_large" | "blocked"; error: string };
export type ValidRecord = { ok: true; json: string; size: number };

const enc = new TextEncoder();

/**
 * Field names that only a page harvesting secrets needs. Matched against
 * the name split into words (camelCase, snake_case and kebab-case all
 * split), so "passport_photo" or "spinning" never match.
 */
const BLOCKED_WORDS = new Set([
  "password", "passwd", "passcode", "pwd", "cvv", "cvc", "cvv2", "ssn", "iban", "otp", "2fa", "mfa", "pin",
]);
const BLOCKED_PHRASES = [
  ["card", "number"], ["cc", "number"], ["cc", "num"], ["credit", "card"], ["debit", "card"], ["card", "cvc"],
  ["security", "code"], ["social", "security"], ["seed", "phrase"], ["recovery", "phrase"], ["secret", "phrase"],
  ["private", "key"], ["mnemonic"], ["routing", "number"], ["account", "number"], ["sort", "code"], ["one", "time", "code"],
  ["verification", "code"], ["auth", "code"], ["expiry", "date"], ["exp", "date"],
];

function words(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/** Whether a field name asks for a secret or payment detail. */
export function blockedFieldName(name: string): boolean {
  const w = words(name);
  if (w.some((x) => BLOCKED_WORDS.has(x))) return true;
  return BLOCKED_PHRASES.some((p) => {
    for (let i = 0; i + p.length <= w.length; i++) if (p.every((x, j) => w[i + j] === x)) return true;
    return false;
  });
}

/** 13 to 19 digits (spaces and dashes allowed between) that pass the Luhn check. */
export function looksLikeCardNumber(value: string): boolean {
  if (value.length > 30) return false;
  if (!/^\d[\d -]{11,27}\d$/.test(value.trim())) return false;
  const digits = value.replace(/[ -]/g, "");
  if (digits.length < 13 || digits.length > 19 || /^(\d)\1+$/.test(digits)) return false;
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = digits.charCodeAt(digits.length - 1 - i) - 48;
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

const invalid = (error: string): Invalid => ({ ok: false, code: "invalid_record", error });
const blocked = (): Invalid => ({
  ok: false,
  code: "blocked",
  error: "aired doesn't collect passwords, payment details or other secrets. Remove that field and try again.",
});

/**
 * Walk a parsed JSON value: depth, sizes, and the abuse rule. Returns an
 * error or null. `checkSecrets` is off for live data, which only the owner
 * writes.
 */
function walk(v: unknown, depth: number, checkSecrets: boolean, maxDepth: number): Invalid | null {
  if (v === null || typeof v === "boolean") return null;
  if (typeof v === "number") return Number.isFinite(v) ? null : invalid("Numbers must be finite.");
  if (typeof v === "string") {
    if (v.length > RECORD_STRING_MAX) return invalid(`A text value is longer than ${RECORD_STRING_MAX} characters.`);
    if (checkSecrets && looksLikeCardNumber(v)) return blocked();
    return null;
  }
  if (depth >= maxDepth) return invalid(`Nested more than ${maxDepth} levels deep.`);
  if (Array.isArray(v)) {
    if (checkSecrets && v.length > RECORD_MAX_ITEMS) return invalid(`A list has more than ${RECORD_MAX_ITEMS} items.`);
    for (const item of v) {
      const err = walk(item, depth + 1, checkSecrets, maxDepth);
      if (err) return err;
    }
    return null;
  }
  if (typeof v === "object") {
    const keys = Object.keys(v as object);
    if (checkSecrets && keys.length > RECORD_MAX_KEYS) return invalid(`An object has more than ${RECORD_MAX_KEYS} fields.`);
    for (const k of keys) {
      if (k.length > RECORD_KEY_MAX) return invalid(`A field name is longer than ${RECORD_KEY_MAX} characters.`);
      if (checkSecrets && blockedFieldName(k)) return blocked();
      const err = walk((v as Record<string, unknown>)[k], depth + 1, checkSecrets, maxDepth);
      if (err) return err;
    }
    return null;
  }
  return invalid("Only JSON values can be saved.");
}

/** One viewer entry: a JSON object, within the record limits, with no secrets. */
export function validateRecord(value: unknown): ValidRecord | Invalid {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return invalid("save() takes an object, like { answer: \"B\" }.");
  }
  let json: string;
  try {
    json = JSON.stringify(value);
  } catch {
    return invalid("The record can't be turned into JSON.");
  }
  const size = enc.encode(json).byteLength;
  if (size > RECORD_MAX_BYTES) return { ok: false, code: "too_large", error: `One entry can be at most ${RECORD_MAX_BYTES / 1024} KB of JSON.` };
  // Check what will be stored, not the object as sent (toJSON, undefined fields and NaN change it).
  const err = walk(JSON.parse(json), 0, true, RECORD_MAX_DEPTH);
  return err ?? { ok: true, json, size };
}

/** Live data from update_data: any JSON value up to maxBytes, nested at most 20 deep. */
export function validateLiveData(value: unknown, maxBytes: number): ValidRecord | Invalid {
  if (value === undefined) return invalid("data is required: any JSON value.");
  let json: string;
  try {
    json = JSON.stringify(value);
  } catch {
    return invalid("data can't be turned into JSON.");
  }
  if (json === undefined) return invalid("data must be a JSON value.");
  const size = enc.encode(json).byteLength;
  if (size > maxBytes) return { ok: false, code: "too_large", error: `Live data can be at most ${Math.round(maxBytes / 1024)} KB of JSON on this plan.` };
  const err = walk(JSON.parse(json), 0, false, 20);
  return err ?? { ok: true, json, size };
}

const ENTRY_KEY = new RegExp(`^[A-Za-z0-9_.:-]{1,${ENTRY_KEY_MAX}}$`);

/** save(record, { key }): undefined or null for none, else a short name. */
export function validateEntryKey(key: unknown): { ok: true; key: string | null } | Invalid {
  if (key === undefined || key === null) return { ok: true, key: null };
  if (typeof key !== "string" || !ENTRY_KEY.test(key)) {
    return invalid(`key must be 1 to ${ENTRY_KEY_MAX} letters, digits or _ . : -`);
  }
  return { ok: true, key };
}
