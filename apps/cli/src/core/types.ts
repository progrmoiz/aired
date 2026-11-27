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
  project?: string | null
  /** A PIN is on: the API hides title and readCount (null and 0) then. Older APIs leave it out. */
  pinProtected?: boolean
}

export interface TokenRecord {
  token: string
  title: string | null
  url: string
  created: string
}

/** GET /api/pages/:id/details and PATCH /api/pages/:id: the owner's view. Never the PIN. */
export interface PageDetails {
  id: string
  url: string
  title: string | null
  size: number
  readCount: number
  reads: number | null
  hasPin: boolean
  permanent: boolean
  createdAt: string
  expiresAt: string | null
  project: string | null
  /** PATCH only: the settings that changed. */
  changed?: string[]
}

export interface FeedbackResult {
  id: string
  message: string
}

/** POST /api/pages/:id/check: what a browser saw on the page (check_page). */
export interface CheckReport {
  id: string
  url: string
  /** No errors (warnings don't count). */
  ok: boolean
  viewport: 'desktop' | 'mobile'
  checked_at: string
  load_ms: number
  issues: Array<{ severity: 'error' | 'warning'; code: string; message: string }>
  console: Array<{ level: string; text: string; source: string | null }>
  failed_requests: Array<{ url: string; status: number | null; error: string | null; type: string }>
  page: {
    title: string | null
    html_bytes: number
    text_chars: number
    visible_media: number
    width: number
    height: number
    transfer_bytes: number
    requests: number
  }
  blank: boolean
  screenshot_url: string | null
  screenshot_expires_at: string | null
}
