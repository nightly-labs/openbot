import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/plugin";

export const messages = {
  "plugin.link.website": "אתר",
  "plugin.link.privacyPolicy": "מדיניות פרטיות",
  "plugin.link.terms": "תנאי שימוש",
  "plugin.copyLink": "העתקת קישור",
  "plugin.askPrompt": "שאלה אל {name}: {prompt}",
  "plugin.section.skills": "מיומנויות",
  "plugin.section.information": "מידע",
  "plugin.info.developer": "מפתח",
  "plugin.info.category": "קטגוריה",
  "plugin.info.version": "גרסה",
  "plugin.uninstallDialog.title": "לנתק את {name}?",
  "plugin.uninstallDialog.description":
    "הפעולה מסירה את מה ש-{name} התקין במחשב הזה. שום דבר אחר במארח הזה או בסוכן הזה לא משתנה.",
  "plugin.uninstallDialog.confirm": "ניתוק",
  "plugin.uninstallDialog.appsLabel": "אפליקציות להסרה, {number}",
  "plugin.uninstallDialog.appsTitle": "אפליקציות שיוסרו מהמארח הזה",
  "plugin.uninstallDialog.appsNote": "הכלים שלהן יפסיקו להיות זמינים, וכל התחברות ש-OpenBot שמר עבורן תישכח.",
  "plugin.uninstallDialog.skillsLabel": "מיומנויות להסרה, {number}",
  "plugin.uninstallDialog.skillsTitle": "מיומנויות שיוסרו מ-{agentName}",
} as const satisfies PartialTranslation<typeof source>;
