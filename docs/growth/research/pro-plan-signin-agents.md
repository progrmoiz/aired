# Aired: sign-in, agent auth, API keys, custom domains, upgrades

*Research notes for [../pro-plan.md](../pro-plan.md), read from public pages on 2026-11-25. No accounts were created.*

Research date 2026-11-25. Public docs only. Every fact has a source. **[unverified]** means I did not confirm it in a doc this session.

---

## 1. Google sign-in on Workers

**Library status**
- `arctic` is **deprecated**: its README says "Arctic was deprecated on July 2026". The repo now ships copy-paste flow code in `/code` (PKCE auth request, code exchange, refresh, revoke). https://github.com/pilcrowonpaper/arctic
  - The deprecation post (pilcrowonpaper.com/blog/18) would not resolve, so the reason and the suggested replacement are **[unverified]**.
- So write it by hand. It is about 80 lines using `fetch` plus `jose`, which Aired already uses. `jose`'s `createRemoteJWKSet` + `jwtVerify` run on Workers **[unverified this session; widely used]**.

**Endpoints** (from Google's discovery doc, https://developers.google.com/identity/openid-connect/openid-connect)
- Authorize: `https://accounts.google.com/o/oauth2/v2/auth`
- Token: `https://oauth2.googleapis.com/token`
- Userinfo: `https://openidconnect.googleapis.com/v1/userinfo`
- JWKS: `https://www.googleapis.com/oauth2/v3/certs`
- Discovery lists `code_challenge_methods_supported: ["plain","S256"]`, so PKCE S256 works.
- `state` is "strongly recommended". `nonce` is listed as required in one table and optional in another (the page contradicts itself), so send it.

**ID token vs userinfo**
- Google says that if the ID token comes straight from the token endpoint over HTTPS with your client secret, "you can be confident that the token you receive really comes from Google and is valid." Same source.
- You do not need to call userinfo. Decode the ID token. Still check `iss`, `aud` (your client id) and `exp`. A JWKS signature check through `jose` is cheap, so do it anyway.

**Stable id**
- "Always use the `sub` field as it is unique to a Google Account even if the user changes their email address." The `email` "may not be unique to this account and could change over time." Same source.
- `email_verified` is a boolean. `hd` is the Workspace domain.

**Google's requirements**
- **Scopes:** openid/email/profile are non-sensitive. "If your app utilizes only non-sensitive scopes, it is not mandatory for your app to complete the app verification process." https://developers.google.com/identity/protocols/oauth2/production-readiness/brand-verification
- **Brand verification:** it is lighter and still required if an external-user app shows an app name or logo on the consent screen. It typically takes 2–3 business days. Same source.
- **Brand checklist:**
  - A homepage on a domain you own that describes the app. It "can not be only a login page".
  - A privacy policy on the same domain, linked from both the homepage and the consent screen.
  - All authorized domains verified.
  - Sign-in branding guidelines "recommended" for profile/email-only apps.
  - Source: https://support.google.com/cloud/answer/13464321
- **100-user cap:** applies while an app is in development/testing/staging, so switch the app to production. https://support.google.com/cloud/answer/13464323
- **Testing-mode refresh tokens expiring after 7 days:** **[unverified]** (irrelevant if you don't keep Google refresh tokens).

**Account linking by verified email**
- Users are keyed by GitHub numeric id today. Add an internal `userId` and an identities map:
  - `identity:github:<id> → userId`
  - `identity:google:<sub> → userId`
  - This is my design suggestion.
- Auto-link only when Google `email_verified=true` and it matches the GitHub account's *verified primary* email (GitHub `/user/emails`) **[unverified endpoint detail]**.
- Otherwise ask the user to sign in with the existing provider before linking. Never match on an unverified email. That would hand over the account.

**Recommendation:**
- Hand-roll the Google OIDC code flow: confidential client, PKCE S256, `state` + `nonce` in a short-lived cookie.
- Take `sub` from the ID token and verify it with `jose` against the JWKS. Skip userinfo.
- Move to an internal `userId` with an identities table first. That is the real work; Google itself is small.
- Publish the consent screen to production. Do brand verification only if you want the "Aired" name and logo shown.

---

## 2. Email magic-link sign-in

**Sending options (late 2026)**

| Option | Status / fit for Workers | Cost |
|---|---|---|
| **Cloudflare Email Sending** | Public beta since 2026-04-16. Native `env.EMAIL.send()` binding plus REST, and SMTP (beta, 2026-06-08). https://developers.cloudflare.com/email-service/platform/changelog/ | Workers Paid: "3,000 included per month, then $0.35 per 1,000 emails". Free plan sends only to verified addresses (changelog 2026-11-24). https://developers.cloudflare.com/email-service/platform/pricing/ |
| Resend | HTTP API, works with `fetch` | Free: 3,000/mo but "limited to 100 emails per day", 3 domains. Pro: $20 for 50k, $0.90 per 1k over. https://resend.com/pricing |
| Postmark | HTTP API, strong transactional reputation | Free: 100/mo. Basic: $15 for 10k, $1.80 per 1k over. https://postmarkapp.com/pricing |
| AWS SES | Needs SigV4 request signing (e.g. `aws4fetch`) **[unverified]** | $0.10 per 1k. https://aws.amazon.com/ses/pricing/ New accounts start in a sandbox: verified recipients only, 200 per 24h, 1 per second, and production access is reviewed within about 96h. https://docs.aws.amazon.com/ses/latest/dg/request-production-access.html |

**Cloudflare Email Sending details**
- Onboarding adds the records for you: MX, SPF and DKIM on a `cf-bounce` subdomain, plus `_dmarc` "only if the domain has no DMARC record". https://developers.cloudflare.com/email-service/configuration/domains/
- New accounts start with "a conservative daily quota and scale up over time". Up to 50 recipients per message. https://developers.cloudflare.com/email-service/platform/limits/

**Deliverability (Gmail rules)**
- All senders:
  - SPF or DKIM
  - Valid forward and reverse DNS
  - TLS
  - Spam rate below 0.3%
- Senders of more than 5k/day also need:
  - SPF, DKIM and DMARC (`p=none` is fine)
  - From-domain alignment
  - One-click unsubscribe, for marketing mail only
- Source: https://support.google.com/a/answer/81126
- Send magic links from a dedicated subdomain such as `auth.aired.sh` or `mail.aired.sh`, so login mail reputation stays separate (my suggestion).

**Token design** (OWASP: random from a CSPRNG, long, single use, expiring, stored securely, URL hard-coded and never built from the Host header, `Referrer-Policy: no-referrer`; https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html)
- 32 random bytes, base64url, in the link.
- Store only `SHA-256(token)` → `{email, createdAt, browserNonce}` with a TTL of 10–15 minutes. Delete it when used.
- Rate-limit per email and per IP.
- **KV caveat:** KV is eventually consistent **[unverified this session]**, and writes to one key are limited to 1 per second (https://developers.cloudflare.com/kv/platform/limits/). If single-use must be strict, do the consume step in a Durable Object or D1.

**Link scanners**
- Corporate mail scanners open links in incoming mail and can use up one-time tokens. Supabase users see this as `otp_expired`. https://github.com/orgs/supabase/discussions/41618
- Fixes:
  - Make the GET read-only: it renders a "Sign in to Aired" button, and a POST redeems the token.
  - Or send a 6-digit code as well: a scanner can open a URL but can't type a code into your form. https://flaviocopes.com/scanner-safe-double-opt-in.md, https://docs.descope.com/conditions/email-scanner

**Recommendation:**
- Use Cloudflare Email Sending. It needs no new vendor or secret and comes with 3k free per month on Workers Paid. Keep Resend as the fallback if the beta quota is a problem.
- Each email carries both a link (GET shows a confirm button, POST redeems) and a 6-digit code (5 tries max). The code also covers CLI and cross-device sign-in.
- Hash the tokens and give them a 15-minute TTL. Consume through a Durable Object if a strict single use matters.

---

## 3. Remote MCP with sign-in

**Spec timeline**
- **2025-11-25:**
  - OAuth 2.1, and protected resource metadata (RFC 9728) is MUST.
  - Discovery happens through `WWW-Authenticate: Bearer resource_metadata=...` on a 401, or through `/.well-known/oauth-protected-resource[/mcp]`.
  - PKCE S256 and the RFC 8707 `resource` parameter are MUST. Audience validation is MUST.
  - Clients should register in this order: pre-registered, then **Client ID Metadata Documents** (SHOULD), then DCR (MAY), then manual entry.
  - Adds URL-mode elicitation.
  - Source: https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization
- **2025-06-18:** introduced PRM and resource indicators **[unverified this session]**.
- **Current version is 2026-07-28:** https://modelcontextprotocol.io/specification/versioning
  - Stateless: no `initialize` and no `Mcp-Session-Id`. Adds `server/discover`.
  - **DCR is deprecated in favor of CIMD.** Servers SHOULD send the RFC 9207 `iss` parameter in authorization responses.
  - Elicitation moves to multi round-trip `input_required` results.
  - Source: https://modelcontextprotocol.io/specification/2026-07-28/changelog
- **Upgrade note:** Aired's current SDK and `agents` transport may still speak 2025-11-25. Check which versions they negotiate **[unverified]**.

**`@cloudflare/workers-oauth-provider`** (npm latest **1.3.0**; https://github.com/cloudflare/workers-oauth-provider)
- `OAuthProvider({apiRoute, apiHandler, defaultHandler, authorizeEndpoint, tokenEndpoint, ...})`.
- Your `/authorize` page lives in `defaultHandler`. It calls `env.OAUTH_PROVIDER.parseAuthRequest()`, signs the user in using Aired's *existing* GitHub session or login, shows consent, then calls `completeAuthorization({userId, props})`. Those `props` reach tools as `ctx.props`.
- Storage and security:
  - Needs KV bound as `OAUTH_KV`.
  - Tokens are stored hashed, and `props` are encrypted.
  - CIMD is enabled with `clientIdMetadataDocumentEnabled: true` plus the `global_fetch_strictly_public` compat flag.
  - DCR is available through `clientRegistrationEndpoint`.
  - Source: https://developers.cloudflare.com/agents/model-context-protocol/authorization/
- Scopes are advertised but **not enforced**. Your handler must check `ctx.auth.scope`. Same sources.
- `resolveExternalToken` lets the same endpoint accept "opaque API key, or personal access token" after the internal token lookup fails. Its docs warn this is "outside the MCP authorization profile". https://github.com/cloudflare/workers-oauth-provider/blob/main/docs/advanced-configuration.md

**How clients connect today**

| Client | OAuth | Static API key header |
|---|---|---|
| **Claude** (claude.ai, Desktop, mobile, Code: shared infra) | DCR and CIMD by default. CIMD is used only if the AS metadata has `client_id_metadata_document_supported: true` **and** `"none"` in `token_endpoint_auth_methods_supported`. Needs a 401 (ignores `WWW-Authenticate` on a 200) and uses only the first `authorization_servers` entry. Callback is `https://claude.ai/api/mcp/auth_callback`. Claude Code uses a loopback redirect on any port, so match `localhost` and `127.0.0.1` without the port. Endpoints get a 10s timeout. https://claude.com/docs/connectors/building/authentication.md | `static_headers` is **beta, limited orgs**, and it is an org-wide credential, not a per-user one. Same source. |
| **Claude Code** | `/mcp` or `claude mcp login`. If you set `headers.Authorization` yourself, a 401 does *not* start OAuth. https://code.claude.com/docs/en/mcp | Yes: `--header "Authorization: Bearer …"`, `${VAR}` expansion in `.mcp.json`, and `headersHelper`. Same source. |
| **ChatGPT / Codex** | OAuth 2.1 + PKCE. CIMD preferred, DCR supported. Per-tool `securitySchemes` can declare `noauth` + `oauth2` mixed. https://developers.openai.com/apps-sdk/build/auth | **No.** It cannot "present custom API keys". Same source. |
| **Cursor** | DCR by default, or a static `auth.CLIENT_ID`. Callbacks: `https://www.cursor.com/agents/mcp/oauth/callback` and `http://localhost:8787/callback`. https://cursor.com/docs/context/mcp | Yes: `headers` with `${env:NAME}`. Same source. |

**Lazy (mixed) auth fits Aired**
- Anonymous tools keep working. A protected `tools/call` without a token gets an **HTTP 401 + `WWW-Authenticate`**, sent *before* the MCP SDK runs.
- A 200 with `isError` does not start sign-in. Claude then shows a Connect card and retries the call.
- Source: https://claude.com/docs/connectors/building/lazy-authentication.md
- Whether `OAuthProvider`'s `apiRoute` allows optional tokens is **[unverified]**. If it doesn't, serve `/mcp` from `defaultHandler` and gate it yourself.

**Recommendation:**
- Make aired.sh its own authorization server with `workers-oauth-provider`. `/authorize` reuses the existing GitHub (and later Google or email) web session.
- Turn on CIMD with `token_endpoint_auth_methods_supported` including `"none"`. Keep DCR for older clients.
- Use lazy auth: publish stays anonymous, and account tools (list, delete, claim, domains) return a 401 challenge.
- Also accept Aired API keys as Bearer through `resolveExternalToken`, for Claude Code, Cursor and CI. Aired issues those keys itself, so there is no upstream passthrough. Document it as a convenience path outside the spec.

---

## 4. API keys for CLI, CI and agents

**GitHub's token format** (https://github.blog/engineering/platform-security/behind-githubs-new-authentication-token-formats/)
- A type prefix (`ghp_`, `gho_`, `ghu_`, `ghs_`, `ghr_`).
- An `_` separator. It "is not a Base64 character", and a double-click selects the whole token.
- A random base62 body, with a CRC32 checksum in base62 as the **last 6 characters**.
- Scanners can reject fake matches offline. The prefix alone gets false positives down to about 0.5%.
- **Suggested Aired format:** `aired_pat_<30 base62 random><6 base62 CRC32>`. Use a different prefix for each key type (e.g. `aired_ci_`). This is my design.

**Storage and lifecycle** (standard practice; my design)
- Store only `SHA-256(key)`. A fast hash is fine because the key has high entropy, unlike a password.
- KV record: `apikey:<sha256>` → `{userId, name, scopes, createdAt, last4}`. Lookup costs one KV read per request.
- Show the key once. List keys by name, last4, created and last-used.
- Scopes: `pages:write`, `pages:read`, `pages:delete`, `domains:write`. Check them in the handler.
- **Last-used without heavy writes:**
  - KV writes cost $5 per million after 1M/month on Paid, 1k/day on Free (https://developers.cloudflare.com/kv/platform/pricing/). Writes to one key are capped at 1 per second (https://developers.cloudflare.com/kv/platform/limits/).
  - So update `lastUsedAt` only when it is more than an hour old, in `ctx.waitUntil`.
  - Or write each use to Analytics Engine (section 5) and query it.
- **Revocation:** delete the KV record. Because of eventual consistency, a revoked key may keep working briefly at other edges **[unverified this session]**. Use a Durable Object or D1 if you need it to stop instantly.

**GitHub secret-scanning partner program**
- Open to "a service provider". No size threshold is stated. To start, email `secret-scanning@github.com`.
- You provide:
  - A secret type name
  - A narrow regex
  - A test account
  - A public verify endpoint that checks the `Github-Public-Key-Signature` header (ECDSA P-256 SHA-256)
- You agree to GitHub's terms. Recommended: a unique prefix, high entropy, and a 32-bit checksum.
- Source: https://docs.github.com/en/code-security/secret-scanning/secret-scanning-partnership-program/secret-scanning-partner-program
- Whether GitHub accepts small projects is **[unverified]**. Nothing excludes them.

**Recommendation:**
- Ship prefixed and checksummed keys from day one, so you can apply to the program later without changing the format.
- Store hashes in KV, throttle last-used updates, and give each key explicit scopes.
- After launch, apply to the partner program with a `/api/secret-scanning/verify` endpoint that auto-revokes leaked keys and emails the owner.

---

## 5. Customer custom domains (Cloudflare for SaaS) and view analytics

**Pricing and plans** (https://developers.cloudflare.com/cloudflare-for-platforms/cloudflare-for-saas/plans/)
- Available on Free, Pro and Business.
- **100 hostnames included**, then **$0.10 per additional hostname**. The billing period is not shown on that page, so "per month" is **[unverified]**.
- Maximum 50,000 hostnames. Enterprise is custom.
- **Apex proxying/BYOIP is Enterprise only**, as a paid add-on.

**How a customer connects** (https://developers.cloudflare.com/cloudflare-for-platforms/cloudflare-for-saas/start/getting-started/)
1. You create a fallback origin in the aired.sh zone. For a Worker it can be originless: `service.aired.sh AAAA 100::`. https://developers.cloudflare.com/cloudflare-for-platforms/cloudflare-for-saas/start/advanced-settings/worker-as-origin/
2. You create a CNAME target, e.g. `customers.aired.sh`, pointing to the fallback origin.
3. The customer adds `CNAME docs.customer.com → customers.aired.sh`.
4. **Apex domains:** "By default, using an A record to point to the target is not a supported setup". Apex proxying assigns static IPs and costs extra (contact sales). https://developers.cloudflare.com/cloudflare-for-platforms/cloudflare-for-saas/start/advanced-settings/apex-proxying/
   - A customer whose DNS host does CNAME flattening or ALIAS at the apex can usually make it work **[unverified]**. Otherwise recommend a subdomain.

**SSL**
- Validation can be HTTP DCV, TXT, or Delegated DCV. Automatic HTTP needs the CNAME in place first and causes a few minutes of downtime.
- HTTP DCV can't issue wildcards. CAA records can block it. Renewals may use HTTP even when TXT was chosen at first.
- Source: https://developers.cloudflare.com/cloudflare-for-platforms/cloudflare-for-saas/security/certificate-management/issue-and-validate/validate-certificates/http/
- A hostname is ready when `status` and `ssl.status` are both `active`. https://developers.cloudflare.com/cloudflare-for-platforms/cloudflare-for-saas/start/getting-started/

**API**
- `POST /zones/{zone_id}/custom_hostnames` with `{hostname, ssl:{method,type}}`. Only `hostname` is required. https://developers.cloudflare.com/api/resources/custom_hostnames/methods/create/
- The POST response may lack `validation_records`, so GET the hostname again after a short delay. https://developers.cloudflare.com/cloudflare-for-platforms/cloudflare-for-saas/start/getting-started/

**Worker serving**
- Add a `*/*` route on the zone. Look up `request.headers.get("host")` (or `request.cf.hostMetadata`) to find the site.
- Per-hostname `custom_origin_server` is ignored when a Worker handles the request.
- If customers proxy their CNAME through Cloudflare, also add a `service.aired.sh/*` route to avoid 522 errors.
- Don't add the zone name itself as a custom hostname.
- Source: https://developers.cloudflare.com/cloudflare-for-platforms/cloudflare-for-saas/start/advanced-settings/worker-as-origin/

**Workers Analytics Engine vs KV for page views**
- **Pricing:** Paid includes 10M data points written per month, then $0.25 per million. Reads: 1M queries, then $1 per million. Free: 100k writes and 10k queries per day. "Currently, you will not be billed." https://developers.cloudflare.com/analytics/analytics-engine/pricing/
- **Limits:** 20 blobs and 20 doubles per point, 1 index (96 bytes), 16 KB of blobs, 250 writes per invocation, **3-month retention**. https://developers.cloudflare.com/analytics/analytics-engine/limits/
- **SQL API:** `POST /accounts/{id}/analytics_engine/sql` with an Account Analytics Read token. Data is sampled at volume, so count with `SUM(_sample_interval)`. https://developers.cloudflare.com/analytics/analytics-engine/sql-api/
- **KV for counters:** a read-modify-write with a 1 write/sec/key cap loses counts on popular pages and costs $5 per million writes. Sources above.

**Recommendation:**
- Use Cloudflare for SaaS on the existing aired.sh zone. Add a `*/*` route and an originless fallback.
- The customer sets a CNAME to `customers.aired.sh`. Use HTTP DCV, and use TXT pre-validation for zero-downtime moves.
- Make it a paid feature: the first 100 hostnames are free, then $0.10 each. Say plainly that apex domains are unsupported unless the DNS host flattens CNAMEs.
- Write one Analytics Engine point per view: `index=siteId`, with blobs for path, country and referrer. Query it with SQL.
- Roll daily totals into KV or D1 with a cron if you need more than 3 months of history.

---

## 6. Upgrades from a CLI or agent

**Examples found**
- **Vercel MCP (2026-07-21)**
  - It can upgrade a team to Pro and buy credits, add-ons and domains.
  - It shows the price and whether it is one-time or recurring. When there is no exact price, it links to the billing or pricing page.
  - It completes "only after you confirm", and needs a billing role and a card on file.
  - https://vercel.com/changelog/vercel-mcp-now-supports-purchases, https://vercel.com/docs/agent-resources/vercel-mcp/tools/billing
- **Supabase MCP**
  - Paid actions pause the tool call. The client shows the resource, the rate and the interval, with accept and decline (form elicitation).
  - The legacy fallback is `get_cost` then `confirm_cost`, and the agent passes `confirm_cost_id`.
  - CI uses a PAT in the `Authorization` header.
  - https://supabase.com/docs/guides/mcp
- **Smaller MCP servers** expose tools such as `get_upgrade_link`, `upgrade_plan` or `flowcheck_upgrade` that return a Stripe Checkout URL for the human to open. Remoet's description says to confirm with the user before calling it. https://glama.ai/mcp/servers/remoet-labs/remoet-mcp/tools/get_upgrade_link, https://glama.ai/mcp/servers/patwalls/feedhook-mcp/tools/upgrade_plan
- **Figma MCP** returns a limit error telling the user they can upgrade for more tool calls (forum reports). https://forum.figma.com/report-a-problem-6/starter-plan-mcp-limit-reached-need-usage-count-and-reset-date-57969
- **MCP URL-mode elicitation (2025-11-25)** is designed for "auth flows, payment processing". The URL **MUST NOT** be pre-authenticated, and the server must check that the person opening it is the same user. https://modelcontextprotocol.io/specification/2025-11-25/client/elicitation
  - In 2026-07-28 this becomes an `input_required` result plus a retry. https://modelcontextprotocol.io/specification/2026-07-28/changelog
  - Which clients render URL elicitation is **[unverified]**.
- **HTTP 402 schemes**
  - **x402** is Coinbase's stablecoin standard, with `PAYMENT-REQUIRED`/`PAYMENT-SIGNATURE` headers and `paidTool` in Cloudflare's Agents SDK.
  - **MPP** uses `WWW-Authenticate: Payment` on a 402 and "supports ... cards (via Stripe)".
  - Source: https://developers.cloudflare.com/agents/agentic-payments
  - These let the *agent* pay. That is the wrong fit for a human subscription.
- **Vercel CLI, Netlify CLI, wrangler:** I found no documented plan-limit error text or upgrade-URL behavior **[unverified]**.

**Recommendation:**
- When a limit is hit, return a structured, non-fatal tool result. Over plain REST and the CLI, return HTTP 402 with the same JSON:
  `{"error":"plan_limit","limit":"custom_domains","upgrade_url":"https://aired.sh/upgrade?intent=<id>","message":"Ask the user to open this link to upgrade."}`
- Keep the link unauthenticated. It asks the user to sign in on the web, then shows Stripe Checkout. The `intent` id only pre-selects the plan and lets the CLI or agent poll `GET /api/upgrade/<id>` until the plan changes, like the device flow.
- In the CLI, `aired upgrade` prints the URL, offers to open the browser, and polls.
- In MCP, add an `upgrade` tool whose description tells the agent to show the link and never claim it paid. Use URL elicitation where the client supports it.
- Do not let agents complete payments. Do not use x402 or MPP for subscriptions.
