import { defineMessages } from "../../../message";

export const messages = defineMessages("error.attachment", {
  // Attachment and file preview errors.
  "error.attachment.notFound": "پیوست پیدا نشد.",
  "error.attachment.fileTooLarge": "حجم فایل از محدودیت 100 MB بیشتر است.",
  "error.attachment.totalTooLarge": "مجموع حجم پیوست‌ها از محدودیت 250 MB بیشتر است.",
  "error.attachment.unavailable": "این فایل دیگر در دسترس نیست.",
  "error.attachment.tooMany": "حداکثر {limit} فایل انتخاب کنید.",
  "error.attachment.mediaUnsupported": "این سرور از پیوست‌های MP3 یا MOV پشتیبانی نمی‌کند. OpenBot را در میزبان به‌روز کنید و دوباره تلاش کنید.",
  "error.attachment.emlUnsupported": "این سرور از پیوست‌های EML پشتیبانی نمی‌کند. OpenBot را در میزبان به‌روز کنید و دوباره تلاش کنید.",
  "error.attachment.zipUnsupported": "این سرور از پیوست‌های ZIP پشتیبانی نمی‌کند. OpenBot را در میزبان به‌روز کنید و دوباره تلاش کنید.",
  "error.attachment.mp4Unsupported": "این سرور از پیوست‌های MP4 پشتیبانی نمی‌کند. OpenBot را در میزبان به‌روز کنید و دوباره تلاش کنید.",
  "error.attachment.svgUnsupported": "این سرور از پیوست‌های SVG پشتیبانی نمی‌کند. OpenBot را در میزبان به‌روز کنید و دوباره تلاش کنید.",
  "error.attachment.previewTooLarge": "حجم فایل از محدودیت 100 MB بیشتر است.",
});
