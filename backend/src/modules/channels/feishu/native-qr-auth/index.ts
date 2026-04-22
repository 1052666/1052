/**
 * native-qr-auth — public entry point.
 *
 * Re-exports all types and the four client functions so consumers can import
 * from the directory without knowing its internal layout:
 *
 *   import { beginQrAuth, pollQrStatus, verifyTenantToken, FeishuQrAuthError }
 *     from '../native-qr-auth/index.js'
 */

export type {
  BeginResponse,
  FeishuBrand,
  FeishuCredentialPayload,
  InitResponse,
  PollPendingResponse,
  PollPendingStatus,
  PollResponse,
  PollSuccessResponse,
  QrSession,
} from './types.js'

export { FeishuQrAuthError } from './types.js'

export {
  beginQrAuth,
  initRegistration,
  pollQrStatus,
  verifyTenantToken,
} from './feishu-accounts-client.js'
