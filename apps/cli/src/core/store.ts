import Conf from 'conf'
import type { TokenRecord } from './types.js'
import { pageExists } from './client.js'

type TokenStore = Record<string, TokenRecord>

let _conf: Conf<TokenStore> | null = null

function getConf(): Conf<TokenStore> {
  if (_conf === null) {
    _conf = new Conf<TokenStore>({
      projectName: 'aired',
      configName: 'tokens',
      cwd: `${process.env['HOME'] ?? '~'}/.config/aired`,
      fileExtension: 'json',
      configFileMode: 0o600,
      defaults: {},
    })
  }
  return _conf
}

export function saveToken(
  id: string,
  token: string,
  meta: { title?: string | null; url: string },
): void {
  const conf = getConf()
  conf.set(id, {
    token,
    title: meta.title ?? null,
    url: meta.url,
    created: new Date().toISOString(),
  })
}

export function getToken(id: string): string | null {
  const conf = getConf()
  const record = conf.get(id)
  return record?.token ?? null
}

export function getRecord(id: string): TokenRecord | null {
  const conf = getConf()
  const record = conf.get(id)
  return record ?? null
}

export function listTokens(): Array<{ id: string } & TokenRecord> {
  const conf = getConf()
  return Object.entries(conf.store).map(([id, record]) => ({ id, ...record }))
}

export function removeToken(id: string): void {
  const conf = getConf()
  conf.delete(id)
}

export function getStorePath(): string {
  return getConf().path
}

export async function pruneExpired(baseUrl: string): Promise<number> {
  const tokens = listTokens()
  let pruned = 0

  await Promise.all(
    tokens.map(async (entry) => {
      const exists = await pageExists(baseUrl, entry.id)
      if (!exists) {
        removeToken(entry.id)
        pruned++
      }
    }),
  )

  return pruned
}
