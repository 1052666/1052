/**
 * feishu-accounts-client.ts
 *
 * Native implementation of the Feishu app-registration device flow.
 * No external dependencies — uses Node 18+ built-in fetch only.
 *
 * Endpoint reference (reverse-engineered from @larksuite/openclaw-lark-tools):
 *   POST https://accounts.feishu.cn/oauth/v1/app/registration
 *     action=init   — verify server supports the flow
 *     action=begin  — start flow; receive device_code + QR URL
 *     action=poll   — check scan status; returns credentials on success
 *   POST https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal
 *     — standard public API to validate an app_id + app_secret pair
 *
 * For Lark (international) replace accounts.feishu.cn → accounts.larksuite.com.
 */

import type {
  FeishuBrand,
  FeishuCredentialPayload,
  InitResponse,
  PollResponse,
  QrSession,
} from './types.js'
import { FeishuQrAuthError } from './types.js'

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const ACCOUNTS_BASE: Record<FeishuBrand, string> = {
  feishu: 'https://accounts.feishu.cn',
  lark: 'https://accounts.larksuite.com',
}

const OPEN_API_BASE: Record<FeishuBrand, string> = {
  feishu: 'https://open.feishu.cn',
  lark: 'https://open.larksuite.com',
}

const REGISTRATION_PATH = '/oauth/v1/app/registration'
const TENANT_TOKEN_PATH = '/open-apis/auth/v3/tenant_access_token/internal'

/**
 * POST to the app/registration endpoint with form-encoded body.
 * Throws `FeishuQrAuthError` on non-2xx responses or network failures.
 *
 * @param brand   - Which platform brand to target.
 * @param params  - Key/value pairs serialised as application/x-www-form-urlencoded.
 */
async function postRegistration(
  brand: FeishuBrand,
  params: Record<string, string>,
): Promise<unknown> {
  const url = `${ACCOUNTS_BASE[brand]}${REGISTRATION_PATH}`
  const body = new URLSearchParams(params).toString()

  let response: Response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    })
  } catch (err) {
    throw new FeishuQrAuthError(
      `Network error reaching ${url}: ${String(err)}`,
      'NETWORK_ERROR',
    )
  }

  if (!response.ok) {
    throw new FeishuQrAuthError(
      `accounts.feishu.cn returned HTTP ${response.status} for action=${params['action'] ?? 'unknown'}`,
      response.status,
    )
  }

  try {
    return await response.json()
  } catch {
    throw new FeishuQrAuthError('Failed to parse JSON response from accounts.feishu.cn', 'PARSE_ERROR')
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Step 1 — Check that the Feishu registration server supports the device flow.
 *
 * Calls `action=init` and confirms `client_secret` is listed in `auth_methods`.
 * Throws `FeishuQrAuthError` if the server rejects the flow.
 *
 * @param brand - 'feishu' (default) or 'lark' for international.
 */
export async function initRegistration(brand: FeishuBrand = 'feishu'): Promise<InitResponse> {
  const data = (await postRegistration(brand, { action: 'init' })) as Record<string, unknown>

  // The actual field from Feishu is "supported_auth_methods"; fall back to
  // the undocumented "auth_methods" alias in case it ever changes.
  const methods: string[] = Array.isArray(data['supported_auth_methods'])
    ? (data['supported_auth_methods'] as string[])
    : Array.isArray(data['auth_methods'])
      ? (data['auth_methods'] as string[])
      : []

  if (!methods.includes('client_secret')) {
    throw new FeishuQrAuthError(
      `Server did not list client_secret as a supported auth method. Got: ${methods.join(', ')}`,
      'UNSUPPORTED_AUTH_METHOD',
    )
  }

  return { auth_methods: methods, ok: true }
}

/**
 * Step 2 — Begin the QR registration flow.
 *
 * Calls `action=begin` with archetype=PersonalAgent and returns a `QrSession`
 * containing the verification URL to render as a QR code and the device_code
 * required for subsequent polling.
 *
 * Implicitly calls `initRegistration()` first to fail fast if unsupported.
 *
 * @param brand - 'feishu' (default) or 'lark' for international.
 */
export async function beginQrAuth(brand: FeishuBrand = 'feishu'): Promise<QrSession> {
  await initRegistration(brand)

  const data = (await postRegistration(brand, {
    action: 'begin',
    archetype: 'PersonalAgent',
    auth_method: 'client_secret',
    request_user_info: 'open_id',
  })) as Record<string, unknown>

  const deviceCode = typeof data['device_code'] === 'string' ? data['device_code'] : ''
  const verificationUriComplete =
    typeof data['verification_uri_complete'] === 'string' ? data['verification_uri_complete'] : ''
  const expiresIn = typeof data['expires_in'] === 'number' ? data['expires_in'] : 600
  const interval = typeof data['interval'] === 'number' ? data['interval'] : 5

  if (!deviceCode || !verificationUriComplete) {
    throw new FeishuQrAuthError(
      'begin response missing device_code or verification_uri_complete',
      'INVALID_RESPONSE',
    )
  }

  return {
    deviceCode,
    verificationUriComplete,
    expiresAt: Math.floor(Date.now() / 1000) + expiresIn,
    interval,
    brand,
  }
}

/**
 * Step 3 — Poll for QR scan completion.
 *
 * Should be called every `QrSession.interval` seconds.
 * Returns `FeishuCredentialPayload` when the user has successfully scanned
 * and authorised; throws `FeishuQrAuthError` on terminal failures (expired,
 * denied) or re-throws with the pending status for callers to back off.
 *
 * @param deviceCode - Obtained from `beginQrAuth()`.
 * @param brand      - Must match the brand used in `beginQrAuth()`.
 * @param signal     - Optional AbortSignal to cancel an in-flight poll.
 */
export async function pollQrStatus(
  deviceCode: string,
  brand: FeishuBrand = 'feishu',
  signal?: AbortSignal,
): Promise<FeishuCredentialPayload> {
  if (deviceCode.trim() === '') {
    throw new FeishuQrAuthError('deviceCode must not be empty', 'INVALID_ARGUMENT')
  }

  let response: Response
  const url = `${ACCOUNTS_BASE[brand]}${REGISTRATION_PATH}`
  const body = new URLSearchParams({ action: 'poll', device_code: deviceCode }).toString()

  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      signal,
    })
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new FeishuQrAuthError('Poll aborted by caller', 'ABORTED')
    }
    throw new FeishuQrAuthError(`Network error during poll: ${String(err)}`, 'NETWORK_ERROR')
  }

  if (!response.ok) {
    throw new FeishuQrAuthError(
      `Poll returned HTTP ${response.status}`,
      response.status,
    )
  }

  const data = (await response.json()) as PollResponse

  // Non-terminal pending states — callers should retry after interval
  if ('error' in data) {
    const status = data.error
    if (status === 'expired') {
      throw new FeishuQrAuthError('QR session expired — call beginQrAuth() again', 'EXPIRED')
    }
    if (status === 'access_denied') {
      throw new FeishuQrAuthError('User denied the authorisation request', 'ACCESS_DENIED')
    }
    // authorization_pending / slow_down — not terminal, re-throw with status code
    throw new FeishuQrAuthError(`Poll pending: ${status}`, status)
  }

  // Success path
  const { client_id, client_secret, user_info } = data
  if (!client_id || !client_secret) {
    throw new FeishuQrAuthError('Poll success response missing client_id or client_secret', 'INVALID_RESPONSE')
  }

  const resolvedBrand: FeishuBrand =
    user_info?.tenant_brand === 'lark' ? 'lark' : 'feishu'

  return {
    appId: client_id,
    appSecret: client_secret,
    openId: user_info?.open_id,
    brand: resolvedBrand,
  }
}

/**
 * Validate an existing App ID + App Secret pair by obtaining a tenant_access_token.
 *
 * Uses the standard public API:
 *   POST https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal
 *
 * Returns `true` if credentials are valid (HTTP 200 and code === 0).
 * Returns `false` for known-invalid credential responses (code !== 0).
 * Throws `FeishuQrAuthError` on network or unexpected server errors.
 *
 * @param appId     - The Feishu App ID (cli_xxx…).
 * @param appSecret - The corresponding App Secret.
 * @param brand     - 'feishu' (default) or 'lark'.
 */
export async function verifyTenantToken(
  appId: string,
  appSecret: string,
  brand: FeishuBrand = 'feishu',
): Promise<boolean> {
  if (!appId || !appSecret) {
    throw new FeishuQrAuthError('appId and appSecret must not be empty', 'INVALID_ARGUMENT')
  }

  const url = `${OPEN_API_BASE[brand]}${TENANT_TOKEN_PATH}`

  let response: Response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
    })
  } catch (err) {
    throw new FeishuQrAuthError(
      `Network error reaching tenant_access_token API: ${String(err)}`,
      'NETWORK_ERROR',
    )
  }

  if (!response.ok) {
    throw new FeishuQrAuthError(
      `tenant_access_token API returned HTTP ${response.status}`,
      response.status,
    )
  }

  const body = (await response.json()) as { code?: number; msg?: string }
  // Feishu returns code=0 on success
  return body.code === 0
}
