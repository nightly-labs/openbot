import { defineMessages } from "../../../message";

export const messages = defineMessages("status.messaging", {
  // Text that OpenBot posts in a Slack conversation. Slack users read it. It names no agent: in
  // Slack, every answer comes from OpenBot.
  "status.messaging.working": "در حال انجام…",
  "status.messaging.queued": "در انتظار: OpenBot در حال رسیدگی به درخواست دیگری است. پاسخ همین‌جا می‌آید.",
  "status.messaging.busy": "درخواست‌های زیادی در انتظارند. بعداً دوباره تلاش کنید.",
  "status.messaging.failed": "OpenBot نتوانست این درخواست را کامل کند. جزئیات در میزبان OpenBot موجود است.",
  "status.messaging.noAnswer": "OpenBot کار را تمام کرد، اما پاسخی ننوشت.",
  "status.messaging.noAgent": "هنوز هیچ عاملی نمی‌تواند اینجا پاسخ دهد. Slack Orchestrator را در OpenBot اضافه کنید.",
  "status.messaging.delegated": "هم‌تیمی‌ای در حال انجام آن است. پاسخ همین‌جا می‌آید.",
  "status.messaging.stopped": "متوقف شد.",
  "status.messaging.stop": "توقف",
  "status.messaging.approvalTitle": "OpenBot برای ادامه تأیید می‌خواهد.",
  "status.messaging.approvalCommand": "اجرای فرمان",
  "status.messaging.approvalFileChange": "تغییر فایل‌ها",
  "status.messaging.approvalPermissions": "گرفتن مجوزهای بیشتر",
  "status.messaging.approve": "تأیید",
  "status.messaging.deny": "رد",
  "status.messaging.approvedBy": "{user} تأیید کرد.",
  "status.messaging.deniedBy": "{user} رد کرد.",
  "status.messaging.answeredOnHost": "پاسخ در میزبان OpenBot داده شد.",
  "status.messaging.requestInactive": "این درخواست دیگر فعال نیست.",
  "status.messaging.onlyRequester": "فقط {user} می‌تواند این کار را انجام دهد. میزبان OpenBot هم می‌تواند پاسخ دهد.",
  "status.messaging.hostOnly": "فقط میزبان OpenBot می‌تواند به این درخواست پاسخ دهد.",
  "status.messaging.filesSkipped": "بعضی فایل‌ها فرستاده نشدند: {names}.",
  // The name and title of the agent that OpenBot adds to answer in Slack. The user can rename it.
  "status.messaging.orchestratorName": "Slack Orchestrator",
  "status.messaging.orchestratorTitle": "در Slack پاسخ می‌دهد و از تیم کمک می‌گیرد",
  // The same texts for Discord. Discord users read the first one.
  "status.messaging.discordNoAgent": "هنوز هیچ عاملی نمی‌تواند اینجا پاسخ دهد. Discord Orchestrator را در OpenBot اضافه کنید.",
  "status.messaging.discordOrchestratorName": "Discord Orchestrator",
  "status.messaging.discordOrchestratorTitle": "در Discord پاسخ می‌دهد و از تیم کمک می‌گیرد",
  // The sidebar section that OpenBot puts the Slack Orchestrator in. The user can rename it.
  "status.messaging.integrationsSection": "یکپارچه‌سازی‌ها",
  // The page a development Slack install ends on.
  "status.messaging.signInReceived": "OpenBot نصب Slack را دریافت کرد. می‌توانید این زبانه را ببندید.",
  "status.messaging.signInUnknown": "OpenBot این نصب Slack را شروع نکرده است. آن را دوباره از OpenBot شروع کنید.",
  // Text that OpenBot posts in a Telegram chat, and the Telegram Orchestrator agent. Telegram users
  // read the posts. The user can rename the agent.
  "status.messaging.telegramNoAgent": "هنوز هیچ عاملی نمی‌تواند اینجا پاسخ دهد. Telegram Orchestrator را در OpenBot اضافه کنید.",
  "status.messaging.telegramLinked": "OpenBot به این گفت‌وگو وصل شد. برای درخواست از عامل‌ها، {bot} را نام ببرید یا به پیام OpenBot پاسخ دهید.",
  "status.messaging.telegramOrchestratorName": "Telegram Orchestrator",
  "status.messaging.telegramOrchestratorTitle": "در Telegram پاسخ می‌دهد و از تیم کمک می‌گیرد",
  // Text that OpenBot posts from a linked WhatsApp number, and the WhatsApp Orchestrator agent.
  // WhatsApp users read the posts. Personal WhatsApp has no buttons, so a person answers with a number.
  "status.messaging.whatsappNoAgent": "هنوز هیچ عاملی نمی‌تواند اینجا پاسخ دهد. WhatsApp Orchestrator را در OpenBot اضافه کنید.",
  "status.messaging.whatsappApprovalMenu": "برای تأیید 1 یا برای رد 2 را پاسخ دهید.",
  "status.messaging.whatsappStopMenu": "برای توقف، stop را پاسخ دهید.",
  "status.messaging.whatsappPairingCode": "این شماره فقط به افرادی پاسخ می‌دهد که صاحبش اجازه داده است. این کد را به صاحب شماره بدهید: {code}",
  "status.messaging.whatsappPairingApproved": "حالا می‌توانید برای این شماره درخواست بفرستید.",
  "status.messaging.whatsappOwnChat": "پیام به خودم",
  // The first message after a link, in the linked number's own "Message yourself" chat.
  "status.messaging.whatsappWelcomeOwn": "👋 *OpenBot وصل شد*\n\nبرای درخواست از عامل‌ها، اینجا بنویسید. WhatsApp Orchestrator پاسخ می‌دهد یا کار را به عامل مناسب می‌سپارد.\n\nبرای توقف درخواست، *stop* را بفرستید.",
  "status.messaging.whatsappWelcomeDedicated": "👋 *OpenBot وصل شد*\n\nافرادی که در OpenBot اجازه می‌دهید حالا می‌توانند به این شماره پیام بدهند. فرد تازه یک کد می‌گیرد: آن را در OpenBot، بخش Requests، تأیید کنید.\n\nبرای توقف درخواست، *stop* را بفرستید.",
  "status.messaging.whatsappOrchestratorName": "WhatsApp Orchestrator",
  "status.messaging.whatsappOrchestratorTitle": "در WhatsApp پاسخ می‌دهد و از تیم کمک می‌گیرد",
});
