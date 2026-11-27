// A QR code for a page link, made in the browser (uqr, no network): as an
// SVG string and as a PNG. Always dark squares on white, whatever the theme,
// so every phone camera reads it.
import { encode } from 'uqr'

export type Qr = { size: number; path: string }

/** The code's modules as one SVG path, with a 2-module quiet zone around it. */
export function qrFor(text: string): Qr {
  const { data, size } = encode(text, { ecc: 'M', border: 2 })
  let path = ''
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (data[y]![x]) path += `M${x} ${y}h1v1h-1z`
    }
  }
  return { size, path }
}

export function qrSvg(qr: Qr): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${qr.size} ${qr.size}" width="${qr.size * 10}" height="${qr.size * 10}" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="#fff"/><path d="${qr.path}" fill="#000"/></svg>`
}

/** A PNG about 1000px wide: big enough to print. */
export function qrPng(qr: Qr): Promise<Blob> {
  const scale = Math.max(8, Math.ceil(1000 / qr.size))
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = qr.size * scale
  const ctx = canvas.getContext('2d')
  if (!ctx) return Promise.reject(new Error('No canvas'))
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.scale(scale, scale)
  ctx.fillStyle = '#000'
  ctx.fill(new Path2D(qr.path))
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('No PNG'))), 'image/png'))
}

/** Save a blob as a file. */
export function saveFile(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
