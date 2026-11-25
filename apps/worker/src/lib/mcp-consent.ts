/**
 * The page where a person allows an MCP client (Claude, ChatGPT, Cursor…) to
 * use their aired account (routes/mcp-oauth.ts). Everything about the client
 * comes from the client itself (its registration or metadata document), so
 * every value is escaped. Uses the site.css kit. No imports, so tests load it
 * directly.
 */

export type ConsentFacts = {
  clientName: string;
  /** A CIMD client's verified domain; absent for self-registered clients. */
  clientDomain?: string;
  redirectHost: string;
  redirectIsLoopback: boolean;
};

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"'`=]/g, (ch) => `&#${ch.charCodeAt(0)};`);
}

const HEAD = (title: string) => `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <meta name="robots" content="noindex" />
  <meta name="referrer" content="no-referrer" />
  <link rel="icon" href="/favicon.ico" sizes="any" />
  <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
  <link rel="stylesheet" href="/fonts/fonts.css" />
  <link rel="stylesheet" href="/site.css" />
  <style>
    .consent { padding: 64px 0; max-width: 34rem; }
    .consent .panel { margin-top: 28px; }
    .consent .facts { margin-top: 14px; display: grid; gap: 8px; font-size: 14px; color: var(--text-2); }
    .consent .facts b { color: var(--text-1); font-weight: 500; }
    .consent .warn { margin-top: 14px; font-size: 14px; color: #fbbf24; }
    .consent .btns { margin-top: 22px; display: flex; flex-wrap: wrap; gap: 10px; }
    @media (pointer: coarse) { .consent .btn { min-height: 44px; } }
  </style>
</head>
<body>
<header><div class="wrap">
  <a class="logo" href="/" aria-label="aired home"><svg viewBox="0 0 32 32" aria-hidden="true"><circle cx="9" cy="23" r="3.5" fill="currentColor"/><path d="M9 13a10 10 0 0 1 10 10M9 6a17 17 0 0 1 17 17" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"/></svg>aired</a>
</div></header>
<main class="wrap"><section class="consent">`;

const FOOT = `</section></main>
</body>
</html>`;

export function consentPage(facts: ConsentFacts, handle: string, login: string): string {
  const name = escapeHtml(facts.clientName);
  const who = facts.clientDomain
    ? `<p>Published by <b>${escapeHtml(facts.clientDomain)}</b>.</p>`
    : '<p>This app registered itself, so its name isn’t verified.</p>';
  const loopback = facts.redirectIsLoopback
    ? '<p class="warn" role="note">This sends access to an app on your computer. Continue only if you just started connecting from it.</p>'
    : '';
  return `${HEAD(`Connect ${facts.clientName} to aired`)}
  <p class="eyebrow">Connect an app</p>
  <h1>Allow ${name} to use your aired account?</h1>
  <p class="lede">It will act as <b>@${escapeHtml(login)}</b>: list, publish, update and delete your pages, and read your plan. It can’t see your keys or billing, or delete your account.</p>
  <div class="panel box-pad">
    <div class="facts">
      ${who}
      <p>Access goes to <b>${escapeHtml(facts.redirectHost)}</b>.</p>
    </div>
    ${loopback}
    <form method="post" action="/authorize">
      <input type="hidden" name="handle" value="${escapeHtml(handle)}" />
      <div class="btns">
        <button class="btn solid" type="submit" name="decision" value="approve">Allow</button>
        <button class="btn" type="submit" name="decision" value="deny">Deny</button>
      </div>
    </form>
  </div>
${FOOT}`;
}

export function consentErrorPage(message: string): string {
  return `${HEAD('Could not connect — aired')}
  <p class="eyebrow">Connect an app</p>
  <h1>That didn’t work</h1>
  <p class="lede">${escapeHtml(message)}</p>
  <div class="btns" style="margin-top:22px"><a class="btn" href="/dashboard">Go to your dashboard</a></div>
${FOOT}`;
}
