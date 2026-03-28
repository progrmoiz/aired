declare const __CLI_VERSION__: string
export const VERSION = typeof __CLI_VERSION__ !== 'undefined' ? __CLI_VERSION__ : '0.0.0-dev'
export const CLI_NAME = 'aired'
export const CONFIG_DIR_NAME = 'aired'
export const DEFAULT_API_URL = 'https://aired.sh'
export const USER_AGENT = `${CLI_NAME}/${VERSION}`
