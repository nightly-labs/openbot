import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/mcp";

export const messages = {
  "error.mcp.redirectByName": "لا يمكن الوصول إلى هذا العنوان بالاسم.",
  "error.mcp.redirectNotSignIn": "هذا العنوان ليس جزءًا من عملية تسجيل دخول.",
  "error.mcp.redirectRefused": "رُفض تسجيل الدخول. ارجع إلى OpenBot وأعد المحاولة.",
  "error.mcp.redirectNoSignIn": "لم يعد تسجيل الدخول هذا نشطًا. ارجع إلى OpenBot وابدأ تسجيل الدخول مرة أخرى.",
  "error.mcp.redirectSignedIn": "تم تسجيل دخول OpenBot. يمكنك إغلاق هذه النافذة.",
  "error.mcp.redirectNotSaved": "لم يكتمل تسجيل الدخول. ارجع إلى OpenBot لمعرفة السبب.",
  "error.mcp.signInFileUnreadable": "تتعذر قراءة ملف تسجيل الدخول إلى MCP.",
  "error.mcp.signInFileTooLarge": "ملف تسجيل الدخول إلى MCP كبير جدًا.",
  "error.mcp.unsupported": "هذا الخادم لا يدعم خوادم MCP.",
  "error.mcp.signInOnHost": "يعمل تسجيل الدخول إلى خادم MCP فقط في OpenBot على حاسوب المضيف.",
  "error.mcp.signInPageOnServer":
    "لا تفتح صفحة تسجيل الدخول هذه إلا على الخادم. اطلب من مالك الخادم أو مسؤوله تسجيل الدخول.",
  "error.mcp.signInPageOnServerSwitch":
    "لا تفتح صفحة تسجيل الدخول هذه إلا على الخادم. انتقل إلى هذا الخادم، ثم اختر تسجيل الدخول مرة أخرى.",
  "error.mcp.signInAppUnsupported": "هذا الخادم لا يدعم تطبيقات تسجيل الدخول. حدّث OpenBot على المضيف.",
  "error.mcp.redirectRelayed": "أرسل OpenBot تسجيل الدخول إلى الخادم. يمكنك إغلاق هذه النافذة.",
  "error.mcp.relayEnded": "انتهى تسجيل الدخول هذا. ابدأه من جديد.",
  "error.mcp.signInLinkNotReady": "صفحة تسجيل الدخول لم تُفتح بعد. حاول مرة أخرى بعد قليل.",
  "error.mcp.relayNoState": "صفحة تسجيل الدخول في الخادم لا تحمي عنوان العودة، لذا لا يفتحها OpenBot على هذا الحاسوب.",
  "error.mcp.relayAddressInvalid":
    "هذا ليس العنوان الذي يظهر في نهاية تسجيل الدخول هذا. انسخ العنوان الكامل من المتصفح.",
} as const satisfies PartialTranslation<typeof source>;
