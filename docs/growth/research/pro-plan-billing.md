# Aired billing research (as of 2026-11-25)

*Research notes for [../pro-plan.md](../pro-plan.md), read from public pages on 2026-11-25. No accounts were created.*

Scope: one Pro subscription (~$9/mo billed yearly = $108/yr, or ~$12 monthly), Cloudflare Workers + Hono, KV + R2 today. Seller outside the US. Worked example: a country Stripe doesn't support (Pakistan); the general case is covered too. Public docs only; no accounts created.
Legend: **[V]** verified on the cited page. **[I]** inferred from the cited page. **[U]** unverified / third-party only.

---

## 1. Stripe Checkout vs Payment Links vs Customer Portal

| | Checkout Session (hosted) | Payment Links | Customer Portal |
|---|---|---|---|
| What it does | Server creates a session per user via API, redirect to `session.url` | No-code reusable URL (`buy.stripe.com/...`) that opens a Checkout Session | Stripe-hosted page to manage an existing subscription |
| Code needed | One POST endpoint + webhook | Zero for checkout; webhook still needed to grant Pro | One POST endpoint (`billing_portal.sessions.create`) or a no-code login link |
| Pass user id | `client_reference_id` (max 200 chars) and `metadata`; `subscription_data.metadata` copies onto the subscription [V](https://docs.stripe.com/api/checkout/sessions/create) | `?client_reference_id=` URL param (alphanumeric, `-`, `_`, max 200; invalid values silently dropped); arrives in `checkout.session.completed` [V](https://docs.stripe.com/payment-links/url-parameters) | n/a (keyed by Stripe `customer`) |
| Prefill email | `customer_email`, or `customer` (existing Customer; email then locked) [V](https://docs.stripe.com/api/checkout/sessions/create) | `?prefilled_email=` (editable) or `?locked_prefilled_email=` [V](https://docs.stripe.com/payment-links/customize) | Dashboard no-code portal can prefill email [V](https://docs.stripe.com/customer-management) |
| Monthly vs yearly | Pass a different `price` id in `line_items` | One link per price (two links) [I](https://docs.stripe.com/payment-links/customize) | Plan switching configurable, max 10 products [V](https://docs.stripe.com/customer-management) |
| Promo codes | `allow_promotion_codes: true` or `discounts: [{promotion_code}]` (max one) [V](https://docs.stripe.com/api/checkout/sessions/create) | Enable on link; `?prefilled_promo_code=` [V](https://docs.stripe.com/payment-links/customize) | Cancellation-deflection coupon [V](https://docs.stripe.com/customer-management) |
| Trials | `subscription_data.trial_period_days`; `payment_method_collection: if_required` for no-card trials [V](https://docs.stripe.com/api/checkout/sessions/create) | "Include a free trial", optionally without a card [V](https://docs.stripe.com/payment-links/customize) | Customer can cancel but not update a sub with a trial offer; editing a trialing sub ends the trial unless `trial_update_behavior=continue_trial` [V](https://docs.stripe.com/customer-management) |

Portal facts: update card, billing info, tax IDs, switch plan, pause, cancel now or at period end, view and pay invoices. Sessions expire 5 min after creation if unused. Can't be iframed [V](https://docs.stripe.com/customer-management).

**Least code for v1:** two Payment Links (monthly, yearly) with `?client_reference_id=<userId>&locked_prefilled_email=<email>` plus the no-code portal link, plus one webhook route. Move to Checkout Sessions (about 15 lines) when you want to reuse an existing `customer` so a re-subscriber doesn't get a duplicate Customer.

---

## 2. Stripe on Cloudflare Workers

- `stripe` npm (latest **23.2.0**) has `workerd` / `worker` export conditions that resolve to `stripe.esm.worker.js` [V](https://registry.npmjs.org/stripe/latest).
- That build's `WebPlatformFunctions` makes `createFetchHttpClient()` and `createSubtleCryptoProvider()` the **defaults**. Node's HTTP client and Node crypto throw there [V](https://unpkg.com/stripe@23.2.0/esm/platform/WebPlatformFunctions.js). So `nodejs_compat` isn't required for Stripe itself [I]. Passing `httpClient: Stripe.createFetchHttpClient()` explicitly is harmless.
- Use `constructEventAsync`. Sync `constructEvent` fails with SubtleCrypto and its error says to use the async one. Default tolerance is `DEFAULT_TOLERANCE: 300` seconds [V](https://unpkg.com/stripe@23.2.0/esm/Webhooks.js).

**Signature format** [V](https://docs.stripe.com/webhooks): the `Stripe-Signature` header is comma-separated, e.g. `t=...,v1=...,v1=...,v0=...`, and may include `secret=`, `destination=` and `payload=` debug entries. Sign `"${t}.${rawBody}"` with HMAC-SHA256 using the `whsec_...` secret. Accept if **any** `v1` matches (several appear during secret rotation), and ignore every other scheme. Compare in constant time. The libraries' default tolerance is 5 min, and a tolerance of 0 disables the check. Read the **raw** body.

```ts
// src/billing/stripe-webhook.ts  (Hono on Workers)
import Stripe from 'stripe';
app.post('/webhooks/stripe', async (c) => {
  const stripe = new Stripe(c.env.STRIPE_SECRET_KEY);           // fetch + SubtleCrypto by default on workerd
  const body = await c.req.text();                                // raw body, do not JSON.parse first
  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(
      body, c.req.header('stripe-signature')!, c.env.STRIPE_WEBHOOK_SECRET,
      undefined, Stripe.createSubtleCryptoProvider());
  } catch { return c.text('bad signature', 400); }
  // idempotency: skip if event.id already processed
  const fresh = await c.env.DB.prepare('INSERT OR IGNORE INTO stripe_events(id) VALUES (?)').bind(event.id).run();
  if (!fresh.meta.changes) return c.text('dup', 200);
  c.executionCtx.waitUntil(syncFromStripe(c.env, stripe, event)); // return 2xx fast
  return c.text('ok', 200);
});

// Hand-rolled alternative (no SDK), Web Crypto only
async function verifyStripe(body: string, header: string, secret: string, tolSec = 300) {
  const parts = header.split(',').map(p => p.split('=') as [string, string]);
  const t = parts.find(([k]) => k === 't')?.[1];
  const sigs = parts.filter(([k]) => k === 'v1').map(([, v]) => v);
  if (!t || !sigs.length || Math.abs(Date.now() / 1000 - Number(t)) > tolSec) return false;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${t}.${body}`)));
  const hex = [...mac].map(b => b.toString(16).padStart(2, '0')).join('');
  return sigs.some(s => s.length === hex.length &&
    crypto.subtle.timingSafeEqual(new TextEncoder().encode(s), new TextEncoder().encode(hex))); // workerd-only extension [U: not re-checked]
}
```

**Events for one subscription** [V](https://docs.stripe.com/billing/subscriptions/webhooks):

| Event | Use |
|---|---|
| `checkout.session.completed` | Link `client_reference_id` (Aired user) to `customer` + `subscription` ids |
| `customer.subscription.created` / `.updated` | Upsert status, price (monthly/yearly), `current_period_end`, `cancel_at_period_end` |
| `customer.subscription.deleted` | Revoke Pro |
| `invoice.paid` | Extend access. Docs: retrieve the subscription and confirm `active` first |
| `invoice.payment_failed` | Sub goes `past_due` on renewal failure; notify the user. Revoke on `canceled`/`unpaid` |
| (optional) `customer.subscription.trial_will_end`, `charge.dispute.created`, `charge.refunded` | Trials and risk |

**Retries, idempotency, ordering** [V](https://docs.stripe.com/webhooks):
- Live mode retries for up to 3 days with exponential backoff; sandbox retries 3 times over a few hours. Manual resend works for 15 days (Dashboard) or 30 days (CLI).
- Duplicates happen. Log `event.id`; separate duplicate Event objects can also occur, so dedupe on `data.object.id` + `type`.
- **No ordering guarantee.** Don't use `created` to order events (it's in seconds, so ties happen). Safest pattern: on any subscription or invoice event, re-fetch the Subscription from the API and write its current state ("sync, don't apply deltas") [I].
- Return 2xx fast. Process async (here, `waitUntil` or a Queue).
- Not acknowledging `invoice.created` delays invoice finalization up to 72 h [V](https://docs.stripe.com/billing/subscriptions/webhooks). Return 200 for every subscribed event.

---

## 3. Where to keep subscription state on Workers

| | Workers KV | D1 (SQLite) | Durable Objects |
|---|---|---|---|
| Consistency | Eventually consistent; changes "may take up to 60 seconds or more" to reach other locations; no atomic ops [V](https://developers.cloudflare.com/kv/concepts/how-kv-works/) | Single primary; read replicas only if you opt in via the Sessions API, which gives sequential consistency per session [V](https://developers.cloudflare.com/d1/best-practices/read-replication/) | Strongly consistent per object [I](https://developers.cloudflare.com/kv/concepts/how-kv-works/) |
| Write limits | **1 write/sec per key**; Free 1,000 writes/day [V](https://developers.cloudflare.com/kv/platform/limits/) | 10 GB/DB (Paid), 500 MB (Free) [V](https://developers.cloudflare.com/d1/platform/limits/) | n/a |
| Free tier | 100k reads/day, 1k writes/day, 1 GB [V](https://developers.cloudflare.com/kv/platform/pricing/) | 5M rows read/day, 100k rows written/day, 5 GB [V](https://developers.cloudflare.com/d1/platform/pricing/) | 100k req/day [V](https://developers.cloudflare.com/durable-objects/platform/pricing/) |
| Paid ($5/mo Workers Paid [V](https://developers.cloudflare.com/workers/platform/pricing/)) | 10M reads/mo then $0.50/M; 1M writes/mo then $5/M [V](https://developers.cloudflare.com/kv/platform/pricing/) | 25B rows read/mo then $0.001/M; 50M rows written/mo then $1/M; 5 GB then $0.75/GB-mo [V](https://developers.cloudflare.com/d1/platform/pricing/) | 1M req/mo then $0.15/M + duration [V](https://developers.cloudflare.com/durable-objects/platform/pricing/) |

**Recommendation: D1 as the source of truth** (`users`, `subscriptions`, `api_keys(hash)`, `billing_events(id)`).
- **Webhook writes go to D1.** The `INSERT OR IGNORE` on event id gives idempotency and transactional upserts, and webhooks never hit KV's per-key write limit.
- **API key lookup: D1** (`SELECT ... WHERE key_hash=?`). A revoked key stops working immediately, which a KV cache can't promise for 60 s.
- **Plan lookup on every page view:** read D1 directly at first (5M rows/day free covers it). If latency from the D1 primary region matters, write through to KV after the D1 commit (`plan:<userId>` → `{plan, until}`) and read KV on the hot path. 60 s of staleness is fine for gating a page view. Gate **publish** (a write path) on D1.
- Durable Objects: unnecessary for one-plan billing.

---

## 4. Tax and merchant of record

**Stripe Tax** (you stay the seller): Basic is **0.5%/txn** (no-code Checkout/Billing/Payment Links) or **$0.50/txn** via API, charged only where you're registered. It covers monitoring, calculation and collection; "Registrations and filings are not included." Tax Complete starts at **$90/mo** (2 registrations/yr, 4 filings/yr, 1-yr contract) [V](https://stripe.com/tax/pricing). "You must file and remit the tax you collect for every location where you're registered." Stripe auto-files in the US and for some Ireland/Canada registrations; elsewhere you use partners (Taxually, Marosa...) [V](https://docs.stripe.com/tax/filing). Stripe Billing itself is **0.7%** of billing volume (pay-as-you-go), and US card processing is **2.9% + 30¢**, +1.5% for international cards and +1% for currency conversion [V](https://stripe.com/pricing).

| Option | Fee (headline) | Seller in a non-Stripe country (e.g. Pakistan)? | Payouts | Status (Nov 2026) |
|---|---|---|---|---|
| **Stripe direct** | 2.9%+30¢ (+1.5% intl) + 0.7% Billing [V](https://stripe.com/pricing) | **No.** Pakistan isn't on Stripe's country list (India is "Preview") [V](https://stripe.com/global) | n/a | Needs a foreign entity (e.g. Atlas) |
| **Stripe Managed Payments** (Stripe as MoR, "Sold through Link") | **+3.5%/txn on top of** standard processing [V](https://stripe.com/managed-payments) | **No.** Business must be in CA, US, 30 European countries, AU, HK, JP or SG; eligibility review; digital products only [V](https://docs.stripe.com/payments/managed-payments/eligibility) | Stripe balance | Live in docs, handles tax in 80+ countries; works only via Checkout/Payment Links (no Elements, no subs created outside Checkout) [V](https://docs.stripe.com/payments/managed-payments). GA "April 2026" [U](https://payproglobal.com/?p=23022) |
| **Lemon Squeezy** (Stripe-owned) | 5% + 50¢ [V](https://www.lemonsqueezy.com/pricing) | Moot | Bank/PayPal, 200+ countries [V](https://www.lemonsqueezy.com/pricing) | **"No longer accepting new sign-ups and will shut down on March 31, 2027"**; path is Managed Payments [V](https://www.lemonsqueezy.com/pricing), [V](https://www.lemonsqueezy.com/blog/2026-update). Signups closed 2026-11-16 [U](https://checkoutpage.com/docs/articles/migrating-from-lemon-squeezy) |
| **Paddle** | 5% + 50¢, no monthly fee; custom pricing under $10 on request [V](https://www.paddle.com/pricing) | **Likely yes.** "Works with software businesses anywhere in the world" except an unsupported list that doesn't include Pakistan [I](https://www.paddle.com/help/start/intro-to-paddle/which-countries-are-supported-by-paddle) | Monthly; wire, **Payoneer**, or Wise-type services; $100 minimum; possible $15 SWIFT fee [V](https://www.paddle.com/help/manage/get-paid/when-and-how-do-i-get-paid) | Approval: domain review needs product description, pricing page, T&C/Refund/Privacy linked in nav, HTTPS; manual review takes 5-7 business days [V](https://www.paddle.com/help/start/account-verification/what-is-domain-verification) |
| **Polar.sh** | Starter free: **5% + 50¢**; **+1.5% non-US cards**; Pro $20/mo: 3.8%+40¢. Payout: $2/mo active + 0.25%+25¢ per payout + 0.25-1% FX; $15/dispute [V](https://polar.sh/docs/merchant-of-record/fees) | **Yes.** Pakistan is listed; payouts go through Stripe Connect Express ("Stripe Payments doesn't need to be available in your country") [V](https://polar.sh/docs/merchant-of-record/supported-countries) | Stripe Connect Express to a local bank [V](https://polar.sh/docs/merchant-of-record/supported-countries) | Active |
| **Creem** | **3.9% + 40¢**, "no international card fees", $0 monthly [V](https://www.creem.io/pricing) | **Yes, with caveat.** Pakistan is marked ** (bank partner restrictions, e.g. personal accounts only) [V](https://docs.creem.io/merchant-of-record/supported-countries) | Bank transfer, 1st and 15th; fee max(7 USD/EUR, 1%) [V](https://docs.creem.io/merchant-of-record/supported-countries), [V](https://www.creem.io/pricing) | Active |
| **Dodo Payments** | 4% + 40¢ US; **+1.5% intl, +0.5% subscriptions**; $25 USD SWIFT payout [V](https://dodopayments.com/pricing) | **No.** Eligibility goes by the country of your ID; 177 countries listed incl. India, Sri Lanka, Nepal, UAE, but **not Pakistan** [V](https://docs.dodopayments.com/miscellaneous/accepted-countries-and-territories) | USD/GBP/EUR wallets; $100 minimum payout (can be set to $50) [V](https://docs.dodopayments.com/features/payouts/payout-structure) | Active |
| **Stripe Atlas** (US entity → direct Stripe) | **$500 one-time** (Delaware filing + 1st yr registered agent), then **$100/yr** agent + Delaware annual tax/franchise tax (amounts not listed) [V](https://stripe.com/atlas) | Yes: "Founders from anywhere in the world"; EIN can take several weeks without an SSN or US address [V](https://stripe.com/atlas) | Stripe payouts to a US bank | US tax filings for a foreign-owned LLC/C-corp are extra [U] |

**Effective fee per charge (international card, no tax/FX/payout fees):**

| | $12 monthly | $108 yearly |
|---|---|---|
| Polar Starter (6.5% + 50¢) | $1.28 | $7.52 |
| Paddle (5% + 50¢) | $1.10 | $5.90 |
| Creem (3.9% + 40¢) | $0.87 | $4.61 |
| Stripe via Atlas (2.9+1.5+0.7% + 30¢), tax not handled | $0.91 | $5.81 |
| Stripe via Atlas + Managed Payments (+3.5%) | $1.33 | $9.59 |

**How payouts reach a non-Stripe country (Pakistan as the example):** Polar uses Stripe Connect Express to a PK bank account. Paddle uses Payoneer (then withdraw to a PK bank) or SWIFT wire. Creem uses bank transfer, with restrictions flagged for PK. All three are the MoR, so they collect and remit VAT/sales tax and you invoice them, not your customers [I].

---

## 5. MoR developer surface (Workers fit)

| Provider | API + webhooks | Signature scheme (Web Crypto-friendly?) | Hosted checkout | Customer portal |
|---|---|---|---|---|
| Polar | REST + SDKs; `validateEvent` in SDK [V](https://polar.sh/docs/integrate/webhooks/delivery) | **Standard Webhooks** for secrets created on/after 2026-09-08; older secrets use a Polar HMAC scheme [V](https://polar.sh/docs/integrate/webhooks/endpoints). HMAC-SHA256, so it works with Web Crypto [I](https://github.com/standard-webhooks/standard-webhooks/blob/main/spec/standard-webhooks.md) | Checkout Links (no code) + Checkout API [V](https://polar.sh/docs/features/checkout/links) | Hosted portal [V](https://polar.sh/docs/features/customer-portal) |
| Paddle | Paddle Billing API; portal sessions `POST /customers/{id}/portal-sessions` [V](https://developer.paddle.com/api-reference/customer-portals/create-customer-portal-session) | `Paddle-Signature: ts=...;h1=...`, HMAC-SHA256 of `ts:body`; SDKs use a **5 s** tolerance [V](https://developer.paddle.com/webhooks/signature-verification) | Overlay/inline via Paddle.js on an approved domain [V](https://developer.paddle.com/concepts/sell/self-serve-checkout) (a pure hosted page [U]) | Yes; plan changes in portal [U] |
| Creem | REST + SDKs; retries at 30 s, 5 m, 30 m, 6 h (stops after 24 h) [V](https://docs.creem.io/code/webhooks) | `creem-signature` = HMAC-SHA256(body) [V](https://docs.creem.io/code/webhooks) | Yes [V](https://docs.creem.io/llms.txt) | Hosted portal [V](https://docs.creem.io/llms.txt) |
| Dodo | REST + SDKs; up to 8 retries; dedupe on `webhook-id` [V](https://docs.dodopayments.com/developer-resources/webhooks) | Standard Webhooks; has a **Cloudflare Workers example** [V](https://docs.dodopayments.com/developer-resources/webhooks/examples/cloudflare-example) | Checkout sessions + payment links [V](https://docs.dodopayments.com/developer-resources/integration-guide) | Hosted portal + API session [V](https://docs.dodopayments.com/features/customer-portal) |
| Stripe Managed Payments | Same Stripe API/webhooks as section 2 | Same | Checkout / Payment Links only [V](https://docs.stripe.com/payments/managed-payments) | Stripe portal works with MP [V](https://docs.stripe.com/customer-management) |
| Lemon Squeezy | Closing to new signups (see section 4) | n/a | n/a | n/a |

---

## Recommendation

**v1 path: Polar.sh as merchant of record, with D1 as billing state.**
- It's the only option where Pakistan payouts are explicitly documented (Stripe Connect Express) and that needs no foreign entity. It also handles global VAT/sales tax [V](https://polar.sh/docs/merchant-of-record/supported-countries).
- Least code: a `/billing/checkout` Worker route that calls the Polar Checkout API with the Aired user id in metadata (exact field name such as `external_customer_id` is [U]), the hosted customer portal, and one `/webhooks/polar` Hono route. The route verifies Standard Webhooks signatures with Web Crypto, dedupes on `webhook-id` in D1, and upserts `subscriptions`. Checkout Links alone document only `product_id`, `customer_email`, `discount_code` and `custom_field_data.*` URL params; there's no user-id param, so a links-only setup would have to match users by email [V](https://polar.sh/docs/features/checkout/links).
- Cost: about 6.5% + 50¢ on an international card ($7.52 on $108/yr), plus payout fees. Pro at $20/mo (3.8% + 40¢) pays off at roughly $1.5k+/mo volume [I].
- Keep the schema provider-agnostic (`provider`, `provider_customer_id`, `provider_subscription_id`, `status`, `price_interval`, `current_period_end`) so switching later only means a new webhook adapter.

**Fallback: Paddle.** It's a mature MoR with Payoneer/wire payouts, and Pakistan isn't on its unsupported list. Fees are similar (5% + 50¢) and it has a solid portal API. Expect a domain review (pricing page, T&C/Refund/Privacy in nav) and Paddle.js overlay checkout instead of a pure link. Creem is the cheaper alternative (3.9% + 40¢), but Pakistan payouts carry a restriction flag; ask Creem before relying on it.

**Later / general case:** with a supported-country entity (or Stripe Atlas, $500 + $100/yr + US filings), Stripe Checkout + Portal + webhooks (section 2 code) is the lowest-fee stack. Add Stripe Tax (you still register and file) or Managed Payments (+3.5%, Stripe files) for compliance. Don't start on Lemon Squeezy or Dodo: LS is shutting down, and Dodo doesn't onboard Pakistani IDs.
