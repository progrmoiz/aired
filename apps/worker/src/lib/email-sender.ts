/**
 * Transactional email: today only the "only these people" code
 * (routes/access.ts). One small interface, picked from the env:
 *
 *   EMAIL_MODE = "log"   Local dev (.dev.vars): the message, code included,
 *                        goes to the console and nowhere else. Refused when
 *                        SITE_ORIGIN is unset (production), so a stray var
 *                        can't put codes in production logs.
 *   ACCESS_EMAIL binding Cloudflare Email Service (wrangler.toml
 *                        [[send_email]]). The default once it's set up.
 *   RESEND_API_KEY       Resend, as a fallback provider.
 *   none of these        Not set up: null. The owner can't turn on
 *                        "only these people" then (the PATCH says so).
 *
 * EMAIL_FROM is the sender, e.g. `aired <access@aired.sh>`; the domain
 * must be onboarded with the provider. No runtime imports, so tests load it.
 */

export type EmailMessage = { to: string; subject: string; text: string; html: string };

export interface EmailSender {
  /** Which provider, for logs. */
  readonly kind: "log" | "cloudflare" | "resend";
  /** Throws when the provider refused the message. */
  send(message: EmailMessage): Promise<void>;
}

/** The Workers send_email binding, as Email Service defines it. */
export type SendEmailBinding = {
  send(message: { to: string; from: string | { email: string; name: string }; subject: string; text?: string; html?: string }): Promise<unknown>;
};

export type EmailEnv = {
  EMAIL_MODE?: string;
  ACCESS_EMAIL?: SendEmailBinding;
  RESEND_API_KEY?: string;
  EMAIL_FROM?: string;
  SITE_ORIGIN?: string;
};

const DEFAULT_FROM = "aired <access@aired.sh>";

/** `Name <address>` or a bare address, as the Email Service binding wants it. */
export function parseFrom(from: string): { email: string; name: string } | string {
  const m = /^\s*(.*?)\s*<([^<>\s]+@[^<>\s]+)>\s*$/.exec(from);
  if (m === null) return from.trim();
  return m[1] ? { email: m[2]!, name: m[1].replace(/^"|"$/g, "") } : m[2]!;
}

export function emailSenderFor(env: EmailEnv, fetcher: typeof fetch = fetch): EmailSender | null {
  const from = env.EMAIL_FROM?.trim() || DEFAULT_FROM;
  if (env.EMAIL_MODE === "log") {
    if (!env.SITE_ORIGIN) return null;
    return {
      kind: "log",
      async send(m) {
        console.log(`[email:log] to=${m.to} subject=${JSON.stringify(m.subject)}\n${m.text}`);
      },
    };
  }
  if (env.ACCESS_EMAIL !== undefined) {
    const binding = env.ACCESS_EMAIL;
    return {
      kind: "cloudflare",
      async send(m) {
        await binding.send({ to: m.to, from: parseFrom(from), subject: m.subject, text: m.text, html: m.html });
      },
    };
  }
  if (env.RESEND_API_KEY) {
    const key = env.RESEND_API_KEY;
    return {
      kind: "resend",
      async send(m) {
        const res = await fetcher("https://api.resend.com/emails", {
          method: "POST",
          headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
          body: JSON.stringify({ from, to: [m.to], subject: m.subject, text: m.text, html: m.html }),
        });
        if (!res.ok) throw new Error(`resend answered ${res.status}`);
      },
    };
  }
  return null;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/**
 * The code email. Plain words, no tracking pixels or links to click
 * through: the code is typed on the page the person already has open. The
 * page's title isn't in it, so a forwarded or previewed email says nothing
 * about what's behind the code.
 */
export function accessCodeEmail(opts: { to: string; code: string; pageUrl: string; minutes: number }): EmailMessage {
  const spaced = `${opts.code.slice(0, 3)} ${opts.code.slice(3)}`;
  const text = [
    `Your code to open the page on aired:`,
    ``,
    `    ${spaced}`,
    ``,
    `Type it on the page you have open. It works for ${opts.minutes} minutes, once.`,
    ``,
    `Page: ${opts.pageUrl}`,
    ``,
    `If you didn't ask for this, you can ignore this email. Nobody can open the page with your address without this code.`,
    ``,
    `aired · aired.sh`,
  ].join("\n");
  const html = `<!DOCTYPE html><html><body style="margin:0;padding:32px 16px;background:#f6f6f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#18181b">
<div style="max-width:440px;margin:0 auto;background:#ffffff;border:1px solid #e4e4e7;border-radius:12px;padding:28px">
<p style="margin:0 0 16px;font-size:14px;font-weight:500">aired</p>
<p style="margin:0 0 12px;font-size:15px;line-height:1.5">Your code to open the page on aired:</p>
<p style="margin:0 0 16px;font:500 28px/1.2 'SF Mono',Menlo,Consolas,monospace;letter-spacing:4px">${esc(spaced)}</p>
<p style="margin:0 0 12px;font-size:14px;line-height:1.5;color:#3f3f46">Type it on the page you have open. It works for ${opts.minutes} minutes, once.</p>
<p style="margin:0 0 20px;font-size:13px;line-height:1.5;color:#71717a;word-break:break-all">Page: ${esc(opts.pageUrl)}</p>
<p style="margin:0;font-size:12px;line-height:1.5;color:#71717a">If you didn't ask for this, you can ignore this email. Nobody can open the page with your address without this code.</p>
</div></body></html>`;
  return { to: opts.to, subject: `${spaced} is your aired code`, text, html };
}
