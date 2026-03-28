const DEFAULT_API_URL = "https://aired.sh";

export interface PublishOptions {
  title?: string;
  pin?: string;
  ttl?: number;
  reads?: number;
  permanent?: boolean;
  update_token?: string;
  id?: string;
  apiUrl?: string;
}

export interface PublishResult {
  id: string;
  url: string;
  update_token: string;
  expiresAt: string | null;
}

export interface PageInfo {
  id: string;
  title: string | null;
  size: number;
  readCount: number;
  expiresAt: string | null;
}

function getApiUrl(apiUrl?: string): string {
  return apiUrl ?? process.env["AIRED_API_URL"] ?? DEFAULT_API_URL;
}

async function handleResponse<T>(resp: Response, action: string): Promise<T> {
  if (resp.status === 429) {
    const err = new Error("Rate limited: too many uploads. Try again in an hour.");
    (err as NodeJS.ErrnoException).code = "RATE_LIMITED";
    throw err;
  }

  if (!resp.ok) {
    let message = `${action} failed (${resp.status})`;
    try {
      const body = await resp.json() as Record<string, unknown>;
      if (typeof body["error"] === "string") {
        message = body["error"];
      }
    } catch {
      // ignore parse error, use default message
    }
    throw new Error(message);
  }

  try {
    return await resp.json() as T;
  } catch {
    throw new Error(`${action}: unexpected response format`);
  }
}

export async function publishHTML(
  html: string,
  options: PublishOptions = {},
): Promise<PublishResult> {
  const base = getApiUrl(options.apiUrl);
  const body: Record<string, unknown> = { html };

  if (options.title !== undefined) body["title"] = options.title;
  if (options.pin !== undefined) body["pin"] = options.pin;
  if (options.ttl !== undefined) body["ttl"] = options.ttl;
  if (options.reads !== undefined) body["reads"] = options.reads;
  if (options.permanent === true) body["permanent"] = true;
  if (options.update_token !== undefined) body["update_token"] = options.update_token;
  if (options.id !== undefined) body["id"] = options.id;

  const resp = await fetch(`${base}/api/publish`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  return handleResponse<PublishResult>(resp, "Publish");
}

export async function updatePage(
  id: string,
  html: string,
  token: string,
  options: { title?: string; apiUrl?: string } = {},
): Promise<PublishResult> {
  const base = getApiUrl(options.apiUrl);
  const body: Record<string, unknown> = { html, update_token: token };

  if (options.title !== undefined) body["title"] = options.title;

  const resp = await fetch(`${base}/api/pages/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  return handleResponse<PublishResult>(resp, "Update");
}

export async function deletePage(
  id: string,
  token: string,
  options: { apiUrl?: string } = {},
): Promise<void> {
  const base = getApiUrl(options.apiUrl);

  const resp = await fetch(`${base}/api/pages/${id}`, {
    method: "DELETE",
    headers: { "Authorization": `Bearer ${token}` },
  });

  await handleResponse<{ ok: boolean }>(resp, "Delete");
}

export async function getPage(
  id: string,
  options: { apiUrl?: string } = {},
): Promise<PageInfo> {
  const base = getApiUrl(options.apiUrl);

  const resp = await fetch(`${base}/api/pages/${id}`);
  return handleResponse<PageInfo>(resp, "Get page");
}

export async function pageExists(
  id: string,
  options: { apiUrl?: string } = {},
): Promise<boolean> {
  const base = getApiUrl(options.apiUrl);

  try {
    const resp = await fetch(`${base}/api/pages/${id}`, { method: "HEAD" });
    return resp.ok;
  } catch {
    // network error — assume still exists to avoid pruning
    return true;
  }
}
