import Conf from 'conf'

const cache = new Map<string, Conf<Record<string, unknown>>>()

export function createStore<T extends Record<string, unknown>>(
  configName: string,
  defaults?: T,
): Conf<T> {
  if (cache.has(configName)) {
    return cache.get(configName) as Conf<T>
  }

  const conf = new Conf<T>({
    projectName: 'aired',
    cwd: `${process.env['HOME'] ?? '~'}/.config/aired`,
    fileExtension: 'json',
    configFileMode: 0o600,
    configName,
    defaults: (defaults ?? {}) as T,
  })

  cache.set(configName, conf as Conf<Record<string, unknown>>)
  return conf
}
