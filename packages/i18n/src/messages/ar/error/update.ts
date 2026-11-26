import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/update";

export const messages = {
  "error.update.unsupported": "التحديثات متاحة في إصدارات سطح المكتب المثبّتة.",
  "error.update.notReady": "لا يوجد تحديث جاهز للتثبيت.",
  "error.update.restartFailed": "تعذّر على OpenBot إعادة التشغيل لتثبيت التحديث.",
  "error.update.downloadStalled": "توقف تنزيل التحديث عن الاستجابة. حاول مرة أخرى.",
  "error.update.installFailed": "تعذّر تثبيت التحديث. أغلق OpenBot وأعد فتحه، ثم حاول مرة أخرى.",
  "error.update.notInstalled": "لم تُثبِّت إعادة التشغيل الأخيرة التحديث. أعد التشغيل للمحاولة مرة أخرى.",
  "error.update.needsAdministrator":
    "لم يتمكن OpenBot من تثبيت التحديث بنفسه، لأن macOS يطلب كلمة مرور المسؤول لاستبدال OpenBot. انقر على «إعادة التشغيل» على هذا الكمبيوتر، ثم أدخل كلمة المرور.",
  "error.update.downloadFailed": "تعذّر تنزيل التحديث. حاول مرة أخرى.",
  "error.update.signatureNotConfirmed":
    "تعذّر على OpenBot التحقق من التحديث. حاول مرة أخرى. إذا استمر هذا الخطأ، نزّل OpenBot من openbot.run/download.",
  "error.update.checkFailed": "تعذّر التحقق من وجود تحديثات. حاول مرة أخرى.",
  "error.update.checkStalled": "توقف التحقق من التحديثات عن الاستجابة. حاول مرة أخرى.",
  "error.update.checkOffline": "تعذّر الوصول إلى خدمة التحديث. تحقق من اتصالك بالإنترنت، ثم حاول مرة أخرى.",
  "error.update.checkUnavailable": "لم تستجب خدمة التحديث. سيحاول OpenBot مرة أخرى تلقائيًا خلال بضع دقائق.",
  "error.update.checkNoRelease": "لم يُعثر على تحديث منشور لهذه المنصة. سيحاول OpenBot مرة أخرى تلقائيًا خلال بضع دقائق.",
  "error.update.managedByNix": "يثبّت Nix التحديثات لهذه النسخة من OpenBot. حدّثها باستخدام Nix.",
  "error.update.managedByHost": "يثبّت المضيف التحديثات على جهاز Mac هذا. يبقى التحديث جاهزًا حتى تُجرى صيانة المضيف.",
  "error.update.siblingSession":
    "لا تزال جلسة OpenBot أخرى تعمل من هذا التطبيق. أوقف OpenBot في كل حسابات مستخدمي macOS الأخرى أولًا، ثم ثبّت التحديث مرة أخرى.",
  "error.update.siblingSessionSameAccount":
    "لا تزال عملية OpenBot أخرى تعمل في حساب المستخدم هذا. أغلقها، ثم ثبّت التحديث مرة أخرى.",
  "error.update.siblingCheckFailed": "تعذّر التحقق من جلسات OpenBot الأخرى. حاول مرة أخرى قبل التثبيت.",
  "error.update.readOnlyLocation":
    "لا يمكن لـ OpenBot تثبيت التحديثات من هذا الموقع. أغلق OpenBot. في Finder، اسحب OpenBot إلى مجلد التطبيقات (إذا كان موجودًا هناك بالفعل، فاسحبه خارجه ثم أعده إليه). ثم افتح OpenBot وثبّت التحديث مرة أخرى.",
  "error.update.appImageMissing":
    "لا يستطيع OpenBot تثبيت التحديث لأن ملف AppImage الخاص به نُقل أو أُعيدت تسميته أو استُبدل. أغلق OpenBot، ثم افتح ملف AppImage مرة أخرى.",
  "error.update.appImageReadOnly":
    "لا يستطيع OpenBot تثبيت التحديثات في مجلد ملف AppImage الخاص به. أغلق OpenBot، وانقل ملف AppImage إلى مجلد داخل مجلدك الرئيسي، ثم افتحه وثبّت التحديث مرة أخرى.",
  "error.update.remoteDisabled": "التحديثات من مسؤولي الخوادم معطّلة على هذا الحاسوب.",
  "error.update.restartStarted": "يعيد OpenBot التشغيل بالفعل لتثبيت التحديث.",
  "error.update.alreadyRestarting": "يعيد OpenBot التشغيل بالفعل.",
} as const satisfies PartialTranslation<typeof source>;
