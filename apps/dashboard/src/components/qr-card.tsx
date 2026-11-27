// A QR code for the page's link, drawn here in the browser, to put on a
// slide, a poster or a printout. Download as PNG or SVG.
import { useMemo } from 'react'
import { toast } from 'sonner'
import { DownloadIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { qrFor, qrPng, qrSvg, saveFile } from '@/lib/qr'

export function QrCard({ pageId, url }: { pageId: string; url: string }) {
  const qr = useMemo(() => qrFor(url), [url])
  const name = `aired-${pageId}-qr`
  const png = async () => {
    try { saveFile(await qrPng(qr), `${name}.png`) } catch { toast.error('Could not make the PNG. Try the SVG.') }
  }
  const svg = () => saveFile(new Blob([qrSvg(qr)], { type: 'image/svg+xml' }), `${name}.svg`)

  return (
    <Card className="scroll-mt-24 gap-0 py-0" id="section-qr">
      <div className="flex items-start gap-4 px-5 py-4">
        <svg role="img" aria-label={`QR code for ${url}`} viewBox={`0 0 ${qr.size} ${qr.size}`} shapeRendering="crispEdges"
          className="size-28 shrink-0 rounded-lg bg-white ring-1 ring-hairline">
          <path d={qr.path} fill="#000" />
        </svg>
        <div className="min-w-0">
          <p className="text-sm font-medium">QR code</p>
          <p className="mt-0.5 text-xs text-subtle">Point a phone camera at it to open the page. Put it on a slide, a poster or a printout.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={png}><DownloadIcon />PNG</Button>
            <Button variant="outline" size="sm" onClick={svg}><DownloadIcon />SVG</Button>
          </div>
        </div>
      </div>
    </Card>
  )
}
