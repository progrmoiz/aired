/**
 * Spam detection for anonymous publishes.
 *
 * The abuse we see on aired.sh is gambling backlink spam: short "checklist" or
 * "guide" pages whose only job is to link to a casino domain. Rules stay narrow
 * on purpose — people publish real HTML games (blackjack, poker, slot machines),
 * so game words alone never trigger a block. A page is spam when:
 *   1. it links to a host or path that is unmistakably gambling, or
 *   2. it links to a host with a weaker gambling word (slot, spin, poker…) and
 *      the page itself reads like gambling promotion, or
 *   3. its title names a gambling site and its body reads like a promotion.
 */

export type SpamVerdict = { spam: false } | { spam: true; reason: string };

/** Host fragments that only gambling sites use. */
const STRONG_HOST =
  /casino|kasino|kazino|cazino|gransino|sportsbook|bookmaker|betting|pokie|jackpot|roulette|baccarat|1xbet|rainbet|(?:^|[-.])bet(?:[-.]|\d)|\dbet(?:[-.]|$)|bet(?:uk|au|ca|de)\b/i;

/** Host fragments that suggest gambling but also appear on ordinary sites. */
const WEAK_HOST = /slot|spin|bonus|poker|megaways|vegas|wager|gambl/i;

/** Link paths that point at a gambling offer. */
const GAMBLING_PATH =
  /\/(?:bonus(?:es)?|casino(?:-bonuses)?|live-casino|casino-bonuses|slots?|free-spins|pokies|betting|bonus-max-cashout)(?:\/|$)/i;

/** Title words that name a gambling operator, offer or review. */
const GAMBLING_TITLE =
  /casino|kasino|kazino|казино|كازين|赌场|博彩|カジノ|카지노|sportsbook|bookmaker|betting|pokies|gambling|glücksspiel|spielothek|bonusbedingungen|bonus terms|casino bonus|free[- ]spins?|slot guides?|jackpot slots?/i;

/** Promotion vocabulary — present in casino promo copy, absent from games. */
const PROMO_TERMS = [
  /wagering|umsatzbedingungen/i,
  /no[- ]deposit/i,
  /\bdeposits?\b|einzahlung/i,
  /withdraw(?:al)?s?|auszahlung|cashout/i,
  /payouts?/i,
  /\bbonus(?:es)?\b|bonusangebot/i,
  /free spins|freispiele/i,
  /licen[cs]ed|licen[cs]e|lizenz/i,
  /responsible gambling|gamble responsibly|self-exclusion/i,
  /\bkyc\b/i,
];

type Link = { host: string; path: string };

function externalLinks(html: string): Link[] {
  const links: Link[] = [];
  const re = /href\s*=\s*["']\s*((?:https?:)?\/\/[^"'\s]+)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const raw = m[1] ?? "";
    try {
      const url = new URL(raw.startsWith("//") ? `https:${raw}` : raw);
      const host = url.hostname.toLowerCase();
      if (host === "aired.sh" || host.endsWith(".aired.sh")) continue;
      links.push({ host, path: url.pathname });
    } catch {
      // Malformed URL — ignore.
    }
  }
  return links;
}

function visibleText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ");
}

export function detectSpam(html: string, title: string | null): SpamVerdict {
  const links = externalLinks(html);

  const strong = links.find((l) => STRONG_HOST.test(l.host) || GAMBLING_PATH.test(l.path));
  if (strong) {
    return { spam: true, reason: `links to gambling site ${strong.host}` };
  }

  const text = visibleText(html);
  const titleHit =
    GAMBLING_TITLE.test(title ?? "") || GAMBLING_TITLE.test(text.slice(0, 300));
  const promoHits = PROMO_TERMS.filter((re) => re.test(text)).length;

  const weak = links.find((l) => WEAK_HOST.test(l.host));
  if (weak && (titleHit || promoHits >= 1)) {
    return { spam: true, reason: `links to gambling site ${weak.host}` };
  }

  if (titleHit && promoHits >= 2) {
    return { spam: true, reason: "gambling promotion" };
  }

  return { spam: false };
}

/** Error shown to a publisher whose page is rejected. */
export const SPAM_REJECTION =
  "This page looks like gambling promotion, which aired.sh does not host. If this is a mistake, sign in with `aired login` and publish again.";
