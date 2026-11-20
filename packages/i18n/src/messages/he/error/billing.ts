import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/billing";

export const messages = {
  "error.billing.lifecycleFailed": "לא ניתן היה לשנות את תוכנית השרת. יש לרענן את החיוב ולנסות שוב.",
  "error.billing.confirmMismatch": "יש להקליד את שם השרת כדי למחוק אותו.",
  "error.billing.restartBusy": "אי אפשר להפעיל את השרת מחדש כעת. יש לנסות שוב בעוד דקה.",
  "error.billing.restartUnavailable": "אי אפשר להפעיל מחדש את השרת הזה מכאן. יש לפנות לתמיכה.",
  "error.billing.planRequired": "התוכנית של השרת הזה הסתיימה. יש לחדש אותה כדי להפעיל את השרת.",
  "error.billing.planSoldOut": "התוכנית הזו אזלה. יש לבחור תוכנית אחרת.",
  "error.billing.storageUnavailable": "האחסון הזה אינו זמין לשרת הזה.",
  "error.billing.storagePaymentFailed": "התשלום עבור האחסון נכשל. יש לעדכן את אמצעי התשלום ולנסות שוב.",
  "error.billing.licenseExists": "לחשבון הזה כבר יש רישיון. יש לשנות את מספר המשתמשים שלו במקום זאת.",
  "error.billing.licenseCurrency": "הרישיון חייב להשתמש במטבע של התוכניות האחרות שלך.",
  "error.billing.planCurrency": "תוכנית חדשה חייבת להשתמש במטבע של התוכניות האחרות שלך.",
  "error.billing.licenseUsersInUse": "ברישיון לא יכולים להיות פחות משתמשים מהאנשים שמשתמשים בו כעת.",
  "error.billing.licensePaymentFailed": "התשלום עבור המשתמשים שנוספו נכשל. יש לעדכן את אמצעי התשלום ולנסות שוב.",
  "error.billing.licenseUnavailable": "רישיונות אינם זמינים כעת.",
  "error.billing.licenseOneUser": "הרישיון הזה מיועד למשתמש אחד. יש לעבור ל-Team כדי להוסיף משתמשים.",
  "error.billing.licensePlanChange": "אי אפשר לשנות את הרישיון הזה לתוכנית הזו. יש לבטל אותו ולרכוש את התוכנית החדשה.",
  "error.billing.noLicense": "לחשבון הזה אין רישיון.",
  "error.billing.countryRequired":
    "יש לציין את מדינת החיוב לפני התשלום. יש לעדכן את OpenBot כדי לעשות זאת, ולנסות שוב.",
  "error.billing.detailsInvalid": "יש לבדוק את המדינה ואת מספר המע״מ. מספר המע״מ חייב להיות של המדינה שנבחרה.",
  "error.billing.vatIdInvalid":
    "מערכת המע״מ של האיחוד האירופי לא מכירה את מספר המע״מ הזה. יש לבדוק את המספר, או להמשיך בלי מספר מע״מ.",
  "error.billing.vatIdUnverified":
    "מערכת המע״מ של האיחוד האירופי לא יכולה לבדוק את מספר המע״מ כרגע. יש לנסות שוב מאוחר יותר, או להמשיך בלי מספר מע״מ.",
  "error.billing.vatUnavailable": "התשלום לא זמין כרגע. יש לנסות שוב מאוחר יותר.",
  "error.billing.invalidRequest": "בקשת החיוב אינה תקינה.",
  "error.billing.invalidResponse": "תשובת החיוב אינה תקינה.",
  "error.billing.notStripePage": "דף החיוב אינו דף של Stripe.",
} as const satisfies PartialTranslation<typeof source>;
