import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/agent";

export const messages = {
  "error.agent.historyUnavailable":
    "ההיסטוריה אינה זמינה לבקשה הזו. יש לקרוא שוב את ההיסטוריה האחרונה, או להשתמש ב-channel_history לעבודה בערוץ.",
  "error.agent.historyArgumentsInvalid":
    "ארגומנטים שגויים להיסטוריה: {detail} תקן את הארגומנטים ונסה שוב. openbot.tool_describe מחזיר את הסכמה.",
  "error.agent.toolRequestInvalid": "ארגומנטים לא תקינים לגילוי כלים. יש להשתמש בסכימה המוצהרת ובשם כלי מקורי מלא.",
  "error.agent.toolCallArgumentsNotObject":
    "הכלי לא רץ. ב-tool_call, arguments חייב להיות אובייקט JSON ולא טקסט. יש לשלוח את הקריאה שוב עם arguments כאובייקט.",
  "error.agent.toolCallDiscoveryTool":
    "הכלי לא רץ. tool_call לא יכול להריץ את openbot.tool_search או את openbot.tool_describe. יש לקרוא להם ישירות עם אותם ארגומנטים.",
  "error.agent.routineScheduleArgumentsInvalid":
    "לוח הזמנים של השגרה אינו תקין: {detail} יש לתקן את לוח הזמנים ולנסות שוב. openbot.tool_describe מחזיר את הסכמה.",
  "error.agent.approvalWhileDeleting": "אי אפשר לתת אישור בזמן שהסוכן נמחק.",
  "error.agent.accessLocalOnly": "אפשר לשנות גישה של סוכן רק במחשב שמריץ את הסוכן.",
  "error.agent.duplicateCleanupFailed": "שכפול הסוכן נכשל ולא ניתן היה להסיר את ההעתק החלקי.",
  "error.agent.commitEffectsFailed": "הטרנזקציה בוצעה, אך ההשפעות השמורות שלה נכשלו.",
  "error.agent.settingsLocalOnly": "אפשר לשנות הגדרות של סוכן רק במחשב שמריץ את הסוכן.",
  "error.agent.skillsLocalOnly": "אפשר לשנות מיומנויות רק במחשב שמריץ את הסוכן.",
  "error.agent.addLocalOnly": "אפשר להוסיף סוכנים רק במחשב שמריץ אותם.",
  "error.agent.joinedServerUpdate": "אי אפשר לעדכן מכאן סוכן בשרת שהצטרפת אליו.",
  "error.agent.searchQueryRequired": "נדרשת שאילתת חיפוש.",
  "error.agent.messageTooLong": "ההודעה ארוכה מדי.",
  "error.agent.messageOrAttachmentRequired": "נדרשת הודעה או קובץ מצורף.",
  "error.agent.promptAnswersTooLong": "תשובות ההנחיה ארוכות מדי.",
  "error.agent.gone": "הסוכן הזה כבר לא קיים.",
  "error.agent.instructionsTooLarge": "קובץ ההנחיות גדול מדי לפתיחה כאן. יש לקצר אותו בעורך טקסט.",
  "error.agent.instructionsOutside":
    "קובץ ההנחיות מקשר למקום מחוץ לסביבת העבודה של הסוכן, ולכן OpenBot אינו פותח אותו.",
  "error.agent.instructionsReadFailed": "לא ניתן לקרוא את קובץ ההנחיות.",
  "error.agent.instructionsSaveFailed": "לא ניתן לשמור את קובץ ההנחיות.",
  "error.agent.profileGenerationBusy": "יצירת הפרופיל עמוסה. יש לנסות שוב בעוד רגע.",
  "error.agent.instructionsChanged": "הסוכן שינה את קובץ ההנחיות. השינוי האחרון שלך לא נשמר. יש לבצע אותו שוב.",
  "error.agent.initialMessageRequired": "נדרשת הודעה ראשונית.",
  "error.agent.initialMessageTooLong": "ההודעה הראשונית ארוכה מדי.",
  "error.agent.setupCleanupFailed": "הגדרת הסוכן נכשלה ולא ניתן היה להסיר את הסוכן החלקי.",
  "error.agent.modelUnavailable": "מודל הסוכן שנבחר אינו זמין.",
  "error.agent.modelProviderNotConnected": 'מודל הסוכן שנבחר "{model}" אינו זמין: {provider} אינו מחובר.',
  "error.agent.modelListEmpty":
    'מודל הסוכן שנבחר "{model}" אינו זמין: {provider} לא פרסם מודלים. השגיאה האחרונה: {detail}',
  "error.agent.modelListEmptyNoError": 'מודל הסוכן שנבחר "{model}" אינו זמין: {provider} לא פרסם מודלים.',
  "error.agent.modelNotInProviderList": 'מודל הסוכן שנבחר "{model}" אינו זמין: {provider} אינו מפרסם אותו.',
  "error.agent.modelVariantNotListed":
    'מודל הסוכן שנבחר "{model}" אינו זמין: {provider} אינו מפרסם אותו. יש להשתמש באחד מהערכים ש-{provider} מפרסם עבור המודל הזה: {models}.',
  "error.agent.modelProviderMismatch": "המודל שנבחר אינו שייך לספק הזה.",
  "error.agent.modelNotListed": 'המודל "{model}" אינו זמין. המודלים הזמינים: {models}.',
  "error.agent.providerNotListed":
    "אין עכשיו מודל זמין של {provider}. אפשר לקרוא ל-list_models כדי לראות את המודלים הזמינים.",
  "error.agent.reasoningEffortUnsupported":
    'המודל "{model}" אינו תומך ברמת החשיבה "{effort}". הרמות הנתמכות: {efforts}.',
  "error.agent.reasoningEffortNotConfigurable": 'למודל "{model}" אין הגדרה של רמת חשיבה, ולכן אי אפשר לשנות אותה.',
  "error.agent.noStartingModelInSettings":
    "אין מודל זמין ב-{provider}, וגם לאף ספק מחובר אחר אין. יש להתחבר לספק, או לשנות את ספק ברירת המחדל בהגדרות השרת ← ספקים.",
  "error.agent.noStartingModel":
    "אין מודל זמין ב-{provider}, וגם לאף ספק מחובר אחר אין. יש להתחבר לספק, או לשנות את ספק ברירת המחדל בספקים והרשאות.",
  "error.agent.waitBeforeProviderChange": "יש להמתין לסיום התור הפעיל ולריקון התור לפני החלפת ספק.",
  "error.agent.waitForTasksBeforeProviderChange":
    "משימות של הסוכן הזה פועלות. יש להמתין לסיומן, או לעצור אותן, לפני החלפת ספק.",
  "error.agent.waitBeforeClearContext": "יש להמתין לסיום התור הפעיל ולריקון התור לפני תחילת צ'אט חדש.",
  "error.agent.waitBeforeCompactContext": "יש להמתין לסיום התור הפעיל ולריקון התור לפני דחיסת ההקשר.",
  "error.agent.waitBeforeDeleteHistory": "יש להמתין לסיום התור הפעיל ולריקון התור לפני מחיקת ההיסטוריה.",
  "error.agent.compactContextUnavailable": "הסוכן הזה לא יכול לדחוס את ההקשר שלו כעת.",
  "error.agent.unknown": "סוכן לא מוכר: {id}",
  "error.agent.onlyUserWidensSettings":
    "רק המשתמש יכול לתת לסוכן גישה מלאה או להפעיל שליטה במחשב. יש לבקש מהמשתמש לשנות זאת בהגדרות הסוכן.",
  "error.agent.queuedMessageCreateFailed": "לא ניתן ליצור הודעה בתור.",
  "error.agent.messageUnavailable": "ההודעה אינה זמינה עוד.",
  "error.agent.hostLimit": "במארח יכולים להיות עד {limit} סוכנים.",
  "error.agent.changedWhileDuplicating": "הסוכן השתנה בזמן השכפול. יש לנסות שוב.",
  "error.agent.duplicatedAgentGone": "הסוכן המשוכפל כבר לא קיים.",
  "error.agent.stateCorrupt": "מצב הסוכנים פגום או מגרסה חדשה יותר של OpenBot; OpenBot מסרב לדרוס אותו.",
  "error.agent.oldRoleField": "פרופילי הסוכנים השמורים משתמשים בשדה role הישן; יש לעדכן את הנתונים לפני הפעלת OpenBot.",
  "error.agent.duplicateIds": "מצב הסוכנים מכיל מזהי סוכן כפולים; OpenBot מסרב לדרוס אותו.",
  "error.agent.copyNameFailed": "OpenBot לא הצליח ליצור שם ייחודי להעתק הסוכן.",
  "error.agent.endpointRemoved": "נקודת הקצה שהסוכן הזה השתמש בה הוסרה. יש לבחור עבורו מודל אחר.",
  "error.agent.turnStalled":
    "{provider} הפסיק להגיב, ולכן OpenBot סיים את התור הזה. יש לשלוח את ההודעה שוב, או לבחור מודל אחר.",
  "error.agent.toolLoopStopped":
    "{provider} חזר על שלב שנכשל פעמים רבות, ולכן OpenBot עצר את התור הזה. שלחו את ההודעה שוב, או בחרו מודל אחר.",
  "error.agent.compactionConnectionLost":
    "החיבור נפסק בזמן שהסוכן כיווץ את ההקשר שלו, ולכן המשימה נעצרה. יש לבדוק את חיבור האינטרנט ולשלוח הודעה כדי להמשיך.",
  "error.agent.compactionLoopStopped":
    "{provider} דחס את ההקשר שוב ושוב, ובכל פעם הוא נשאר מלא מדי כדי להמשיך, ולכן OpenBot עצר את התור הזה. כבה את שרתי ה-MCP או את השימוש במחשב שהסוכן הזה לא צריך, ואז שלח הודעה. אם אתה או הסוכן שיניתם מתי {provider} דוחס, בטל את השינוי.",
  "error.agent.selectedGone": "הסוכן שנבחר כבר לא קיים.",
  "error.agent.profileEndpointsChanged": "נקודות הקצה המותאמות השתנו בזמן היצירה. יש לנסות שוב.",
  "error.agent.profileInvalid": "הספק החזיר פרופיל לא תקין. יש לנסות לשנות את ההנחיה.",
  "error.agent.profileSectionUnavailable": "הסעיף שנוצר אינו זמין. יש לנסות שוב או לבחור סעיף ידנית.",
  "error.agent.profileTimedOut": "יצירת הפרופיל חרגה מהזמן. יש לנסות שוב.",
  "error.agent.profileDisconnected": "הספק התנתק בזמן יצירת הפרופיל.",
  "error.agent.profileToolUse": "הספק ניסה להשתמש בכלי. יש לנסות לשנות את ההנחיה.",
  "error.agent.profileFailed": "הספק לא הצליח ליצור פרופיל. יש לנסות שוב.",
  "error.agent.profileTooLarge": "הפרופיל שנוצר גדול מדי. יש לנסות הנחיה קצרה יותר.",
  "error.agent.profileNotStarted": "הספק לא הצליח להתחיל ליצור את הפרופיל.",
  "error.agent.deletionBusy": "מחיקת הסוכן כבר מתבצעת.",
  "error.agent.stopBeforeDelete": "יש לעצור את הסוכן ולבטל את ההודעות שלו בתור לפני המחיקה.",
  "error.agent.deleteIncomplete": "לא ניתן היה להסיר את נתוני הסוכן לגמרי. יש לנסות למחוק את הסוכן שוב.",
  "error.agent.duplicationBusy": "הסוכן הזה כבר משוכפל.",
  "error.agent.waitBeforeDuplicate": "יש להמתין שהסוכן יסיים ולרוקן את התור שלו לפני השכפול.",
  "error.agent.saveOtherAgent": "השמירה הזו שייכת לסוכן אחר.",
  "error.agent.savedGone": "הסוכן השמור כבר לא קיים.",
  "error.agent.storedProfileUnreadable":
    'בפרופיל סוכן שמור יש ערך "{field}" שאי אפשר לקרוא; יש לעדכן את הנתונים לפני הפעלת OpenBot.',
  "error.agent.storedProfileUnreadableId":
    'בפרופיל הסוכן השמור {id} יש ערך "{field}" שאי אפשר לקרוא; יש לעדכן את הנתונים לפני הפעלת OpenBot.',
  "error.agent.queueEditRejected": "עריכת התור נדחתה: {reason}",
  "error.agent.computerUseLocalOnly": "אפשר לשנות שליטה במחשב רק במחשב שמריץ את הסוכן.",
  "error.agent.automationLocalOnly": "אפשר לאפשר סקריפטים מקומיים רק במחשב שמריץ את הסוכן.",
  "error.agent.newChatLocalOnly": "רק המחשב שמריץ את הסוכן יכול לאפשר לו להתחיל צ'אטים חדשים.",
  "error.agent.quickAcknowledgementLocalOnly": "רק המחשב שמריץ את הסוכן יכול לשנות את ההגדרה הזו.",
  "error.agent.sideQuestionBusy": "יותר מדי שאלות צדדיות פועלות. יש לנסות שוב בעוד רגע.",
  "error.agent.sideQuestionFailed": "הסוכן לא הצליח לענות על השאלה הצדדית. יש לנסות שוב.",
  "error.agent.webSearchSignIn": "חיפוש באינטרנט דורש התחברות ל-Codex עם חשבון ChatGPT.",
  "error.agent.webSearchBusy": "פועלים יותר מדי חיפושים ושאלות צד. נסו שוב בעוד רגע.",
  "error.agent.webSearchFailed": "החיפוש באינטרנט לא הסתיים. נסו שוב.",
  "error.agent.busyMessageModeLocalOnly": "אפשר להגדיר מה קורה להודעות בזמן שהסוכן עובד רק במחשב שמריץ את הסוכן.",
  "error.agent.backupModelsLocalOnly": "אפשר להגדיר מודלי גיבוי רק במחשב שמריץ את הסוכן.",
  "error.agent.taskLimitLocalOnly": "אפשר להגדיר את מגבלת המשימות רק במחשב שמריץ את הסוכן.",
  "error.agent.localScriptsOff": "הסוכן הזה אינו מאפשר סקריפטים מקומיים.",
  "error.agent.localScriptsRateLimited":
    "סקריפטים מקומיים שלחו לסוכן הזה {limit} הודעות או בקשות שגרה בשעה האחרונה. יש לנסות שוב מאוחר יותר.",
  "error.agent.automationOff": "הסוכן הזה אינו מאפשר לסקריפטים מקומיים להריץ את השגרות שלו.",
  "error.agent.automationPayloadTooLong": "המטען ארוך מ-{limit} תווים.",
  "error.agent.automationRateLimited":
    "סקריפטים מקומיים הריצו את השגרות של הסוכן הזה {limit} פעמים בשעה האחרונה. יש לנסות שוב מאוחר יותר.",
  "error.agent.workspaceOnlyMacOnly":
    "מצב סביבת עבודה בלבד זמין לספק הזה רק ב-macOS. יש לבחור גישה מלאה בהגדרות הסוכן.",
  "error.agent.lowMemory":
    "בשרת הזה חסר זיכרון. ההודעה שלך ממתינה בתור ותתחיל כשיתפנה זיכרון. תוכנית גדולה יותר נותנת לשרת יותר זיכרון.",
  "error.agent.lowMemoryServer": "בשרת הזה חסר זיכרון. ההודעה שלך ממתינה בתור ותתחיל כשיתפנה זיכרון.",
  "error.agent.workspaceOnlyToolMissing":
    "מצב סביבת עבודה בלבד דורש את {tool}, ש-OpenBot לא מצא. יש להתקין אותו, או לבחור גישה מלאה בהגדרות הסוכן.",
  "error.agent.claudeSandboxUnavailable":
    "מצב סביבת עבודה בלבד דורש את ארגז החול של Claude, ש-Claude לא מצליח להפעיל במחשב הזה: {reason}. יש לבחור גישה מלאה או ספק אחר בהגדרות הסוכן.",
  "error.agent.screenCaptureOff": "צילום מסך כבוי עבור הסוכן הזה. המשתמש יכול להפעיל שליטה במחשב בהגדרות הסוכן.",
  "error.agent.screenCaptureUnavailable": "צילום מסך אינו זמין במחשב הזה.",
  "error.agent.screenCaptureShared":
    "צילום מסך לא פועל בשיחה ב-Slack, ב-Discord או ב-Telegram, כי אנשים אחרים מקבלים את הקבצים שלו.",
  "error.agent.screenCaptureDeclined": "המשתמש לא אישר את צילום המסך הזה. דבר לא צולם.",
  "error.agent.mcpServerDeclined": "המשתמש לא אישר את שינוי שרת ה-MCP הזה. דבר לא השתנה.",
  "error.agent.mcpServerNotSaved": "שרת ה-MCP לא הגיב, ולכן לא נשמר. {error}",
  "error.agent.mcpServerKeysMove":
    "שרת ה-MCP {name} מחזיק מפתחות עבור השרת הנוכחי שלו. יש לבקש מהמשתמש לשנות את הכתובת, הפקודה, הארגומנטים או שיטת ההעברה שלו בהגדרות השרת, MCP.",
  "error.agent.mcpServerBuiltIn":
    "{name} הוא חלק מ-OpenBot, ולכן כלי ה-MCP לא יכולים לבדוק, להפעיל, לכבות או להסיר אותו. המשתמש שולט בו במחשב שמריץ את OpenBot: חיבור GitHub בחנות, אפליקציות, GitHub, ושליטה במחשב בהגדרות, שליטה במחשב.",
  "error.agent.mcpServerUnknown": "אין שרת MCP בשם {name}. אפשר לקרוא ל-list_mcp_servers כדי לראות את השמות.",
  "error.agent.screenCaptureWindowMissing":
    "החלון הזה אינו פתוח כעת. יש לקרוא ל-list_capture_sources כדי לקבל את מזהי החלונות הנוכחיים.",
  "error.agent.screenCaptureDisplayMissing":
    "התצוגה הזו אינה מחוברת כעת. יש לקרוא ל-list_capture_sources כדי לקבל את מזהי התצוגות הנוכחיים.",
  "error.agent.screenCaptureRegionOutside":
    "האזור אינו בתוך תצוגה אחת. יש להשתמש בנקודות שולחן עבודה בתוך גבולות תצוגה אחת מתוך list_capture_sources.",
  "error.agent.screenCapturePermissionMissing":
    "ל-OpenBot אין הרשאת Screen Recording. יש לבקש מהמשתמש לפתוח את System Settings > Privacy & Security > Screen & System Audio Recording, להפעיל את OpenBot, ואז לצאת מ-OpenBot ולפתוח אותו שוב.",
  "error.agent.screenCaptureEmptyWindows":
    "Windows החזירה תמונה ריקה. יש לבקש מהמשתמש לבטל את נעילת המחשב ולסגור תוכן מוגן. גם מדיניות של הארגון יכולה לחסום צילום מסך.",
  "error.agent.screenCaptureFailed": "צילום המסך נכשל. יש לנסות שוב.",
} as const satisfies PartialTranslation<typeof source>;
