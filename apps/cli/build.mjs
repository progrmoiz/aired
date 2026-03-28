import { build } from 'esbuild'
import { readFileSync, statSync } from 'fs'

const pkg = JSON.parse(readFileSync('./package.json', 'utf-8'))

await build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  minify: true,
  outfile: 'dist/cli.cjs',
  banner: {
    js: `#!/usr/bin/env node\n// ${pkg.name} v${pkg.version} — MIT License`,
  },
  define: {
    '__CLI_VERSION__': JSON.stringify(pkg.version),
  },
})

const stat = statSync('dist/cli.cjs')
const sizeKb = (stat.size / 1024).toFixed(1)
console.log(`Built dist/cli.cjs — ${sizeKb} KB`)
if (stat.size > 500 * 1024) {
  console.warn(`Warning: bundle size exceeds 500 KB target`)
}
