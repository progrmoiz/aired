// Where a view came from, in plain words: a referrer host (lib/view-event.ts
// on the Worker keeps only the host) becomes a friendly name and a kind
// (the Type tab). Icons aren't here: every source shows the favicon the
// Worker fetched for it (components/source-icon.tsx). No imports, so the
// Worker's tests load it.

export type SourceKey =
  | 'direct' | 'other'
  | 'gmail' | 'outlook' | 'protonmail' | 'icloud'
  | 'slack' | 'teams' | 'discord' | 'whatsapp' | 'telegram' | 'messenger' | 'signal' | 'googlechat' | 'zoom'
  | 'google' | 'bing' | 'duckduckgo' | 'brave' | 'yahoo'
  | 'x' | 'linkedin' | 'facebook' | 'instagram' | 'threads' | 'bluesky' | 'mastodon' | 'reddit' | 'tiktok' | 'pinterest' | 'youtube'
  | 'hackernews' | 'producthunt' | 'github' | 'notion' | 'figma' | 'substack' | 'medium'
  | 'chatgpt' | 'claude' | 'perplexity' | 'gemini'

const SOURCES: [RegExp, SourceKey, string][] = [
  [/^(mail\.google\.com|com\.google\.android\.gm)$/, 'gmail', 'Gmail'],
  [/^(outlook\.(live|office|office365)\.com|com\.microsoft\.office\.outlook)$/, 'outlook', 'Outlook'],
  [/^(mail\.proton\.me|ch\.protonmail\.android)$/, 'protonmail', 'Proton Mail'],
  [/^(www\.)?icloud\.com$/, 'icloud', 'iCloud Mail'],
  [/^([a-z0-9-]+\.)?slack\.com$|^com\.slack$|^slack-redir\.net$/, 'slack', 'Slack'],
  [/^teams\.(microsoft|live|cloud\.microsoft)(\.com)?$|^com\.microsoft\.teams$/, 'teams', 'Microsoft Teams'],
  [/^(discord\.com|discordapp\.com|com\.discord)$/, 'discord', 'Discord'],
  [/^(web\.whatsapp\.com|wa\.me|whatsapp\.com|com\.whatsapp)$/, 'whatsapp', 'WhatsApp'],
  [/^(web\.telegram\.org|t\.me|telegram\.org|org\.telegram\.messenger)$/, 'telegram', 'Telegram'],
  [/^(messenger\.com|com\.facebook\.orca)$/, 'messenger', 'Messenger'],
  [/^(signal\.org|org\.thoughtcrime\.securesms)$/, 'signal', 'Signal'],
  [/^chat\.google\.com$/, 'googlechat', 'Google Chat'],
  [/^([a-z0-9-]+\.)?zoom\.us$/, 'zoom', 'Zoom'],
  [/^(google\.[a-z]{2,3}(\.[a-z]{2})?|com\.google\.android\.googlequicksearchbox)$/, 'google', 'Google Search'],
  [/^(bing\.com|cn\.bing\.com)$/, 'bing', 'Bing'],
  [/^duckduckgo\.com$/, 'duckduckgo', 'DuckDuckGo'],
  [/^search\.brave\.com$/, 'brave', 'Brave Search'],
  [/^([a-z]+\.)?search\.yahoo\.com$/, 'yahoo', 'Yahoo'],
  [/^(t\.co|x\.com|twitter\.com|mobile\.twitter\.com)$/, 'x', 'X'],
  [/^(linkedin\.com|lnkd\.in|[a-z]{2}\.linkedin\.com|com\.linkedin\.android)$/, 'linkedin', 'LinkedIn'],
  [/^((l|lm|m|web)\.)?facebook\.com$|^fb\.me$|^com\.facebook\.katana$/, 'facebook', 'Facebook'],
  [/^(l\.)?instagram\.com$|^com\.instagram\.android$/, 'instagram', 'Instagram'],
  [/^(l\.)?threads\.(net|com)$/, 'threads', 'Threads'],
  [/^bsky\.app$/, 'bluesky', 'Bluesky'],
  [/^mastodon\.(social|online)$/, 'mastodon', 'Mastodon'],
  [/^((old|out|new)\.)?reddit\.com$|^com\.reddit\.frontpage$/, 'reddit', 'Reddit'],
  [/^tiktok\.com$/, 'tiktok', 'TikTok'],
  [/^([a-z]{2}\.)?pinterest\.[a-z.]+$/, 'pinterest', 'Pinterest'],
  [/^(youtube\.com|m\.youtube\.com|youtu\.be)$/, 'youtube', 'YouTube'],
  [/^news\.ycombinator\.com$/, 'hackernews', 'Hacker News'],
  [/^producthunt\.com$/, 'producthunt', 'Product Hunt'],
  [/^(github\.com|gist\.github\.com)$/, 'github', 'GitHub'],
  [/^(notion\.so|[a-z0-9-]+\.notion\.site|notion\.site)$/, 'notion', 'Notion'],
  [/^figma\.com$/, 'figma', 'Figma'],
  [/^([a-z0-9-]+\.)?substack\.com$/, 'substack', 'Substack'],
  [/^([a-z0-9-]+\.)?medium\.com$/, 'medium', 'Medium'],
  [/^(chatgpt\.com|chat\.openai\.com)$/, 'chatgpt', 'ChatGPT'],
  [/^claude\.ai$/, 'claude', 'Claude'],
  [/^perplexity\.ai$/, 'perplexity', 'Perplexity'],
  [/^gemini\.google\.com$/, 'gemini', 'Gemini'],
]

/** A referrer host's friendly name and icon. '' is a view with no referrer. */
export function sourceOf(host: string): { key: SourceKey; name: string } {
  if (!host) return { key: 'direct', name: 'Direct or an app' }
  for (const [re, key, name] of SOURCES) if (re.test(host)) return { key, name }
  return { key: 'other', name: host }
}

/** A two-letter country code we draw a flag for; anything else gets the globe. */
export function hasFlag(code: string): boolean {
  return /^[A-Z]{2}$/.test(code) && code !== 'XX'
}

/** Kinds of source, for the Sources card's "Type" tab. */
export type SourceType = 'direct' | 'chat' | 'email' | 'search' | 'social' | 'ai' | 'web'

export const SOURCE_TYPES: Record<SourceType, string> = {
  direct: 'Direct or an app',
  chat: 'Chat and meetings',
  email: 'Email',
  search: 'Search',
  social: 'Social',
  ai: 'AI chats',
  web: 'Other websites',
}

const TYPE_OF: Partial<Record<SourceKey, SourceType>> = {
  direct: 'direct',
  gmail: 'email', outlook: 'email', protonmail: 'email', icloud: 'email',
  slack: 'chat', teams: 'chat', discord: 'chat', whatsapp: 'chat', telegram: 'chat', messenger: 'chat', signal: 'chat', googlechat: 'chat', zoom: 'chat',
  google: 'search', bing: 'search', duckduckgo: 'search', brave: 'search', yahoo: 'search',
  x: 'social', linkedin: 'social', facebook: 'social', instagram: 'social', threads: 'social', bluesky: 'social', mastodon: 'social',
  reddit: 'social', tiktok: 'social', pinterest: 'social', youtube: 'social', hackernews: 'social', producthunt: 'social',
  chatgpt: 'ai', claude: 'ai', perplexity: 'ai', gemini: 'ai',
}

export function sourceType(host: string): SourceType {
  return TYPE_OF[sourceOf(host).key] ?? 'web'
}

/**
 * Views per kind of source, busiest first. `total` is every view in the
 * window: views from sources past the end of the list count as other websites.
 */
export function viewsByType(referrers: { host: string; views: number }[], total: number): { type: SourceType; views: number }[] {
  const sums = new Map<SourceType, number>()
  let listed = 0
  for (const r of referrers) {
    const t = sourceType(r.host)
    sums.set(t, (sums.get(t) ?? 0) + r.views)
    listed += r.views
  }
  if (total > listed) sums.set('web', (sums.get('web') ?? 0) + total - listed)
  return [...sums].map(([type, views]) => ({ type, views })).filter((r) => r.views > 0).sort((a, b) => b.views - a.views)
}
