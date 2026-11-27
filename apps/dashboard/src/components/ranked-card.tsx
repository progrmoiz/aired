// A card of ranked rows, one tab per way of slicing the views: each row has
// an icon, a name and its count, over a soft bar sized against the top row.
// The first few show; Details opens the rest in place.
import { useState, type ReactNode } from 'react'
import { Maximize2Icon, Minimize2Icon } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'

export type RankRow = { key: string; label: ReactNode; title?: string; views: number; href?: string; icon?: ReactNode }
export type RankTab = { key: string; label: string; rows: RankRow[]; empty: string }

const SHOWN = 8

export function RankedCard({ tabs, label, total }: { tabs: RankTab[]; label: string; total: number }) {
  const [tab, setTab] = useState(tabs[0]!.key)
  return (
    <Card className="gap-0 px-0 py-0">
      <Tabs value={tab} onValueChange={(v) => setTab(String(v))} className="gap-0">
        <div className="flex min-h-12 items-center justify-between gap-3 border-b border-border px-4">
          {tabs.length > 1 ? (
            <TabsList aria-label={label} className="h-8 bg-tint p-[3px]">
              {tabs.map((t) => <TabsTrigger key={t.key} value={t.key} className="h-full flex-none px-2.5 text-[13px]">{t.label}</TabsTrigger>)}
            </TabsList>
          ) : (
            <h2 className="text-[14px] font-medium">{tabs[0]!.label}</h2>
          )}
          <span className="text-xs text-subtle">Views</span>
        </div>
        {tabs.map((t) => (
          <TabsContent key={t.key} value={t.key} className="px-2 py-2">
            <Rows rows={t.rows} empty={t.empty} total={total} />
          </TabsContent>
        ))}
      </Tabs>
    </Card>
  )
}

function Rows({ rows, empty, total }: { rows: RankRow[]; empty: string; total: number }) {
  const [open, setOpen] = useState(false)
  if (rows.length === 0) return <p className="px-2.5 py-3 text-sm text-subtle">{empty}</p>
  const top = Math.max(1, rows[0]!.views)
  const shown = open ? rows : rows.slice(0, SHOWN)
  return (
    <>
      <ul className="grid gap-0.5">
        {shown.map((r) => {
          const share = total > 0 ? Math.round((r.views / total) * 100) : 0
          const inner = (
            <>
              <span className="absolute inset-y-0 left-0 rounded-md bg-tint" style={{ width: `${Math.max(1.5, (r.views / top) * 100)}%` }} aria-hidden="true" />
              {r.icon && <span className="relative flex w-5 shrink-0 justify-center">{r.icon}</span>}
              <span className="relative min-w-0 flex-1 truncate" title={r.title}>{r.label}</span>
              <span className="relative tabular-nums text-foreground" title={`${share}% of views`}>{r.views.toLocaleString()}</span>
            </>
          )
          const cls = 'relative flex h-9 items-center gap-2.5 rounded-md px-2.5 text-sm'
          return (
            <li key={r.key}>
              {r.href
                ? <a href={r.href} className={cn(cls, 'hover:underline hover:decoration-input hover:underline-offset-4')}>{inner}</a>
                : <div className={cls}>{inner}</div>}
            </li>
          )
        })}
      </ul>
      {rows.length > SHOWN && (
        <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open}
          className="mx-auto mt-1 flex h-8 items-center gap-1.5 rounded-md px-3 text-xs font-medium tracking-wide text-muted-foreground uppercase hover:bg-tint hover:text-foreground">
          {open ? <Minimize2Icon className="size-3.5" /> : <Maximize2Icon className="size-3.5" />}
          {open ? 'Show less' : `Details · ${rows.length}`}
        </button>
      )}
    </>
  )
}
