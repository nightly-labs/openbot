import { defineMessages } from "../../../message";

export const messages = defineMessages("status.remote", {
  // Status lines of remote desktop setup and remote connection recovery.
  "status.remote.setupMacOnly": "راه‌اندازی مجوزها در macOS در دسترس است.",
  "status.remote.setupInstallHost": "مؤلفهٔ میزبان دسکتاپ از راه دور را نصب کنید و دوباره بررسی کنید.",
  "status.remote.setupUpdateRuntime": "زمان اجرای دسکتاپ از راه دور را به‌روز کنید تا مجوزهای macOS بررسی شوند.",
  "status.remote.setupCheckFailed": "Sunshine نتوانست بررسی مجوزها را کامل کند. نشست میزبان را بررسی و دوباره تلاش کنید.",
  "status.remote.setupServiceFailed": "سرویس دسکتاپ از راه دور شروع نشد. بررسی کنید این کاربر macOS نشست گرافیکی فعالی داشته باشد.",
  "status.remote.connectingSunshine": "در حال اتصال از راه Sunshine…",
  "status.remote.switchingMonitor": "در حال جابه‌جایی نمایشگر اشتراکی…",
  "status.remote.controlConnected": "کنترل از راه دور وصل شد.",
  "status.remote.controlFailed": "کنترل از راه دور ناموفق بود.",
  "status.remote.stagePreferences": "در حال بارگیری تنظیمات محلی گفت‌وگو: {reason}",
  "status.remote.stageConnection": "در حال اتصال به رایانهٔ رومیزی: {reason}",
  "status.remote.stageCompatibility": "در حال بررسی سازگاری رایانهٔ رومیزی: {reason}",
  "status.remote.stageAgents": "در حال بارگیری عامل‌ها: {reason}",
  "status.remote.stageReads": "در حال بارگیری وضعیت خوانده‌شدن: {reason}",
  "status.remote.suspendedDetail": "پیش از اتصال، OpenBot Mobile یا برنامهٔ دسکتاپ را به‌روز کنید.\n{detail}",
  "status.remote.cooldownDetail": "پس از {limit} تلاش، اتصال ناموفق بود. {minutes}:{seconds} دیگر دوباره تلاش می‌شود.\n{detail}",
  "status.remote.cooldown": "پس از {limit} تلاش، اتصال ناموفق بود. {minutes}:{seconds} دیگر دوباره تلاش می‌شود.",
  "status.remote.connectionLostDetail": {
    one: "اتصال قطع شد. {count} ثانیهٔ دیگر دوباره تلاش می‌شود.\n{detail}",
    other: "اتصال قطع شد. {count} ثانیهٔ دیگر دوباره تلاش می‌شود.\n{detail}",
  },
  "status.remote.connectionLost": {
    one: "اتصال قطع شد. {count} ثانیهٔ دیگر دوباره تلاش می‌شود.",
    other: "اتصال قطع شد. {count} ثانیهٔ دیگر دوباره تلاش می‌شود.",
  },
  "status.remote.attemptFailedDetail": {
    one: "تلاش برای اتصال ناموفق بود. {count} ثانیهٔ دیگر دوباره تلاش می‌شود.\n{detail}",
    other: "تلاش برای اتصال ناموفق بود. {count} ثانیهٔ دیگر دوباره تلاش می‌شود.\n{detail}",
  },
  "status.remote.attemptFailed": {
    one: "تلاش برای اتصال ناموفق بود. {count} ثانیهٔ دیگر دوباره تلاش می‌شود.",
    other: "تلاش برای اتصال ناموفق بود. {count} ثانیهٔ دیگر دوباره تلاش می‌شود.",
  },
  "status.remote.reconnectingDetail": {
    one: "در حال اتصال دوباره {attempt}/{count}\n{detail}",
    other: "در حال اتصال دوباره {attempt}/{count}\n{detail}",
  },
  "status.remote.reconnecting": { one: "در حال اتصال دوباره {attempt}/{count}", other: "در حال اتصال دوباره {attempt}/{count}" },
});
