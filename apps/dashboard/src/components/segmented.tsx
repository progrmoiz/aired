// A labelled segmented control, built on ToggleGroup (variant "segment").
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'

export function Segmented({ label, items, value, hint }: { label: string; items: string[]; value: string; hint?: string }) {
  return (
    <div>
      <p className="mb-2 text-xs font-medium text-subtle">{label}</p>
      <ToggleGroup aria-label={label} variant="segment" spacing={1} defaultValue={[value]} className="w-full rounded-xl bg-tint p-1">
        {items.map((t) => <ToggleGroupItem key={t} value={t}>{t}</ToggleGroupItem>)}
      </ToggleGroup>
      {hint && <p className="mt-1.5 text-xs text-subtle">{hint}</p>}
    </div>
  )
}
