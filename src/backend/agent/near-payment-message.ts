import type { ConversationNearPayment } from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";

export function nearPaymentText(payment: ConversationNearPayment): string {
  const values = { amount: `${payment.amount} ${payment.symbol}`, domain: payment.domain, reason: payment.reason };
  if (payment.state === "sending") return sourceText("status.agent.nearPaymentSending", values);
  if (payment.state === "paid") return sourceText("status.agent.nearPaymentPaid", values);
  if (payment.state === "uncertain") return sourceText("status.agent.nearPaymentUncertain", values);
  return sourceText("status.agent.nearPaymentNotPaid", values);
}
