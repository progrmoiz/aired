// Small icons for the Views page: a flag per country and each source's own
// icon. Nothing is fetched from a CDN, a favicon service or the sites
// themselves.
//
// Flags: country-flag-icons' 3x2 SVGs, copied to /dashboard-assets/flags/ at
// build (vite.config.ts), so a browser only loads the flags it shows.
// Sources: the site's favicon, which the Worker fetches and keeps
// (GET /api/favicon/:host, signed in the report), on a white tile so it
// reads in every theme; a link icon when there's none, and a pointer for
// direct visits.
import { useState } from 'react'
import { GlobeIcon, LinkIcon, MousePointerClickIcon } from 'lucide-react'
import { hasFlag } from '@/lib/sources'
import { cn } from '@/lib/utils'

const TILE = 'grid size-[18px] shrink-0 place-items-center overflow-hidden rounded-[5px] ring-1 ring-foreground/10'

/** A source's icon: `icon` is its signed /api/favicon URL from the report; '' host = direct. */
export function SourceIcon({ host, icon, className }: { host: string; icon?: string; className?: string }) {
  const [failed, setFailed] = useState(false)
  if (host && icon && !failed) {
    return (
      <span aria-hidden="true" className={cn(TILE, 'bg-white', className)}>
        <img src={icon} alt="" width={12} height={12} decoding="async" onError={() => setFailed(true)} className="size-3 object-contain" />
      </span>
    )
  }
  const Icon = host ? LinkIcon : MousePointerClickIcon
  return (
    <span aria-hidden="true" className={cn(TILE, 'bg-muted text-muted-foreground', className)}>
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
