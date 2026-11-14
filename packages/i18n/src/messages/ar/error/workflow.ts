import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/workflow";

export const messages = {
  "error.workflow.missing": "لم يعد سير العمل هذا موجودًا.",
  "error.workflow.versionMissing": "لم يعد هذا الإصدار من سير العمل موجودًا.",
  "error.workflow.annotation": "لا يمكن أن تكون للنصوص والملاحظات والأشكال اتصالات.",
  "error.workflow.port": "لا يمكن للخطوة أن تأخذ هذا النوع من المدخلات.",
  "error.workflow.branch": "الشرط وحده يمكن أن تكون له اتصالات «نعم» و«لا».",
  "error.workflow.conditionBranch": "يجب أن يكون كل اتصال من شرط «نعم» أو «لا».",
  "error.workflow.duplicateEdge": "لهاتين الخطوتين هذا الاتصال بالفعل.",
  "error.workflow.serverTooOld": "لا يدعم هذا الخادم مسارات العمل. حدّث OpenBot على الحاسوب الذي يشغّله.",
  "error.workflow.nodeUnsupported": "لا يستطيع هذا الإصدار من OpenBot تشغيل خطوات الصور والملفات والرسائل بعد.",
  "error.workflow.interrupted": "توقف OpenBot أثناء تشغيل هذه الخطوة. شغّلها مرة أخرى.",
  "error.workflow.agentMissing": "اختر وكيلًا لهذه الخطوة.",
  "error.workflow.handoffFailed": "تعذّر على OpenBot إرسال هذه الخطوة إلى وكيلها.",
  "error.workflow.agentStepEnded": "أُزيلت رسالة الوكيل لهذه الخطوة قبل أن يجيب.",
  "error.workflow.conditionUnclear": "لم يجب النموذج بـ «نعم» أو «لا».",
  "error.workflow.modelFailed": "تعذّر على النموذج الإجابة. شغّل الخطوة مرة أخرى.",
  "error.workflow.modelBusy": "يجري تنفيذ طلب نموذج آخر. شغّل الخطوة مرة أخرى بعد قليل.",
  "error.workflow.mediaFailed": "تعذّر على النموذج إنشاء الصورة أو الفيديو. شغّل الخطوة مرة أخرى.",
  "error.workflow.pictureMissing": "الصورة لم تعد على الخادم. أرسلها مرة أخرى.",
  "error.workflow.pictureType": "استخدم صورة بتنسيق PNG أو JPEG أو WebP.",
  "error.workflow.mediaInputMissing": "صورة من خطوة سابقة غير متاحة. شغّل تلك الخطوة مرة أخرى.",
  "error.workflow.mediaInputNotImage": "تقبل هذه الخطوة الصور فقط، لا مقاطع الفيديو. أزل الاتصال من الفيديو.",
  "error.workflow.stepMissing": "لم تعد هذه الخطوة موجودة.",
  "error.workflow.nodeMissing": "هذه الخطوة ليست في سير العمل.",
  "error.workflow.runMissing": "لم يعد هذا التشغيل موجودًا.",
  "error.workflow.notRetryable": "لا يمكن إعادة تشغيل إلا خطوة أخفقت أو توقفت.",
  "error.workflow.noDecision": "لا تنتظر هذه الخطوة قرارًا.",
  "error.workflow.outputPlaceMissing": "اختر مكان مراسلة لهذا المُخرَج.",
  "error.workflow.outputChannelMissing": "اختر قناة لهذا المُخرَج.",
  "error.workflow.outputChannelFailed": "لم يتمكن OpenBot من نشر النتيجة في القناة. شغّل الخطوة مرة أخرى.",
  "error.workflow.discordNoMessage":
    "يعمل هذا المُخرَج على رسالة Discord التي بدأت التشغيل. ابدأ التشغيل من إشارة في Discord، أو اختر «النشر في القناة».",
  "error.workflow.slackNoMessage":
    "يعمل هذا المُخرَج على رسالة Slack التي بدأت التشغيل. ابدأ التشغيل من إشارة في Slack، أو اختر «النشر في القناة».",
  "error.workflow.telegramNoMessage":
    "يعمل هذا المُخرَج على رسالة Telegram التي بدأت التشغيل. ابدأ التشغيل من إشارة في Telegram، أو اختر «نشر في الدردشة».",
  "error.workflow.outputConnectionOff": "اتصال المراسلة لهذا المُخرَج متوقف أو محذوف. اختر مكانًا مرة أخرى.",
  "error.workflow.outputNotRunning": "اتصال المراسلة لا يعمل الآن. أعد المحاولة عندما يعمل.",
  "error.workflow.outputRefused": "رفض المكان المنشور. تأكد من أن OpenBot يستطيع النشر هناك.",
  "error.workflow.outputUncertain":
    "توقف المنشور في الطريق. قد يكون جزء منه في المكان. تحقق هناك قبل أن تعيد المحاولة.",
  "error.workflow.tooLarge": "سير العمل هذا أكبر من أن يُحفَظ. أزل بعض الرسومات أو النصوص الطويلة، ثم أعد المحاولة.",
  "error.workflow.tooLargeToSend": "سير العمل هذا أكبر من أن يُرسَل إلى حاسوب آخر. افتحه على الحاسوب الذي يشغّل الخادم.",
  "error.workflow.webhookMissing": "هذه الخطوة ليست مشغّل webhook. احفظ سير العمل، ثم أعد المحاولة.",
  "error.workflow.githubActionMissing": "اختر ما يفعله هذا المُخرَج على GitHub.",
  "error.workflow.githubRepositoryMissing": "اختر مستودعًا لهذا المُخرَج.",
  "error.workflow.githubItemMissing":
    "ليس لهذا المُخرَج مشكلة (issue) أو طلب سحب. ابدأ التشغيل من حدث GitHub، أو ضع الرقم في مدخلاته.",
  "error.workflow.githubPullRequestOnly": "يعمل هذا الإجراء على طلبات السحب فقط.",
  "error.workflow.githubTextMissing": "ليس لهذا المُخرَج نص لإرساله. اربط خطوة تكتبه.",
  "error.workflow.githubEventText": "لا يستطيع هذا المُخرَج إرسال الحدث الخام للمشغّل. ضع وكيلًا بين المشغّل وهذا المُخرَج.",
  "error.workflow.githubChoiceMissing": "اختر التسميات أو الشخص لهذا المُخرَج.",
  "error.workflow.githubChoseNothing": "لم يختر النموذج أي تسمية أو شخص من هذا المستودع.",
  "error.workflow.githubNotConnected": "اربط GitHub على الحاسوب الذي يشغّل سير العمل هذا.",
  "error.workflow.githubNoAccess":
    "لا يستطيع تطبيق OpenBot على GitHub رؤية هذا المستودع أو العنصر. افتح GitHub وامنحه الوصول.",
  "error.workflow.githubNoWrite": "لا يستطيع تطبيق OpenBot على GitHub تغيير هذا المستودع. افتح GitHub وامنحه الوصول.",
  "error.workflow.githubLocked": "هذه المحادثة مقفلة على GitHub.",
  "error.workflow.githubRefused": "رفض GitHub التغيير: {detail}",
  "error.workflow.githubUnreachable": "تعذّر على OpenBot الوصول إلى GitHub. شغّل الخطوة مرة أخرى.",
  "error.workflow.githubUncertain":
    "توقف التغيير في الطريق. قد يكون على GitHub. تحقق هناك قبل أن تشغّل الخطوة مرة أخرى.",
  "error.workflow.githubNoEvent": "لا توجد على GitHub مشكلة أو طلب سحب يبدأ عليه هذا المشغّل.",
  "error.workflow.sunraSignIn": "سجّل الدخول إلى Sunra في التطبيقات لاستخدام نماذج Sunra.",
  "error.workflow.sunraNoCredits":
    "لا يحتوي حسابك في Sunra على أرصدة كافية. أضف أرصدة من sunra.ai/pricing، ثم شغّل الخطوة مرة أخرى.",
  "error.workflow.sunraNeedsPlan":
    "يحتاج نموذج Sunra هذا إلى خطة Sunra. اختر خطة من sunra.ai/pricing أو اختر نموذجًا آخر.",
  "error.workflow.sunraTeamInputs":
    "يستخدم Sunra صور الإدخال مع الحساب الشخصي فقط. اختر حسابك الشخصي في Sunra أو أزل اتصالات الصور.",
  "error.workflow.sunraFailed": "تعذّر على Sunra إنشاء الملف: {reason}",
  "error.workflow.sunraTimeout":
    "لم يُنهِ Sunra الملف في الوقت المحدد. راجع مشروع OpenBot على sunra.ai قبل تشغيل الخطوة مرة أخرى.",
} as const satisfies PartialTranslation<typeof source>;
