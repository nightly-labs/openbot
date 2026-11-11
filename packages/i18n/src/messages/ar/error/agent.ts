import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/agent";

export const messages = {
  "error.agent.historyUnavailable":
    "السجل غير متاح لهذا الطلب. اقرأ السجل الحديث مرة أخرى، أو استخدم channel_history لعمل القنوات.",
  "error.agent.historyArgumentsInvalid":
    "وسائط السجل غير صحيحة: {detail} صحّح الوسائط وحاول مرة أخرى. يعطي openbot.tool_describe المخطط.",
  "error.agent.toolRequestInvalid": "وسائط اكتشاف الأدوات غير صالحة. استخدم المخطط المُعلَن واسم الأداة المؤهَّل الأصلي.",
  "error.agent.toolCallArgumentsNotObject":
    "لم تعمل الأداة. في tool_call يجب أن تكون arguments كائن JSON وليست نصًا. أرسل الاستدعاء مرة أخرى مع arguments ككائن.",
  "error.agent.toolCallDiscoveryTool":
    "لم تعمل الأداة. لا يمكن لـ tool_call تشغيل openbot.tool_search أو openbot.tool_describe. استدعهما مباشرةً بالوسائط نفسها.",
  "error.agent.routineScheduleArgumentsInvalid":
    "جدول المهمة الدورية غير صالح: {detail} صحّح الجدول وحاول مرة أخرى. يعطي openbot.tool_describe المخطط.",
  "error.agent.approvalWhileDeleting": "لا يمكن منح الموافقة أثناء حذف الوكيل.",
  "error.agent.accessLocalOnly": "لا يمكن تغيير وصول الوكيل إلا على الحاسوب الذي يشغّل الوكيل.",
  "error.agent.duplicateCleanupFailed": "فشل تكرار الوكيل وتعذّرت إزالة النسخة غير المكتملة.",
  "error.agent.commitEffectsFailed": "تم تنفيذ المعاملة، لكن آثارها المحفوظة فشلت.",
  "error.agent.settingsLocalOnly": "لا يمكن تغيير إعدادات الوكيل إلا على الحاسوب الذي يشغّل الوكيل.",
  "error.agent.skillsLocalOnly": "لا يمكن تغيير المهارات إلا على الحاسوب الذي يشغّل الوكيل.",
  "error.agent.addLocalOnly": "لا يمكن إضافة الوكلاء إلا على الحاسوب الذي يشغّلهم.",
  "error.agent.joinedServerUpdate": "لا يمكن تحديث وكيل على خادم منضم إليه من هنا.",
  "error.agent.searchQueryRequired": "عبارة البحث مطلوبة.",
  "error.agent.messageTooLong": "الرسالة طويلة جدًا.",
  "error.agent.messageOrAttachmentRequired": "رسالة أو مرفق مطلوب.",
  "error.agent.promptAnswersTooLong": "الإجابات على المطالبة طويلة جدًا.",
  "error.agent.gone": "لم يعد هذا الوكيل موجودًا.",
  "error.agent.instructionsTooLarge": "ملف التعليمات أكبر من أن يُفتح هنا. اختصره في محرر نصوص.",
  "error.agent.instructionsOutside": "يرتبط ملف التعليمات بمكان خارج مساحة العمل للوكيل، لذا لا يفتحه OpenBot.",
  "error.agent.instructionsReadFailed": "تعذّرت قراءة ملف التعليمات.",
  "error.agent.instructionsSaveFailed": "تعذّر حفظ ملف التعليمات.",
  "error.agent.profileGenerationBusy": "إنشاء الملف التعريفي مشغول. أعد المحاولة بعد قليل.",
  "error.agent.instructionsChanged": "غيّر الوكيل ملف التعليمات. لم يُحفظ تغييرك الأخير. أجرِه مرة أخرى.",
  "error.agent.initialMessageRequired": "الرسالة الأولى مطلوبة.",
  "error.agent.initialMessageTooLong": "الرسالة الأولى طويلة جدًا.",
  "error.agent.setupCleanupFailed": "فشل إعداد الوكيل وتعذّرت إزالة الوكيل غير المكتمل.",
  "error.agent.modelUnavailable": "نموذج الوكيل المحدد غير متاح.",
  "error.agent.modelProviderNotConnected": "نموذج الوكيل المحدد «{model}» غير متاح: {provider} غير متصل.",
  "error.agent.modelListEmpty":
    "نموذج الوكيل المحدد «{model}» غير متاح: لم يُدرج {provider} أي نماذج. آخر خطأ: {detail}",
  "error.agent.modelListEmptyNoError": "نموذج الوكيل المحدد «{model}» غير متاح: لم يُدرج {provider} أي نماذج.",
  "error.agent.modelNotInProviderList": "نموذج الوكيل المحدد «{model}» غير متاح: لا يُدرجه {provider}.",
  "error.agent.modelVariantNotListed":
    "نموذج الوكيل المحدد «{model}» غير متاح: لا يُدرجه {provider}. استخدم إحدى هذه القيم التي يُدرجها {provider} لهذا النموذج: {models}.",
  "error.agent.modelProviderMismatch": "النموذج المحدد لا ينتمي إلى هذا المزوّد.",
  "error.agent.modelNotListed": "النموذج «{model}» غير متاح. النماذج المتاحة: {models}.",
  "error.agent.providerNotListed": "لا يتوفر أي نموذج من {provider} الآن. استدعِ list_models لعرض النماذج المتاحة.",
  "error.agent.reasoningEffortUnsupported":
    "النموذج «{model}» لا يدعم مستوى الاستدلال «{effort}». المستويات المدعومة: {efforts}.",
  "error.agent.reasoningEffortNotConfigurable":
    "النموذج «{model}» ليس له إعداد لمستوى الاستدلال، لذلك لا يمكنك تغيير مستواه.",
  "error.agent.noStartingModelInSettings":
    "لا يتوفر نموذج لدى {provider}، ولا لدى أي مزوّد آخر مسجّل الدخول. سجّل الدخول إلى مزوّد، أو غيّر المزوّد الافتراضي في إعدادات الخادم ← المزوّدون.",
  "error.agent.noStartingModel":
    "لا يتوفر نموذج لدى {provider}، ولا لدى أي مزوّد آخر مسجّل الدخول. سجّل الدخول إلى مزوّد، أو غيّر المزوّد الافتراضي في المزوّدون والأذونات.",
  "error.agent.waitBeforeProviderChange": "انتظر انتهاء الدور النشط وقائمة الانتظار قبل تغيير المزوّد.",
  "error.agent.waitForTasksBeforeProviderChange": "تعمل مهام لهذا الوكيل. انتظر انتهاءها، أو أوقفها، قبل تغيير المزوّد.",
  "error.agent.waitBeforeClearContext": "انتظر انتهاء الدور النشط وقائمة الانتظار قبل بدء دردشة جديدة.",
  "error.agent.waitBeforeCompactContext": "انتظر انتهاء الدور النشط وقائمة الانتظار قبل ضغط السياق.",
  "error.agent.waitBeforeDeleteHistory": "انتظر انتهاء الدور النشط وقائمة الانتظار قبل حذف السجل.",
  "error.agent.compactContextUnavailable": "لا يستطيع هذا الوكيل ضغط سياقه الآن.",
  "error.agent.unknown": "وكيل غير معروف: {id}",
  "error.agent.onlyUserWidensSettings":
    "المستخدم وحده يمكنه منح الوكيل الوصول الكامل أو تشغيل التحكم في الحاسوب. اطلب من المستخدم تغيير ذلك في إعدادات الوكيل.",
  "error.agent.queuedMessageCreateFailed": "تعذّر إنشاء رسالة في قائمة الانتظار.",
  "error.agent.messageUnavailable": "لم تعد الرسالة متاحة.",
  "error.agent.hostLimit": "يمكن أن يكون للمضيف {limit} وكيل كحد أقصى.",
  "error.agent.changedWhileDuplicating": "تغيّر الوكيل أثناء تكراره. أعد المحاولة.",
  "error.agent.duplicatedAgentGone": "لم يعد الوكيل المكرَّر موجودًا.",
  "error.agent.stateCorrupt": "حالة الوكيل تالفة أو من نسخة أحدث من OpenBot؛ لن تتم الكتابة فوقها.",
  "error.agent.oldRoleField":
    "تستخدم الملفات التعريفية المخزّنة للوكلاء حقل الدور القديم؛ حدّث البيانات قبل تشغيل OpenBot.",
  "error.agent.duplicateIds": "تحتوي حالة الوكلاء على معرّفات وكلاء مكررة؛ لن تتم الكتابة فوقها.",
  "error.agent.copyNameFailed": "تعذّر على OpenBot إنشاء اسم فريد لنسخة الوكيل.",
  "error.agent.endpointRemoved": "أُزيلت نقطة النهاية التي استخدمها هذا الوكيل. اختر نموذجًا آخر له.",
  "error.agent.turnStalled":
    "توقّف {provider} عن الاستجابة، لذا أنهى OpenBot هذا الدور. أرسل الرسالة مرة أخرى، أو اختر نموذجًا آخر.",
  "error.agent.compactionConnectionLost":
    "توقف الاتصال أثناء ضغط الوكيل لسياقه، لذلك توقفت المهمة. تحقق من اتصالك بالإنترنت، ثم أرسل رسالة للمتابعة.",
  "error.agent.selectedGone": "لم يعد الوكيل المحدد موجودًا.",
  "error.agent.profileEndpointsChanged": "تغيّرت نقاط النهاية المخصصة أثناء الإنشاء. أعد المحاولة.",
  "error.agent.profileInvalid": "أعاد المزوّد ملفًا تعريفيًا غير صالح. جرّب تعديل المطالبة.",
  "error.agent.profileSectionUnavailable": "القسم المُنشأ غير متاح. أعد المحاولة أو اختر قسمًا يدويًا.",
  "error.agent.profileTimedOut": "انتهت مهلة إنشاء الملف التعريفي. أعد المحاولة.",
  "error.agent.profileDisconnected": "انقطع اتصال المزوّد أثناء إنشاء الملف التعريفي.",
  "error.agent.profileToolUse": "حاول المزوّد استخدام أداة. جرّب تعديل المطالبة.",
  "error.agent.profileFailed": "تعذّر على المزوّد إنشاء ملف تعريفي. أعد المحاولة.",
  "error.agent.profileTooLarge": "الملف التعريفي المُنشأ كبير جدًا. جرّب مطالبة أقصر.",
  "error.agent.profileNotStarted": "تعذّر على المزوّد بدء إنشاء الملف التعريفي.",
  "error.agent.deletionBusy": "حذف الوكيل قيد التنفيذ بالفعل.",
  "error.agent.stopBeforeDelete": "أوقف الوكيل وألغِ رسائله في قائمة الانتظار قبل حذفه.",
  "error.agent.deleteIncomplete": "تعذّرت إزالة بيانات الوكيل بالكامل. أعد محاولة حذف الوكيل.",
  "error.agent.duplicationBusy": "يجري تكرار هذا الوكيل بالفعل.",
  "error.agent.waitBeforeDuplicate": "انتظر انتهاء الوكيل وإفراغ قائمة انتظاره قبل تكراره.",
  "error.agent.saveOtherAgent": "عملية الحفظ هذه تخص وكيلًا آخر.",
  "error.agent.savedGone": "لم يعد الوكيل المحفوظ موجودًا.",
  "error.agent.storedProfileUnreadable":
    "يحتوي ملف تعريفي مخزّن لوكيل على قيمة «{field}» غير مقروءة؛ حدّث البيانات قبل تشغيل OpenBot.",
  "error.agent.storedProfileUnreadableId":
    "يحتوي الملف التعريفي المخزّن للوكيل {id} على قيمة «{field}» غير مقروءة؛ حدّث البيانات قبل تشغيل OpenBot.",
  "error.agent.queueEditRejected": "رُفض تعديل قائمة الانتظار: {reason}",
  "error.agent.computerUseLocalOnly": "لا يمكن تغيير التحكم في الحاسوب إلا على الحاسوب الذي يشغّل الوكيل.",
  "error.agent.automationLocalOnly": "لا يمكن السماح بالسكربتات المحلية إلا على الحاسوب الذي يشغّل الوكيل.",
  "error.agent.newChatLocalOnly": "الحاسوب الذي يشغّل الوكيل وحده يمكنه السماح له ببدء دردشات جديدة.",
  "error.agent.quickAcknowledgementLocalOnly": "الحاسوب الذي يشغّل الوكيل وحده يمكنه تغيير هذا الإعداد.",
  "error.agent.sideQuestionBusy": "تعمل أسئلة جانبية كثيرة جدًا. أعد المحاولة بعد قليل.",
  "error.agent.sideQuestionFailed": "تعذّر على الوكيل الإجابة عن السؤال الجانبي. أعد المحاولة.",
  "error.agent.webSearchSignIn": "يحتاج البحث في الويب إلى تسجيل الدخول إلى Codex بحساب ChatGPT.",
  "error.agent.webSearchBusy": "تعمل عمليات بحث وأسئلة جانبية كثيرة جدًا. حاول مرة أخرى بعد قليل.",
  "error.agent.webSearchFailed": "لم يكتمل البحث في الويب. حاول مرة أخرى.",
  "error.agent.busyMessageModeLocalOnly":
    "لا يمكن تحديد ما تفعله الرسائل أثناء عمل الوكيل إلا على الحاسوب الذي يشغّل الوكيل.",
  "error.agent.backupModelsLocalOnly": "لا يمكن تعيين النماذج الاحتياطية إلا على الحاسوب الذي يشغّل الوكيل.",
  "error.agent.taskLimitLocalOnly": "لا يمكن تعيين حد المهام إلا على الحاسوب الذي يشغّل الوكيل.",
  "error.agent.localScriptsOff": "لا يسمح هذا الوكيل بالسكربتات المحلية.",
  "error.agent.localScriptsRateLimited":
    "أرسلت السكربتات المحلية إلى هذا الوكيل {limit} طلب رسالة أو مهمة دورية في الساعة الأخيرة. أعد المحاولة لاحقًا.",
  "error.agent.automationOff": "لا يسمح هذا الوكيل للسكربتات المحلية بتشغيل مهامه الدورية.",
  "error.agent.automationPayloadTooLong": "الحمولة أطول من {limit} حرف.",
  "error.agent.automationRateLimited":
    "شغّلت السكربتات المحلية المهام الدورية لهذا الوكيل {limit} مرة في الساعة الأخيرة. أعد المحاولة لاحقًا.",
  "error.agent.workspaceOnlyMacOnly":
    "خيار «مساحة العمل فقط» متاح لهذا المزوّد على macOS فقط. اختر الوصول الكامل في إعدادات الوكيل.",
  "error.agent.lowMemory":
    "ذاكرة هذا الخادم منخفضة. تنتظر رسالتك في قائمة الانتظار وتبدأ عند توفر الذاكرة. تمنح الخطة الأكبر الخادمَ ذاكرة أكثر.",
  "error.agent.lowMemoryServer": "ذاكرة هذا الخادم منخفضة. تنتظر رسالتك في قائمة الانتظار وتبدأ عند توفر الذاكرة.",
  "error.agent.workspaceOnlyToolMissing":
    "يحتاج خيار «مساحة العمل فقط» إلى {tool}، ولم يجده OpenBot. ثبّته، أو اختر الوصول الكامل في إعدادات الوكيل.",
  "error.agent.claudeSandboxUnavailable":
    "يحتاج خيار «مساحة العمل فقط» إلى بيئة Claude المعزولة، ولا يستطيع Claude تشغيلها على هذا الحاسوب: {reason}. اختر الوصول الكامل أو مزوّدًا آخر في إعدادات الوكيل.",
  "error.agent.screenCaptureOff":
    "التقاط الشاشة متوقف لهذا الوكيل. يمكن للمستخدم تشغيل التحكم في الحاسوب في إعدادات الوكيل.",
  "error.agent.screenCaptureUnavailable": "التقاط الشاشة غير متاح على هذا الحاسوب.",
  "error.agent.screenCaptureShared":
    "لا يعمل التقاط الشاشة في محادثة Slack أو Discord أو Telegram، لأن أشخاصًا آخرين يتلقون ملفاته.",
  "error.agent.screenCaptureDeclined": "لم يسمح المستخدم بالتقاط الشاشة هذا. لم يُلتقط شيء.",
  "error.agent.mcpServerDeclined": "لم يسمح المستخدم بتغيير خادم MCP هذا. لم يتغير شيء.",
  "error.agent.mcpServerNotSaved": "لم يستجب خادم MCP، لذا لم يُحفظ. {error}",
  "error.agent.mcpServerKeysMove":
    "يحتفظ خادم MCP {name} بمفاتيح لخادمه الحالي. اطلب من المستخدم تغيير عنوانه أو أمره أو وسائطه أو طريقة نقله في إعدادات الخادم، MCP.",
  "error.agent.mcpServerUnknown": "لا يوجد خادم MCP باسم {name}. استدعِ list_mcp_servers لمعرفة الأسماء.",
  "error.agent.screenCaptureWindowMissing":
    "تلك النافذة غير مفتوحة الآن. استدعِ list_capture_sources للحصول على معرّفات النوافذ الحالية.",
  "error.agent.screenCaptureDisplayMissing":
    "تلك الشاشة غير متصلة الآن. استدعِ list_capture_sources للحصول على معرّفات الشاشات الحالية.",
  "error.agent.screenCaptureRegionOutside":
    "المنطقة ليست داخل شاشة واحدة. استخدم نقاط سطح المكتب داخل حدود شاشة واحدة من list_capture_sources.",
  "error.agent.screenCapturePermissionMissing":
    "لا يملك OpenBot إذن «تسجيل الشاشة». اطلب من المستخدم فتح System Settings > Privacy & Security > Screen & System Audio Recording، وتشغيل OpenBot، ثم إنهاء OpenBot وفتحه مرة أخرى.",
  "error.agent.screenCaptureEmptyWindows":
    "أعاد Windows صورة فارغة. اطلب من المستخدم إلغاء قفل الحاسوب وإغلاق المحتوى المحمي. يمكن أيضًا لسياسة المؤسسة إيقاف التقاط الشاشة.",
  "error.agent.screenCaptureFailed": "فشل التقاط الشاشة. أعد المحاولة.",
} as const satisfies PartialTranslation<typeof source>;
