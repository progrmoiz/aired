// Copy tokens.css to apps/web/tokens.css, which the static site serves at
// /tokens.css (site.css imports it). The Worker's build runs this; the
// worker test tokens-sync fails if the copy and this file differ.
import { copyFileSync } from 'node:fs'
copyFileSync(new URL('./tokens.css', import.meta.url), new URL('../../apps/web/tokens.css', import.meta.url))
console.log('tokens.css → apps/web/tokens.css')
