export interface PublishResult {
  id: string
  url: string
  update_token: string
  expiresAt: string | null
}

export interface PageInfo {
  id: string
  title: string | null
  size: number
  readCount: number
  expiresAt: string | null
}

export interface TokenRecord {
  token: string
  title: string | null
  url: string
  created: string
}
