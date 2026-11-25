// A label, a number and a bar: "Spelling game: animals +21".
export function MeterRow({ label, value, max }: { label: string; value: number; max: number }) {
  return (
    <li className="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1.5">
      <span className="truncate text-body text-foreground">{label}</span>
      <span className="text-base font-semibold text-ok tabular-nums">+{value}</span>
      <span className="col-span-2 h-2 overflow-hidden rounded-full bg-chip" role="presentation">
        <i className="block h-full rounded-full bg-[color-mix(in_srgb,var(--warn)_55%,var(--warn-bg))]" style={{ width: `${(value / max) * 100}%` }} />
      </span>
    </li>
  )
}
