import { defineMessages } from "../../../message";

export const messages = defineMessages("error.billing", {
  "error.billing.lifecycleFailed": "طرح سرور تغییر نکرد. صفحهٔ Billing را تازه‌سازی و دوباره تلاش کنید.",
  "error.billing.confirmMismatch": "برای حذف سرور، نام آن را بنویسید.",
  "error.billing.restartBusy": "اکنون نمی‌توان سرور را راه‌اندازی دوباره کرد. یک دقیقهٔ دیگر تلاش کنید.",
  "error.billing.planRequired": "طرح این سرور پایان یافته است. برای راه‌اندازی سرور آن را تمدید کنید.",
  "error.billing.planSoldOut": "این طرح تمام شده است. طرح دیگری انتخاب کنید.",
  // License errors.
  "error.billing.licenseExists": "این حساب از قبل مجوز دارد. به‌جای آن تعداد کاربران را تغییر دهید.",
  "error.billing.licenseCurrency": "واحد پول مجوز باید با واحد پول طرح‌های دیگر شما یکی باشد.",
  "error.billing.planCurrency": "واحد پول طرح تازه باید با واحد پول طرح‌های دیگر شما یکی باشد.",
  "error.billing.licenseUsersInUse": "تعداد کاربران مجوز نمی‌تواند از تعداد افرادی که اکنون از آن استفاده می‌کنند کمتر باشد.",
  "error.billing.licensePaymentFailed": "پرداخت هزینهٔ کاربران افزوده‌شده ناموفق بود. روش پرداخت را به‌روز و دوباره تلاش کنید.",
  "error.billing.licenseUnavailable": "مجوزها اکنون در دسترس نیستند.",
  "error.billing.licenseOneUser": "این مجوز برای 1 کاربر است. برای افزودن کاربر، آن را به Team تغییر دهید.",
  "error.billing.licensePlanChange": "این مجوز را نمی‌توان به آن طرح تغییر داد. آن را لغو کنید و طرح تازه را بخرید.",
  "error.billing.noLicense": "این حساب مجوزی ندارد.",
  // Billing errors that the desktop and web clients make.
  "error.billing.invalidRequest": "درخواست Billing معتبر نیست.",
  "error.billing.invalidResponse": "پاسخ Billing معتبر نیست.",
  "error.billing.notStripePage": "صفحهٔ Billing، صفحهٔ Stripe نیست.",
});
