// Small icons for the Views page: a flag per country and a brand mark per
// source. Everything is bundled or served from this origin; nothing is
// fetched from a CDN, a favicon service or the sites themselves.
//
// Flags: country-flag-icons' 3x2 SVGs, copied to /dashboard-assets/flags/ at
// build (vite.config.ts), so a browser only loads the flags it shows.
// Brands: single icon files from simple-icons (CC0; imported one by one, never
// the package index, which is huge), as white marks on the brand colour. Brands simple-icons doesn't carry (Slack,
// LinkedIn, Microsoft and OpenAI asked to be left out) get a plain icon.
import { useState } from 'react'
import {
  BriefcaseBusinessIcon, GlobeIcon, LinkIcon, MailIcon, MessageSquareIcon, MousePointerClickIcon, SearchIcon, SparklesIcon, UsersIcon,
  type LucideIcon,
} from 'lucide-react'
import gmailSvg from 'simple-icons/icons/gmail.svg?raw'
import protonmailSvg from 'simple-icons/icons/protonmail.svg?raw'
import icloudSvg from 'simple-icons/icons/icloud.svg?raw'
import discordSvg from 'simple-icons/icons/discord.svg?raw'
import whatsappSvg from 'simple-icons/icons/whatsapp.svg?raw'
import telegramSvg from 'simple-icons/icons/telegram.svg?raw'
import messengerSvg from 'simple-icons/icons/messenger.svg?raw'
import signalSvg from 'simple-icons/icons/signal.svg?raw'
import googlechatSvg from 'simple-icons/icons/googlechat.svg?raw'
import zoomSvg from 'simple-icons/icons/zoom.svg?raw'
import googleSvg from 'simple-icons/icons/google.svg?raw'
import duckduckgoSvg from 'simple-icons/icons/duckduckgo.svg?raw'
import braveSvg from 'simple-icons/icons/brave.svg?raw'
import xSvg from 'simple-icons/icons/x.svg?raw'
import facebookSvg from 'simple-icons/icons/facebook.svg?raw'
import instagramSvg from 'simple-icons/icons/instagram.svg?raw'
import threadsSvg from 'simple-icons/icons/threads.svg?raw'
import blueskySvg from 'simple-icons/icons/bluesky.svg?raw'
import mastodonSvg from 'simple-icons/icons/mastodon.svg?raw'
import redditSvg from 'simple-icons/icons/reddit.svg?raw'
import tiktokSvg from 'simple-icons/icons/tiktok.svg?raw'
import pinterestSvg from 'simple-icons/icons/pinterest.svg?raw'
import youtubeSvg from 'simple-icons/icons/youtube.svg?raw'
import hackernewsSvg from 'simple-icons/icons/ycombinator.svg?raw'
import producthuntSvg from 'simple-icons/icons/producthunt.svg?raw'
import githubSvg from 'simple-icons/icons/github.svg?raw'
import notionSvg from 'simple-icons/icons/notion.svg?raw'
import figmaSvg from 'simple-icons/icons/figma.svg?raw'
import substackSvg from 'simple-icons/icons/substack.svg?raw'
import mediumSvg from 'simple-icons/icons/medium.svg?raw'
import claudeSvg from 'simple-icons/icons/claude.svg?raw'
import perplexitySvg from 'simple-icons/icons/perplexity.svg?raw'
import geminiSvg from 'simple-icons/icons/googlegemini.svg?raw'
import { type SourceKey, hasFlag, sourceOf } from '@/lib/sources'
import { cn } from '@/lib/utils'

/** The single path of a simple-icons SVG (each file is one 24×24 <path>). */
const pathOf = (svg: string) => /<path d="([^"]+)"/.exec(svg)?.[1] ?? ''

/** Each brand: its simple-icons SVG and brand colour (the tile behind the white mark). */
const BRAND_SVGS: Partial<Record<SourceKey, [string, string]>> = {
  gmail: [gmailSvg, '#EA4335'],
  protonmail: [protonmailSvg, '#6D4AFF'],
  icloud: [icloudSvg, '#3693F3'],
  discord: [discordSvg, '#5865F2'],
  whatsapp: [whatsappSvg, '#25D366'],
  telegram: [telegramSvg, '#26A5E4'],
  messenger: [messengerSvg, '#0866FF'],
  signal: [signalSvg, '#3B45FD'],
  googlechat: [googlechatSvg, '#34A853'],
  zoom: [zoomSvg, '#0B5CFF'],
  google: [googleSvg, '#4285F4'],
  duckduckgo: [duckduckgoSvg, '#DE5833'],
  brave: [braveSvg, '#FB542B'],
  x: [xSvg, '#000000'],
  facebook: [facebookSvg, '#0866FF'],
  instagram: [instagramSvg, '#FF0069'],
  threads: [threadsSvg, '#000000'],
  bluesky: [blueskySvg, '#1185FE'],
  mastodon: [mastodonSvg, '#6364FF'],
  reddit: [redditSvg, '#FF4500'],
  tiktok: [tiktokSvg, '#000000'],
  pinterest: [pinterestSvg, '#BD081C'],
  youtube: [youtubeSvg, '#FF0000'],
  hackernews: [hackernewsSvg, '#F0652F'],
  producthunt: [producthuntSvg, '#DA552F'],
  github: [githubSvg, '#181717'],
  notion: [notionSvg, '#000000'],
  figma: [figmaSvg, '#F24E1E'],
  substack: [substackSvg, '#FF6719'],
  medium: [mediumSvg, '#000000'],
  claude: [claudeSvg, '#D97757'],
  perplexity: [perplexitySvg, '#1FB8CD'],
  gemini: [geminiSvg, '#8E75B2'],
}
const BRANDS: Partial<Record<SourceKey, { path: string; color: string }>> = Object.fromEntries(
  Object.entries(BRAND_SVGS).map(([k, v]) => [k, { path: pathOf(v![0]), color: v![1] }]),
)

const PLAIN: Partial<Record<SourceKey, LucideIcon>> = {
  direct: MousePointerClickIcon,
  slack: MessageSquareIcon,
  teams: UsersIcon,
  outlook: MailIcon,
  linkedin: BriefcaseBusinessIcon,
  bing: SearchIcon,
  yahoo: SearchIcon,
  chatgpt: SparklesIcon,
}

/**
 * The icon for a referrer host ('' = direct), as a small app tile: the
 * brand's white mark on its colour, or a plain glyph on a neutral tile. The
 * hairline ring keeps dark tiles visible on Midnight and light ones on
 * Daylight.
 */
export function SourceIcon({ host, className }: { host: string; className?: string }) {
  const { key } = sourceOf(host)
  const brand = BRANDS[key]
  const tile = cn('grid size-[18px] shrink-0 place-items-center rounded-[5px] ring-1 ring-foreground/10', className)
  if (brand) {
    return (
      <span aria-hidden="true" className={tile} style={{ backgroundColor: brand.color }}>
        <svg viewBox="0 0 24 24" fill="#fff" className="size-[11px]"><path d={brand.path} /></svg>
      </span>
    )
  }
  const Icon = PLAIN[key] ?? LinkIcon
  return (
    <span aria-hidden="true" className={cn(tile, 'bg-muted text-muted-foreground')}>
      <Icon className="size-[11px]" strokeWidth={2.4} />
    </span>
  )
}

/** A country's flag, or a globe for unknown, Tor or a flag we don't have. */
export function CountryFlag({ code, className }: { code: string; className?: string }) {
  const [missing, setMissing] = useState(false)
  if (!hasFlag(code) || missing) {
    return <GlobeIcon aria-hidden="true" className={cn('size-4 shrink-0 text-muted-foreground', className)} />
  }
  return (
    <img
      src={`/dashboard-assets/flags/${code}.svg`}
      alt=""
      width={20}
      height={14}
      decoding="async"
      onError={() => setMissing(true)}
      className={cn('h-[14px] w-5 shrink-0 rounded-[3px] object-cover ring-1 ring-foreground/15', className)}
    />
  )
}
