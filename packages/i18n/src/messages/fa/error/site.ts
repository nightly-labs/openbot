import { defineMessages } from "../../../message";

export const messages = defineMessages("error.site", {
  // Hosted site errors.
  "error.site.absolutePath": "مسیر مطلق پوشهٔ سایت را انتخاب کنید.",
  "error.site.rootSymlink": "در سایت‌های میزبانی‌شده، پیوند نمادین مجاز نیست.",
  "error.site.notDirectory": "منبع سایت باید یک پوشه باشد.",
  "error.site.outsideWorkspace": "سایت باید در فضای کاری همین عامل یا OpenBot Shared باشد.",
  "error.site.packageJsonInvalid": "فایل package.json سایت معتبر نیست.",
  "error.site.astroServerOutput": "Astro باید خروجی ایستا داشته باشد.",
  "error.site.astroAdapter": "آداپتورهای سرور Astro و یکپارچه‌سازی React مجاز نیستند.",
  "error.site.astroApiRoutes": "مسیرهای API و کنش‌های سرور Astro مجاز نیستند.",
  "error.site.astroMiddleware": "میان‌افزار و کد منبع سرور Astro مجاز نیست.",
  "error.site.astroNotBuilt": "ابتدا پروژهٔ Astro را بسازید. پوشهٔ موجود dist/ لازم است.",
  "error.site.astroDistNotDirectory": "dist/ در Astro باید یک پوشهٔ واقعی باشد.",
  "error.site.astroDistOutside": "dist/ در Astro باید داخل پوشهٔ پروژه بماند.",
  "error.site.directoryOutsideRoot": "پوشه‌های سایت باید داخل ریشهٔ منبع بمانند.",
  "error.site.siteTooLarge": "حجم سایت از محدودیت 2 MB بیشتر است.",
  "error.site.missingIndex": "پوشهٔ اصلی سایت باید فایل index.html داشته باشد.",
  "error.site.symlink": "پیوند نمادین مجاز نیست: {name}",
  "error.site.unsupportedEntry": "مورد پشتیبانی‌نشده در سایت: {name}",
  "error.site.tooManyFiles": "سایت می‌تواند حداکثر {limit} فایل داشته باشد.",
  "error.site.hiddenFile": "فایل پنهان مجاز نیست: {path}",
  "error.site.unsafePath": "این مسیر فایل مجاز نیست: {path}",
  "error.site.secretFile": "اعتبارنامه، کلید خصوصی و کد منبع سرور مجاز نیست: {path}",
  "error.site.fileType": "این نوع فایل مجاز نیست: {path}",
  "error.site.fileOutsideRoot": "فایل‌های سایت باید داخل ریشهٔ منبع بمانند: {path}",
  "error.site.fileTooLarge": "حجم فایل از محدودیت 1 MB بیشتر است: {path}",
  "error.site.serverLimit": {
    one: "این سرور به سقف {count} سایت فعال رسیده است. برای انتشار سایت دیگری، سایتی را حذف کنید یا از سرور ابری با طرحی که سایت‌های بیشتری دارد استفاده کنید.",
    other: "این سرور به سقف {count} سایت فعال رسیده است. برای انتشار سایت دیگری، سایتی را حذف کنید یا از سرور ابری با طرحی که سایت‌های بیشتری دارد استفاده کنید.",
  },
  // Shown when the servers with no plan use all the sites of their shared pool.
  "error.site.sharedLimit": "سرورهای حساب شما که طرح ندارند، سایت‌های فعال مشترکی دارند و همهٔ آن‌ها در حال استفاده‌اند. برای انتشار سایت در اینجا، سایتی را از یکی از این سرورها حذف کنید، کاربرانی به مجوز خود بیفزایید یا از سرور ابری با طرحی که سایت‌های بیشتری دارد استفاده کنید.",
  "error.site.accountLimit": "حساب شما به بیشترین تعداد سایت فعال در همهٔ سرورها رسیده است: {count}. برای انتشار سایت دیگری، سایتی را حذف کنید.",
  "error.site.unlinkedLimit": {
    one: "این رایانه سرور نیست و حساب آن به سقف {count} سایت فعال رسیده است. برای انتشار سایت دیگری، سایتی را حذف کنید یا از سرور ابری با طرحی که سایت‌های بیشتری دارد استفاده کنید.",
    other: "این رایانه سرور نیست و حساب آن به سقف {count} سایت فعال رسیده است. برای انتشار سایت دیگری، سایتی را حذف کنید یا از سرور ابری با طرحی که سایت‌های بیشتری دارد استفاده کنید.",
  },
});
