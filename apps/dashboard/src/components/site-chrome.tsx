// The footer in the marketing site's style, so the dashboard reads as the
// same product. (The header is TopBar.)

const FOOTER = [
  ['Pricing', '/pricing'], ['Docs', '/docs'], ['Guides', '/guides'], ['Report abuse', '/abuse'],
  ['Terms', '/terms'], ['Privacy', '/privacy'], ['Refunds', '/refunds'], ['GitHub', 'https://github.com/progrmoiz/aired'],
] as const

export function SiteFooter() {
  return (
    <footer className="mt-auto border-t border-hairline">
      <div className="mx-auto flex max-w-(--aired-page-max) flex-wrap justify-between gap-x-6 gap-y-2 px-5 py-7 text-[13px] text-subtle sm:px-8">
        <span>aired</span>
        <nav aria-label="Footer" className="flex flex-wrap gap-x-[18px] gap-y-1.5">
          {FOOTER.map(([label, href]) => (
            <a key={href} href={href} className="inline-flex min-h-6 items-center hover:text-foreground" {...(href.startsWith('http') ? { target: '_blank', rel: 'noopener' } : {})}>{label}</a>
          ))}
        </nav>
      </div>
    </footer>
  )
}
