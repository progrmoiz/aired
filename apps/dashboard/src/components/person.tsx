// People: a round avatar with initials (a steady colour per person) and a
// stack of them for "who's here". Used by sharing, members and activity.
import { cn } from '@/lib/utils'

const TONES = [
  'bg-rose-200 text-rose-900', 'bg-sky-200 text-sky-900', 'bg-amber-200 text-amber-900', 'bg-emerald-200 text-emerald-900',
  'bg-violet-200 text-violet-900', 'bg-lime-200 text-lime-900', 'bg-orange-200 text-orange-900', 'bg-cyan-200 text-cyan-900',
]

const toneFor = (key: string) => {
  let h = 0
  for (const ch of key) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return TONES[h % TONES.length]
}

export const initialsOf = (name: string) => name.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase()

export function PersonAvatar({ name, size = 'md', className }: { name: string; size?: 'xs' | 'sm' | 'md' | 'lg'; className?: string }) {
  return (
    <span aria-hidden="true" className={cn('inline-grid shrink-0 place-items-center rounded-full font-semibold', toneFor(name),
      { xs: 'size-5 text-[9px]', sm: 'size-6 text-[10px]', md: 'size-8 text-xs', lg: 'size-10 text-sm' }[size], className)}>
      {size === 'xs' ? initialsOf(name)[0] : initialsOf(name)}
    </span>
  )
}

export function AvatarStack({ names, max = 4, size = 'sm', className }: { names: string[]; max?: number; size?: 'xs' | 'sm' | 'md'; className?: string }) {
  const shown = names.slice(0, max)
  const more = names.length - shown.length
  return (
    <span className={cn('flex items-center -space-x-1.5', className)}>
      {shown.map((n) => <PersonAvatar key={n} name={n} size={size} className="ring-2 ring-background" />)}
      {more > 0 && <span className={cn('inline-grid place-items-center rounded-full bg-secondary font-medium text-muted-foreground ring-2 ring-background', size === 'xs' ? 'size-5 text-[9px]' : size === 'sm' ? 'size-6 text-[10px]' : 'size-8 text-xs')}>+{more}</span>}
      <span className="sr-only">{names.join(', ')}</span>
    </span>
  )
}
