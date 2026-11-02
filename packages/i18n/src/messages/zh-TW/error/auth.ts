import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/auth";

export const messages = {
  // Errors from the OpenBot account service.
  "error.auth.serviceUnavailable": "OpenBot 無法連線帳號服務。請確認 API 正在執行後重試。",
  "error.auth.networkBlocked":
    "該網路中的防火牆或代理阻止了 OpenBot 訪問 {host}。請讓網路管理員放行 {host}，然後重試。",
  "error.auth.signInFirst": "請先登入 OpenBot。",
  "error.auth.signInRequired": "需要先登入。",
  "error.auth.accountChangedDuringRegister": "註冊該伺服器期間，已登入的帳號發生了變更。",
  "error.auth.hostCredentialUnavailable": "遠端主機憑據不可用，請重新註冊該主機。",
  "error.auth.codeNotVerified": "無法驗證登入驗證碼。",
  "error.auth.serviceError": "帳號服務返回了錯誤。",
  "error.auth.serviceUnreachable": "OpenBot 無法連線帳號服務。請檢查網路連線後重試。",
  "error.auth.serviceTimeout": "帳號服務未及時回應，請重試。",
  "error.auth.serviceStatus": "帳號服務返回了錯誤（{status}），請稍後重試。",
  "error.auth.invalidHostedServer": "帳號服務返回了無效的託管伺服器。",
  "error.auth.codeNotSent": "OpenBot 無法傳送登入驗證碼。",
  "error.auth.deliveryTimeout": "OpenBot 未能及時確認送達。驗證碼可能仍會到達，重發前請先檢查送達情況。",
  "error.auth.deliveryInterrupted": "連線在 OpenBot 確認送達之前就結束了。為避免重複傳送，請先檢查送達情況。",
  "error.auth.deliveryUnknown": "OpenBot 無法確認登入驗證碼是否已傳送。重發前請先檢查送達情況。",
} as const satisfies PartialTranslation<typeof source>;
