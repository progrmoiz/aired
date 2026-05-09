import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import type { Context } from 'hono';
import type { AppBindings } from '../types.js';
import { SESSION_MAX_AGE_SECONDS } from '@aired/core';

export const SESSION_COOKIE_NAME = 'aired_session';
export const OAUTH_STATE_COOKIE_NAME = 'aired_oauth_state';

/**
 * Set the session cookie with secure attributes.
 */
export function setSessionCookie(c: Context<AppBindings>, jwt: string): void {
  setCookie(c, SESSION_COOKIE_NAME, jwt, {
    secure: true,
    httpOnly: true,
    sameSite: 'Lax',
    path: '/',
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
}

/**
 * Clear the session cookie.
 */
export function clearSessionCookie(c: Context<AppBindings>): void {
  deleteCookie(c, SESSION_COOKIE_NAME, {
    secure: true,
    httpOnly: true,
    sameSite: 'Lax',
    path: '/',
  });
}

/**
 * Read the session cookie value, or null if absent.
 */
export function readSessionCookie(c: Context<AppBindings>): string | null {
  return getCookie(c, SESSION_COOKIE_NAME) ?? null;
}

/**
 * Set the OAuth state cookie (10-minute lifetime).
 */
export function setOAuthStateCookie(c: Context<AppBindings>, state: string): void {
  setCookie(c, OAUTH_STATE_COOKIE_NAME, state, {
    secure: true,
    httpOnly: true,
    sameSite: 'Lax',
    path: '/',
    maxAge: 600,
  });
}

/**
 * Read the OAuth state cookie value, or null if absent.
 */
export function readOAuthStateCookie(c: Context<AppBindings>): string | null {
  return getCookie(c, OAUTH_STATE_COOKIE_NAME) ?? null;
}

/**
 * Clear the OAuth state cookie.
 */
export function clearOAuthStateCookie(c: Context<AppBindings>): void {
  deleteCookie(c, OAUTH_STATE_COOKIE_NAME, {
    secure: true,
    httpOnly: true,
    sameSite: 'Lax',
    path: '/',
  });
}
