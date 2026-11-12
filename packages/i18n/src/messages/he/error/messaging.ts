import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/messaging";

export const messages = {
  "error.messaging.notConnected": "סביבת העבודה הזו של Slack אינה מחוברת.",
  "error.messaging.unsupported": "המחשב הזה אינו יכול להתחבר ל-Slack.",
  "error.messaging.relayUnavailable":
    "OpenBot אינו יכול לקבל אירועי Slack במחשב הזה. יש להתחבר, לתת שם למחשב הזה ולנסות שוב.",
  "error.messaging.discordNotConnected": "שרת ה-Discord הזה אינו מחובר.",
  "error.messaging.discordUnsupported": "המחשב הזה אינו יכול להתחבר ל-Discord.",
  "error.messaging.discordRelayUnavailable":
    "OpenBot אינו יכול לקבל אירועי Discord במחשב הזה. יש להתחבר, לתת שם למחשב הזה ולנסות שוב.",
  "error.messaging.discordRolesUnsupported":
    "OpenBot עדיין אינו יכול להציג את התפקידים ב-Discord. אפשר לנסות שוב מאוחר יותר.",
  "error.messaging.telegramNotConnected": "הצ'אט הזה ב-Telegram אינו מחובר.",
  "error.messaging.telegramUnsupported": "המחשב הזה אינו יכול להתחבר ל-Telegram.",
  "error.messaging.telegramRelayUnavailable":
    "OpenBot אינו יכול להגיע ל-Telegram מהמחשב הזה. יש להתחבר, לתת שם למחשב הזה ולנסות שוב.",
  "error.messaging.telegramServiceUnavailable": "OpenBot אינו יכול לחבר את Telegram כרגע. אפשר לנסות שוב מאוחר יותר.",
  "error.messaging.whatsappNotConnected": "מספר ה-WhatsApp הזה אינו מחובר.",
  "error.messaging.whatsappUnsupported": "המחשב הזה אינו יכול להתחבר ל-WhatsApp.",
  "error.messaging.whatsappTooManySenders": "מספר WhatsApp יכול לאשר עד 200 אנשי קשר וקבוצות.",
  "error.messaging.whatsappRequestEnded": "הבקשה הזו הסתיימה. יש לבקש מהאדם לכתוב שוב כדי לקבל קוד חדש.",
  "error.messaging.memoryLimit": "לסביבת עבודה מחוברת יכולים להיות עד {limit} זיכרונות. יש למחוק אחד קודם.",
} as const satisfies PartialTranslation<typeof source>;
