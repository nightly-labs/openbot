import { defineMessages } from "../../../message";

export const messages = defineMessages("status.host", {
  // Status lines of the WebRTC host.
  "status.host.registered": "این OpenBot برای دسترسی WebRTC ثبت شد.",
  "status.host.keyRotated": "کلید سرور تغییر کرد. دستگاه‌های جفت‌شده همچنان جفت‌شده می‌مانند.",
  "status.host.identityUpdated": "هویت سرور به‌روزرسانی شد.",
  "status.host.starting": "در حال راه‌اندازی میزبان WebRTC…",
  "status.host.ready": "این OpenBot برای اتصال‌های WebRTC آماده است.",
  "status.host.stopping": "در حال خصوصی‌کردن این OpenBot…",
  "status.host.private": "این OpenBot خصوصی است.",
});
