import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/marketplace";

export const messages = {
  "error.marketplace.timezoneInvalid": "אזור הזמן המקומי אינו תקין.",
  "error.marketplace.installedAgentMissing": "הסוכן שהותקן כבר לא קיים.",
  "error.marketplace.differentListing": "הסוכן המקומי הזה הותקן מסוכן אחר בחנות.",
  "error.marketplace.marketplaceAvatarInvalid": "הדמות של הסוכן בחנות אינה תקינה.",
  "error.marketplace.shareCardInvalid": "כרטיס השיתוף אינו תקין.",
  "error.marketplace.cannotPublish": "אי אפשר לפרסם את הסוכן הזה.",
  "error.marketplace.templateName": {
    one: "יש לתת לסוכן שם של תו אחד.",
    two: "יש לתת לסוכן שם של 1 עד 2 תווים.",
    other: "יש לתת לסוכן שם של 1 עד {count} תווים.",
  },
  "error.marketplace.templateRole": {
    one: "התפקיד ארוך מתו אחד. יש לקצר אותו.",
    two: "התפקיד ארוך משני תווים. יש לקצר אותו.",
    other: "התפקיד ארוך מ-{count} תווים. יש לקצר אותו.",
  },
  "error.marketplace.templateNoInstructions": "יש להוסיף הנחיות לסוכן לפני הפרסום.",
  "error.marketplace.templateInstructions": {
    one: "ההנחיות ארוכות מתו אחד. יש לקצר אותן.",
    two: "ההנחיות ארוכות משני תווים. יש לקצר אותן.",
    other: "ההנחיות ארוכות מ-{count} תווים. יש לקצר אותן.",
  },
  "error.marketplace.templateAvatar": "הדמות של הסוכן אינה תקינה. יש לבחור אותה מחדש בהגדרות הסוכן.",
  "error.marketplace.templateSkills": {
    one: "סוכן יכול לפרסם מיומנות אחת לכל היותר. יש להסיר חלק מהן.",
    two: "סוכן יכול לפרסם שתי מיומנויות לכל היותר. יש להסיר חלק מהן.",
    other: "סוכן יכול לפרסם עד {count} מיומנויות. יש להסיר חלק מהן.",
  },
  "error.marketplace.templateLocalSkills": {
    one: "סוכן יכול לפרסם מיומנות מקומית אחת לכל היותר. יש להסיר חלק מהן.",
    two: "סוכן יכול לפרסם שתי מיומנויות מקומיות לכל היותר. יש להסיר חלק מהן.",
    other: "סוכן יכול לפרסם עד {count} מיומנויות מקומיות. יש להסיר חלק מהן.",
  },
  "error.marketplace.templateSkill": 'אי אפשר לפרסם את המיומנות "{name}". יש לבדוק את השם שלה ואת SKILL.md.',
  "error.marketplace.templateRoutines": {
    one: "סוכן יכול לפרסם שגרה אחת לכל היותר. יש להסיר חלק מהן.",
    two: "סוכן יכול לפרסם שתי שגרות לכל היותר. יש להסיר חלק מהן.",
    other: "סוכן יכול לפרסם עד {count} שגרות. יש להסיר חלק מהן.",
  },
  "error.marketplace.templateRoutine": {
    one: 'השגרה "{name}" צריכה שם של תו אחד לכל היותר והנחיה.',
    two: 'השגרה "{name}" צריכה שם של שני תווים לכל היותר והנחיה.',
    other: 'השגרה "{name}" צריכה שם של עד {count} תווים והנחיה.',
  },
  "error.marketplace.templateRoutineNoName": "ללא שם",
  "error.marketplace.templateTooLarge": "הסוכן גדול מדי לפרסום. יש לקצר את ההנחיות, המיומנויות או השגרות שלו.",
  "error.marketplace.linkInvalid": "הקישור לסוכן אינו תקין.",
  "error.marketplace.changedSinceOpened": "הסוכן השתנה אחרי שנפתח. יש לפתוח את הקישור שוב כדי לבדוק את הגרסה החדשה.",
  "error.marketplace.skillNameConflict":
    'כבר יש לך מיומנות מקומית אחרת בשם "{name}". יש לשנות את שמה או להסיר אותה, ואז להוסיף את הסוכן שוב.',
  "error.marketplace.avatarInvalid": "הדמות של הסוכן אינה תקינה.",
  "error.marketplace.secretInName": "יש להסיר את הסוד או כתובת האימייל מהשם לפני הפרסום.",
  "error.marketplace.secretInTitle": "יש להסיר את הסוד או כתובת האימייל מהכותרת לפני הפרסום.",
  "error.marketplace.secretInInstructions": "יש להסיר את הסוד או כתובת האימייל מההנחיות לפני הפרסום.",
  "error.marketplace.secretInRoutine": 'יש להסיר את הסוד או כתובת האימייל מהשגרה "{name}" לפני הפרסום.',
  "error.marketplace.secretInSkill": 'יש להסיר את הסוד או כתובת האימייל מהמיומנות "{name}" לפני הפרסום.',
  "error.marketplace.catalogLoadFailed": "לא ניתן לטעון את החנות. יש לנסות שוב.",
  "error.marketplace.templateUnreadable": "לא ניתן לקרוא את הסוכן המשותף. ייתכן שהבעלים הסיר אותו.",
} as const satisfies PartialTranslation<typeof source>;
