import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/billing";

export const messages = {
  "error.billing.lifecycleFailed": "无法更改服务器套餐，请刷新账单后重试。",
  "error.billing.confirmMismatch": "请输入服务器名称以确认删除。",
  "error.billing.restartBusy": "服务器当前无法重启，请一分钟后再试。",
  "error.billing.planRequired": "该服务器的套餐已结束，请续费后启动服务器。",
  // Billing errors that the desktop and web clients make.
  "error.billing.invalidRequest": "账单请求无效。",
  "error.billing.invalidResponse": "账单响应无效。",
  "error.billing.notStripePage": "该账单页面不是 Stripe 页面。",
} as const satisfies PartialTranslation<typeof source>;
