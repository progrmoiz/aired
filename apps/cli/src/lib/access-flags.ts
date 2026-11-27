/** Flags for who can open a page (aired set). No imports, so tests load it. */

/**
 * `--only alice@client.com,@agency.io`: emails, and whole domains written
 * with a leading @, as the PATCH body's access field. Commas or spaces
 * separate them. The server checks each one.
 */
export function accessFromOnly(list: string): { access: { mode: 'people'; emails: string[]; domains: string[] } } | { error: string } {
  const items = list.split(/[\s,]+/).map((x) => x.trim()).filter((x) => x !== '')
  if (items.length === 0) return { error: 'Pass at least one email or @domain to --only, e.g. --only alice@client.com,@client.com' }
  const emails: string[] = []
  const domains: string[] = []
  for (const item of items) {
    if (item.startsWith('@')) domains.push(item.slice(1))
    else if (item.includes('@')) emails.push(item)
    else return { error: `'${item}' isn't an email or a domain. Write a whole domain as @${item}.` }
  }
  return { access: { mode: 'people', emails, domains } }
}
