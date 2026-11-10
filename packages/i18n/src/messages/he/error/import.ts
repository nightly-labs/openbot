import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/import";

export const messages = {
  "error.import.manifestNotJson": "{manifest} אינו JSON תקין.",
  "error.import.notAgentExport": "{manifest} אינו ייצוא סוכנים של OpenBot.",
  "error.import.newerExportSkill": "הייצוא הזה נוצר על ידי מיומנות ייצוא חדשה יותר. יש לעדכן את OpenBot ולנסות שוב.",
  "error.import.noAgents": "הייצוא אינו מכיל סוכנים.",
  "error.import.tooManyAgents": "הייצוא מכיל יותר מ-{limit} סוכנים.",
  "error.import.tooManyChannels": "הייצוא מכיל יותר מ-{limit} ערוצים.",
  "error.import.channelSkipped": "{name}: הערוץ מדולג כי אף אחד מהסוכנים שלו אינו בייצוא.",
  "error.import.membersLeftOut": "{name}: חברים שאינם סוכנים בייצוא הזה לא נכללים.",
  "error.import.leadNotMember": "{name}: המוביל אינו חבר, ולכן לערוץ אין מוביל.",
  "error.import.routineLimit": "{name}: רק {limit} השגרות הראשונות מיובאות.",
  "error.import.routineInvalid": '{name}: השגרה "{routine}" מדולגת כי השם, הטקסט או לוח הזמנים שלה אינם תקינים.',
  "error.import.memoriesSkipped": "{name}: {skipped} זיכרונות מדולגים כי הם ריקים או ארוכים מ-{limit} תווים.",
  "error.import.memoryLimit": "{name}: רק {limit} הזיכרונות הראשונים מיובאים.",
  "error.import.manifestMissing": "הייצוא חייב להכיל את {manifest}.",
  "error.import.skillFolderMissing": "{name}: בתיקיית המיומנות {skill} אין SKILL.md.",
  "error.import.avatarSkipped": "{name}: האווטאר מדולג כי אינו PNG, JPEG או WebP קטן מ-512 KB.",
  "error.import.exportClosed": "הייצוא אינו פתוח עוד. יש לבחור אותו שוב.",
  "error.import.agentNotInExport": "הבחירה כוללת סוכן שאינו בייצוא.",
  "error.import.channelNotInExport": "הבחירה כוללת ערוץ שאינו בייצוא.",
  "error.import.serverAgentLimit": "בשרת יכולים להיות לכל היותר {limit} סוכנים.",
  "error.import.exportChanged": "הייצוא השתנה לאחר הבדיקה. יש לבחור אותו שוב.",
  "error.import.noMembersImported": "אף אחד מהסוכנים שלו לא יובא.",
  "error.import.leadNotImported": "{name}: המוביל שלו לא יובא, ולכן אין לו מוביל.",
  "error.import.routineSkipped": '{name}: השגרה "{routine}" מדולגת. {reason}',
  "error.import.fileRenamed": "{name}: {file} כבר קיים, ולכן העותק הזה נשמר בשם {saved}.",
  "error.import.fileSkipped": "{name}: הקובץ {file} מדולג. {reason}",
  "error.import.chooseZip": "יש לבחור קובץ .zip.",
  "error.import.unsafeFile": "הייצוא מכיל קובץ לא בטוח: {name}",
  "error.import.tooManyFiles": "הייצוא חייב לכלול {limit} קבצים לכל היותר.",
  "error.import.diskSpace":
    "{name}: הקבצים שלו דורשים {size} GB של שטח פנוי בדיסק, ו-{free} GB פנויים. יש לפנות מקום ולייבא את הסוכן שוב.",
  "error.import.remoteExpandedTooLarge": "הייצוא חייב להתרחב לפחות מ-500 MB ומ-{limit} קבצים.",
  "error.import.zipInvalid": "הקובץ שנבחר אינו .zip תקין. אם Grok Bot עדיין שומר אותו, יש להמתין ולבחור אותו שוב.",
  "error.import.entryDamaged": "הקובץ פגום בייצוא.",
  "error.import.foldersSkipped": "{number} קבצים בתיקיות .git ו-node_modules לא נכללים. כלי יכול ליצור אותם מחדש.",
  "error.import.empty": "הייצוא ריק.",
  "error.import.remoteZipTooLarge": "כדי לייבא לשרת שהצטרפת אליו, הייצוא חייב להיות קובץ .zip קטן מ-100 MB.",
  "error.import.hostBusy": "השרת קורא ייצואים אחרים. יש לנסות שוב בעוד כמה דקות.",
  "error.import.uploadDiskSpace":
    "הייצוא צריך {size} GB של מקום פנוי בדיסק של השרת, ויש {free} GB פנויים. יש לפנות מקום בשרת, ואז לבחור שוב את הייצוא.",
  "error.import.remoteZipTooLargeOldHost":
    "השרת הזה מקבל ייצוא של עד 100 MB. יש לעדכן את OpenBot בשרת כדי לייבא ייצוא גדול יותר.",
  "error.import.skillKept": '{name}: בשרת כבר יש את המיומנות "{skill}", ולכן הסוכן משתמש בה. יש לבקש ממנהל לעדכן אותה.',
  "error.import.skillRenamed":
    '{name}: השם של המיומנות "{skill}" דומה מדי לשם של מיומנות אחרת, ולכן היא נשמרת בשם "{renamed}".',
  "error.import.hermesNoProfiles":
    "בתיקייה הזו אין פרופילי Hermes. יש לבחור את תיקיית Hermes, שמכילה את config.yaml או את SOUL.md.",
  "error.import.hermesClosed": "פרופילי Hermes אינם פתוחים עוד. יש לקרוא אותם שוב.",
  "error.import.hermesProfileMissing": "הבחירה כוללת פרופיל Hermes שלא נקרא.",
  "error.import.hermesSoulLong":
    "{name}: SOUL.md ארוך מ-{limit} תווים, ולכן ההנחיות שומרות את תחילתו. הקובץ המלא נמצא ב-imported/hermes/SOUL.md.",
  "error.import.hermesSkillSkipped": '{name}: המיומנות "{skill}" מדולגת. {reason}',
  "error.import.hermesSkillCodeAdded": "נוסף אליה קוד שלא היה בה כשהפרופילים נקראו. יש לקרוא אותם שוב כדי לאפשר זאת.",
  "error.import.hermesLinkNotSaved":
    "{name}: OpenBot לא הצליח לשמור איזה סוכן הגיע מהפרופיל הזה, ולכן הייבוא הבא יוסיף אותו כסוכן חדש.",
  "error.import.transferRemoteTooLarge":
    "קובץ העברה לשרת שהצטרפת אליו חייב להיות קטן מ-100 MB. יש לכבות את קובצי סביבת העבודה, או לייצא פחות סוכנים.",
  "error.import.transferNotFile": "הקובץ הזה אינו קובץ העברה של OpenBot.",
  "error.import.transferNewer": "גרסה חדשה יותר של OpenBot יצרה את הקובץ הזה. יש לעדכן את OpenBot ולנסות שוב.",
  "error.import.transferEmpty": "הקובץ אינו מכיל סוכנים ואינו מכיל הגדרות.",
  "error.import.transferTooLarge":
    "קובץ העברה חייב להיות קטן מ-2 GB ומ-50,000 קבצים. יש לכבות את קובצי סביבת העבודה, או לייצא פחות סוכנים.",
  "error.import.transferAgentInvalid": "סוכן {number} בקובץ אינו תקין, ולכן הוא מדולג.",
  "error.import.transferSettingsInvalid": "הגדרות האפליקציה בקובץ אינן תקינות, ולכן הן לא מיובאות.",
  "error.import.transferModelMissing":
    '{name}: המודל "{model}" עדיין אינו זמין כאן, ולכן הסוכן משתמש במודל ברירת המחדל. יש לבחור את המודל שוב כשהספק שלו יהיה מוכן.',
  "error.import.transferSettingSkipped": "{name} לא מיובא. {reason}",
  "error.import.transferRoutineFlowSkipped": "הייבוא השמיט זרימת שגרה. {reason}",
  "error.import.transferCustomAgentCommand":
    '{name}: סוכנים מותאמים אישית אינם מיובאים, כי הם מריצים פקודה. יש לבדוק את הפקודה "{command}" ולהוסיף את הסוכן שוב בהגדרות.',
  "error.import.transferSkillLimit":
    "{name}: רק {limit} המיומנויות הראשונות מתוך {total} שלו נמצאות בקובץ, כי לסוכן יכולות להיות {limit} מיומנויות.",
  "error.import.transferFilesGone": "{number} קבצים נמחקו בזמן הייצוא, ולכן הם אינם בקובץ.",
  "error.import.transferProviderKey": "{name}: יש להזין שוב את מפתח ה-API שלו בהגדרות.",
  "error.import.transferAgentEnv": "{name}: יש להזין שוב את הערכים של {names} בהגדרות.",
  "error.import.transferMcpValues":
    "{name}: שרת ה-MCP נוסף במצב כבוי. יש לבדוק את הפקודה שלו, להזין שוב את הערכים והכתובת המלאה שלו, ולהפעיל אותו בהגדרות MCP.",
  "error.import.transferValuesCleared":
    "{name}: ערכים שעשויים להכיל סוד הוסרו מהארגומנטים או מהכתובת שלו. יש להזין אותם שוב בהגדרות.",
  "error.import.transferSharedKept": "{number} קבצים בתיקייה Shared כבר נמצאים כאן, ולכן הם נשמרים כפי שהם.",
} as const satisfies PartialTranslation<typeof source>;
