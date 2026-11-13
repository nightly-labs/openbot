import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/import";

export const messages = {
  "error.import.manifestNotJson": "{manifest} ليس JSON صالحًا.",
  "error.import.notAgentExport": "{manifest} ليس تصديرًا لوكيل OpenBot.",
  "error.import.newerExportSkill": "أُنشئ هذا التصدير بمهارة تصدير أحدث. حدّث OpenBot وحاول مرة أخرى.",
  "error.import.noAgents": "لا يحتوي التصدير على وكلاء.",
  "error.import.tooManyAgents": "يحتوي التصدير على أكثر من {limit} وكيل.",
  "error.import.tooManyChannels": "يحتوي التصدير على أكثر من {limit} قناة.",
  "error.import.channelSkipped": "{name}: تُتخطى القناة لأن أيًا من وكلائها ليس في التصدير.",
  "error.import.membersLeftOut": "{name}: يُستبعد الأعضاء الذين ليسوا وكلاء في هذا التصدير.",
  "error.import.leadNotMember": "{name}: القائد ليس عضوًا، لذا ليس للقناة قائد.",
  "error.import.routineLimit": "{name}: تُستورد أول {limit} مهمة دورية فقط.",
  "error.import.routineInvalid": "{name}: تُتخطى المهمة الدورية «{routine}» لأن اسمها أو نصها أو جدولها غير صالح.",
  "error.import.memoriesSkipped": "{name}: تُتخطى {skipped} من الذكريات لأنها فارغة أو أطول من {limit} حرف.",
  "error.import.memoryLimit": "{name}: تُستورد أول {limit} من الذكريات فقط.",
  "error.import.manifestMissing": "يجب أن يحتوي التصدير على {manifest}.",
  "error.import.skillFolderMissing": "{name}: لا يحتوي مجلد المهارة {skill} على SKILL.md.",
  "error.import.avatarSkipped": "{name}: تُتخطى الصورة الرمزية لأنها ليست PNG أو JPEG أو WebP بحجم أقل من 512 KB.",
  "error.import.exportClosed": "لم يعد التصدير مفتوحًا. اختره مرة أخرى.",
  "error.import.agentNotInExport": "يذكر التحديد وكيلًا ليس في التصدير.",
  "error.import.channelNotInExport": "يذكر التحديد قناة ليست في التصدير.",
  "error.import.serverAgentLimit": "يمكن أن يحتوي الخادم على {limit} وكيل كحد أقصى.",
  "error.import.exportChanged": "تغيّر التصدير بعد التحقق منه. اختره مرة أخرى.",
  "error.import.noMembersImported": "لم يُستورد أي من وكلائها.",
  "error.import.leadNotImported": "{name}: لم يُستورد قائدها، لذا ليس لها قائد.",
  "error.import.routineSkipped": "{name}: تُتخطى المهمة الدورية «{routine}». {reason}",
  "error.import.fileRenamed": "{name}: {file} موجود بالفعل، لذا تُحفظ هذه النسخة باسم {saved}.",
  "error.import.fileSkipped": "{name}: يُتخطى الملف {file}. {reason}",
  "error.import.chooseZip": "اختر ملف .zip.",
  "error.import.unsafeFile": "يحتوي التصدير على ملف غير آمن: {name}",
  "error.import.tooManyFiles": "يجب ألا يزيد عدد ملفات التصدير على {limit} ملف.",
  "error.import.diskSpace":
    "{name}: تحتاج ملفاته إلى {size} GB من المساحة الحرة على القرص، والمساحة الحرة {free} GB. حرّر مساحة، ثم استورد الوكيل مرة أخرى.",
  "error.import.remoteExpandedTooLarge": "يجب أن يكون حجم التصدير بعد فك الضغط أقل من 500 MB وأقل من {limit} ملف.",
  "error.import.zipInvalid": "الملف المحدد ليس ملف .zip صالحًا. إذا كان Grok Bot لا يزال يحفظه، فانتظر واختره مرة أخرى.",
  "error.import.entryDamaged": "الملف تالف في التصدير.",
  "error.import.foldersSkipped": "تُرك {number} ملف في مجلدات .git وnode_modules. يمكن لأداة إنشاؤها مرة أخرى.",
  "error.import.empty": "التصدير فارغ.",
  "error.import.remoteZipTooLarge": "للاستيراد إلى خادم منضم إليه، يجب أن يكون التصدير ملف .zip بحجم أقل من 100 MB.",
  "error.import.hostBusy": "يقرأ الخادم عمليات تصدير أخرى. حاول مرة أخرى بعد بضع دقائق.",
  "error.import.uploadDiskSpace":
    "يحتاج التصدير إلى {size} GB من المساحة الفارغة على قرص الخادم، والمتاح {free} GB. أفرغ مساحة على الخادم، ثم اختر التصدير مرة أخرى.",
  "error.import.remoteZipTooLargeOldHost":
    "يقبل هذا الخادم تصديرًا حتى 100 MB. حدّث OpenBot على الخادم لاستيراد تصدير أكبر.",
  "error.import.skillKept":
    "{name}: لدى الخادم المهارة «{skill}» بالفعل، لذا يستخدم الوكيل تلك المهارة. اطلب من مسؤول تحديثها.",
  "error.import.skillRenamed": "{name}: اسم المهارة «{skill}» قريب جدًا من اسم مهارة أخرى، لذا حُفظت باسم «{renamed}».",
  "error.import.hermesNoProfiles":
    "لا يحتوي هذا المجلد على ملفات تعريف Hermes. اختر مجلد Hermes الذي يحتوي على config.yaml أو SOUL.md.",
  "error.import.hermesClosed": "لم تعد ملفات تعريف Hermes مفتوحة. اقرأها مرة أخرى.",
  "error.import.hermesProfileMissing": "يذكر التحديد ملف تعريف Hermes لم تُقرأ.",
  "error.import.hermesSoulLong":
    "{name}: ملف SOUL.md أطول من {limit} حرف، لذا تحتفظ التعليمات ببدايته. الملف الكامل موجود في imported/hermes/SOUL.md.",
  "error.import.hermesSkillSkipped": "{name}: تُتخطى المهارة «{skill}». {reason}",
  "error.import.hermesSkillCodeAdded":
    "تحتوي على شيفرة لم تكن فيها عند قراءة ملفات التعريف. اقرأها مرة أخرى للسماح بها.",
  "error.import.hermesLinkNotSaved":
    "{name}: تعذّر على OpenBot حفظ الوكيل الذي جاء من ملف التعريف هذا، لذا يضيفه الاستيراد التالي كوكيل جديد.",
  "error.import.transferRemoteTooLarge":
    "يجب أن يكون حجم ملف النقل لخادم منضم إليه أقل من 100 MB. أوقف ملفات مساحة العمل، أو صدّر عددًا أقل من الوكلاء.",
  "error.import.transferNotFile": "هذا الملف ليس ملف نقل OpenBot.",
  "error.import.transferNewer": "أنشأ إصدار أحدث من OpenBot هذا الملف. حدّث OpenBot وحاول مرة أخرى.",
  "error.import.transferEmpty": "لا يحتوي الملف على وكلاء ولا إعدادات.",
  "error.import.transferTooLarge":
    "يجب أن يكون ملف النقل أقل من 2 GB وأقل من 50,000 ملف. أوقف ملفات مساحة العمل، أو صدّر عددًا أقل من الوكلاء.",
  "error.import.transferAgentInvalid": "الوكيل {number} في الملف غير صالح، لذا يُتخطى.",
  "error.import.transferSettingsInvalid": "إعدادات التطبيق في الملف غير صالحة، لذا لا تُستورد.",
  "error.import.transferModelMissing":
    "{name}: النموذج «{model}» غير متاح هنا بعد، لذا يستخدم الوكيل النموذج الافتراضي. اختر النموذج مرة أخرى عندما يصبح مزوّده جاهزًا.",
  "error.import.transferSettingSkipped": "لا يُستورد {name}. {reason}",
  "error.import.transferRunsSkipped": "{name}: لا يُستورد سجل تشغيل المهمة الدورية «{routine}».",
  "error.import.transferSharedSkillsSkipped": "تعذّرت قراءة المهارات المشتركة، لذا فهي ليست في الملف.",
  "error.import.transferSharedSkillsNotAdded": "تعذّرت إضافة المهارات المشتركة في الملف إلى هذا الخادم.",
  "error.import.transferMemberPreferencesSkipped": {
    zero: "تعذّر حفظ اختيارات {count} عضو.",
    one: "تعذّر حفظ اختيارات عضو واحد.",
    two: "تعذّر حفظ اختيارات عضوين.",
    few: "تعذّر حفظ اختيارات {count} أعضاء.",
    many: "تعذّر حفظ اختيارات {count} عضوًا.",
    other: "تعذّر حفظ اختيارات {count} عضو.",
  },
  "error.import.transferSharedSkillExists": "توجد على هذا الخادم مهارة مشتركة بهذا الاسم وبملفات أخرى.",
  "error.import.transferServerPreferencesSkipped": {
    zero: "{count} تفضيل للخادم في الملف غير صالح هنا، لذا لا تُستورد.",
    one: "تفضيل واحد للخادم في الملف غير صالح هنا، لذا لا يُستورد.",
    two: "تفضيلان للخادم في الملف غير صالحين هنا، لذا لا يُستوردان.",
    few: "{count} تفضيلات للخادم في الملف غير صالحة هنا، لذا لا تُستورد.",
    many: "{count} تفضيلًا للخادم في الملف غير صالح هنا، لذا لا تُستورد.",
    other: "{count} تفضيل للخادم في الملف غير صالح هنا، لذا لا تُستورد.",
  },
  "error.import.transferRoutineFlowSkipped": "استبعد الاستيراد تدفق مهمة دورية. {reason}",
  "error.import.transferCustomAgentCommand":
    "{name}: لا تُستورد الوكلاء المخصصة لأنها تشغّل أمرًا. تحقّق من الأمر «{command}» وأضف الوكيل مرة أخرى في الإعدادات.",
  "error.import.transferSkillLimit":
    "{name}: يحتوي الملف على أول {limit} من مهاراته البالغة {total} فقط، لأن الوكيل يمكن أن يمتلك {limit} مهارة.",
  "error.import.transferFilesGone": "حُذف {number} من الملفات أثناء تشغيل التصدير، لذا ليست في الملف.",
  "error.import.transferProviderKey": "{name}: أدخل مفتاح API الخاص به مرة أخرى في الإعدادات.",
  "error.import.transferAgentEnv": "{name}: أدخل قيم {names} مرة أخرى في الإعدادات.",
  "error.import.transferMcpValues":
    "{name}: أُضيف خادم MCP متوقفًا. تحقّق من أمره، وأدخل قيمه وعنوانه الكامل مرة أخرى، وشغّله في إعدادات MCP.",
  "error.import.transferValuesCleared":
    "{name}: أُزيلت من وسائطه أو عنوانه القيم التي يمكن أن تحتوي على سر. أدخلها مرة أخرى في الإعدادات.",
  "error.import.transferSharedKept": "{number} من الملفات في المجلد المشترك موجودة هنا بالفعل، لذا تبقى كما هي.",
} as const satisfies PartialTranslation<typeof source>;
