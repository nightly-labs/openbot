import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/notification";

export const messages = {
  "notification.needsInput": "נדרש קלט שלך.",
  "notification.needsApproval": "נדרש אישור שלך.",
  "notification.needsBrowserStep": "נדרש שתסיים שלב בדפדפן.",
  "notification.needsApprovalFor": "נדרש אישור שלך: {action}",
  "notification.finished": "העבודה הסתיימה.",
  "notification.workflowApproval": "שלב ממתין לאישור שלך.",
  "notification.workflowOutput": "יש תוצאה חדשה בתהליך עבודה.",
  "notification.failed": "נעצר עקב שגיאה.",
  "notification.subagentFailed": "תת-סוכן נעצר עקב שגיאה.",
  "notification.subagentFailedFor": "תת-סוכן נעצר עקב שגיאה: {task}",
  "notification.channelTitle": "{agent} ב{channel}",
  "notification.channelMessage": "נשלחה הודעה.",
  "notification.usageLimit.title": "חשבון {provider} הגיע למגבלה",
  "notification.usageLimit.body": {
    one: "סוכן אחד ממתין. OpenBot ינסה שוב מאוחר יותר.",
    two: "שני סוכנים ממתינים. OpenBot ינסה שוב מאוחר יותר.",
    other: "{count} סוכנים ממתינים. OpenBot ינסה שוב מאוחר יותר.",
  },
  "notification.usageLimit.bodyResets": {
    one: "סוכן אחד ממתין. האיפוס: {reset}.",
    two: "שני סוכנים ממתינים. האיפוס: {reset}.",
    other: "{count} סוכנים ממתינים. האיפוס: {reset}.",
  },
  "notification.machineAlert.disk": "{server}: הדיסק מלא ב-{percent}",
  "notification.machineAlert.memory": "{server}: הזיכרון בשימוש של {percent}",
  "notification.machineAlert.cpu": "{server}: ה-CPU עמוס ב-{percent}",
  "notification.machineAlert.body": "הערך עבר את סף ההתראה של {level}. אפשר לראות בהגדרות השרת > אחסון.",
  "notification.test": "ההתראות פועלות.",
  "notification.welcome": "OpenBot יודיע לך כאן כשסוכן יזדקק לך.",
  "notification.toast.region": "התראות",
  "notification.toast.close": "סגירת ההתראה",
} as const satisfies PartialTranslation<typeof source>;
