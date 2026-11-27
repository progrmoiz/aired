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

// The stdio MCP server (apps/mcp) ships inside this package as its own bundle,
// so `npx aired --mcp` works without the monorepo.
await build({
  entryPoints: ['../mcp/src/index.ts'],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  minify: true,
  outfile: 'dist/mcp.cjs',
  // The skills (skills/*/SKILL.md) are served as MCP resources from the same files.
  loader: { '.md': 'text' },
  banner: { js: `// ${pkg.name} v${pkg.version} MCP server — MIT License` },
  define: { '__AIRED_VERSION__': JSON.stringify(pkg.version) },
})
console.log(`Built dist/mcp.cjs — ${(statSync('dist/mcp.cjs').size / 1024).toFixed(1)} KB`)

const stat = statSync('dist/cli.cjs')
const sizeKb = (stat.size / 1024).toFixed(1)
console.log(`Built dist/cli.cjs — ${sizeKb} KB`)
if (stat.size > 500 * 1024) {
  console.warn(`Warning: bundle size exceeds 500 KB target`)
}
