import { defineMessages } from "../../../message";

export const messages = defineMessages("error.vault", {
  // The Vault of this computer: its encrypted file and the items that the user saves in it.
  "error.vault.unavailable": "این رایانه فضای ذخیره‌سازی امن ندارد؛ بنابراین خزانه نمی‌تواند چیزی ذخیره کند.",
  "error.vault.unreadable": "فایل خزانه خواندنی نیست. برای استفادهٔ دوباره، خزانه را بازنشانی کنید.",
  "error.vault.tooLarge": "خزانه پر است. چند مورد را حذف و دوباره تلاش کنید.",
  "error.vault.itemMissing": "این مورد دیگر در خزانه نیست.",
  "error.vault.valueTooLong": "یکی از مقدارها بیش از حد طولانی است.",
  "error.vault.websiteInvalid": "نشانی HTTPS وب‌سایت را وارد کنید.",
  "error.vault.passwordRequired": "گذرواژه را وارد کنید.",
  "error.vault.cardNumberInvalid": "شمارهٔ کارت معتبری وارد کنید.",
  "error.vault.securityCodeInvalid": "کد امنیتی 3 یا 4 رقمی وارد کنید.",
  "error.vault.expiryInvalid": "ماه و سال انقضای معتبر وارد کنید.",
  "error.vault.contactEmpty": "نام، نشانی، شمارهٔ تلفن یا نشانی ایمیل را وارد کنید.",
  "error.vault.contactMissing": "مخاطب پرداخت دیگر در خزانه نیست.",
  "error.vault.apiKeyRequired": "کلید API را وارد کنید.",
  "error.vault.apiKeyNameInvalid": "نام متغیری با حروف بزرگ A–Z، رقم و _ وارد کنید که با حرف شروع شود؛ برای نمونه، OPENAI_API_KEY.",
  "error.vault.apiKeyNameTaken": "از قبل کلید APIای با این نام متغیر در خزانه وجود دارد.",
  "error.vault.csvInvalid": "این فایل، خروجی گذرواژه‌ها با قالب CSV نیست.",
  "error.vault.csvTooLarge": "فایل CSV بیش از حد بزرگ است.",
});
