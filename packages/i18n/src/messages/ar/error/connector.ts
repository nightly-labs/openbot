import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/connector";

export const messages = {
  "error.connector.githubUnavailable": "لا يتضمن إصدار OpenBot هذا GitHub App.",
  "error.connector.githubDenied": "تم رفض تسجيل الدخول إلى GitHub.",
  "error.connector.githubCodeExpired": "انتهت صلاحية رمز GitHub. اتصل بـ GitHub مرة أخرى.",
  "error.connector.githubDeviceFlowDisabled": "لا يسمح GitHub App بتسجيل الدخول عبر الجهاز.",
  "error.connector.githubClientUnknown": "لا يعرف GitHub معرّف Client ID لهذا GitHub App.",
  "error.connector.githubUnexpected": "أرسل GitHub إجابة غير متوقعة: {detail}",
  "error.connector.githubUnreachable": "لا يمكن لـ OpenBot الوصول إلى GitHub: {detail}",
  "error.connector.githubExpired": "انتهت صلاحية الاتصال بـ GitHub. اتصل بـ GitHub مرة أخرى.",
  "error.connector.githubFileUnreadable": "ملف اتصال GitHub غير قابل للقراءة.",
  "error.connector.githubFileTooLarge": "ملف اتصال GitHub كبير جدًا.",
  "error.connector.linkDenied": "تم رفض تسجيل الدخول إلى Link.",
  "error.connector.linkCodeExpired": "انتهت صلاحية تسجيل الدخول إلى Link. اتصل بـ Link مرة أخرى.",
  "error.connector.linkUnexpected": "أرسل Link إجابة غير متوقعة: {detail}",
  "error.connector.linkUnreachable": "لا يمكن لـ OpenBot الوصول إلى Link: {detail}",
  "error.connector.linkExpired": "انتهت صلاحية الاتصال بـ Link. اتصل بـ Link مرة أخرى.",
  "error.connector.linkNotConnected": "Link غير متصل. اربطه في إعدادات الخادم > الخزنة > البطاقات.",
  "error.connector.linkNoCard": "لا يحتوي حساب Link على بطاقة. أضف بطاقة في Link.",
  "error.connector.linkFileUnreadable": "ملف اتصال Link غير قابل للقراءة.",
  "error.connector.linkFileTooLarge": "ملف اتصال Link كبير جدًا.",
  "error.connector.onePasswordCliMissing":
    "لا يمكن لـ OpenBot العثور على 1Password CLI. ثبّته وفعّل تكامله في تطبيق 1Password، أو استخدم رمز حساب خدمة.",
  "error.connector.onePasswordCliInstallFailed":
    "تعذّر على OpenBot تثبيت 1Password CLI. تحقق من الاتصال بالإنترنت، ثم حاول مرة أخرى.",
  "error.connector.onePasswordCliSignedOut":
    "لم يتم تسجيل الدخول إلى 1Password CLI. فعّل تكامله في تطبيق 1Password، ثم اتصل مرة أخرى.",
  "error.connector.onePasswordCliFailed": "فشل 1Password CLI: {detail}",
  "error.connector.onePasswordUnexpected": "أرسل 1Password إجابة غير متوقعة: {detail}",
  "error.connector.onePasswordTokenRejected": "لم يقبل 1Password رمز حساب الخدمة.",
  "error.connector.onePasswordNoVault": "لا يمكن لحساب الخدمة قراءة أي خزنة. امنحه الوصول إلى خزنة، ثم حاول مرة أخرى.",
  "error.connector.onePasswordFileUnreadable": "ملف اتصال 1Password غير قابل للقراءة.",
  "error.connector.onePasswordFileTooLarge": "ملف اتصال 1Password كبير جدًا.",
  "error.connector.bitwardenFailed":
    "تعذّرت قراءة Bitwarden. ثبّت bw CLI، وسجّل الدخول، وافتح قفله، وأنشئ مجلدًا واحدًا باسم Shared with OpenBot. اتصل بمفتاح جلسة جديد.",
  "error.connector.bitwardenHostInput":
    "أدخل عنوان خادم HTTPS، وclient_id وclient_secret لمفتاح API، وكلمة المرور الرئيسية.",
  "error.connector.bitwardenHostFailed":
    "تعذّر فتح Bitwarden على هذا الخادم. تحقق من عنوان الخادم ومفتاح API وكلمة المرور الرئيسية، وتأكد من وجود مجلد واحد باسم Shared with OpenBot. ثم اتصل مرة أخرى.",
  "error.connector.bitwardenCliInstallFailed":
    "تعذّر تثبيت Bitwarden CLI على هذا الخادم. تحقق من اتصاله بالشبكة، ثم اتصل مرة أخرى.",
  "error.connector.bitwardenFileUnreadable": "ملف اتصال Bitwarden غير قابل للقراءة.",
} as const satisfies PartialTranslation<typeof source>;
