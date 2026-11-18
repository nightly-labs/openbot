import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/status/remote";

export const messages = {
  "status.remote.setupMacOnly": "הגדרת ההרשאות זמינה ב-macOS.",
  "status.remote.setupInstallHost": "יש להתקין את רכיב המארח של שולחן העבודה המרוחק ולבדוק שוב.",
  "status.remote.setupUpdateRuntime": "יש לעדכן את סביבת ההרצה של שולחן העבודה המרוחק כדי לבדוק הרשאות של macOS.",
  "status.remote.setupCheckFailed": "Sunshine לא הצליח להשלים את בדיקת ההרשאות. יש לבדוק את הסשן של המארח ולנסות שוב.",
  "status.remote.setupServiceFailed":
    "שירות שולחן העבודה המרוחק לא הצליח להתחיל. יש לוודא שלמשתמש ה-macOS הזה יש סשן גרפי פעיל.",
  "status.remote.connectingSunshine": "מתחבר דרך Sunshine…",
  "status.remote.switchingMonitor": "מחליף את המסך המשותף…",
  "status.remote.controlConnected": "השליטה מרחוק מחוברת.",
  "status.remote.controlFailed": "השליטה מרחוק נכשלה.",
  "status.remote.stagePreferences": "טוען העדפות צ'אט מקומיות: {reason}",
  "status.remote.stageConnection": "מתחבר למחשב: {reason}",
  "status.remote.stageCompatibility": "בודק תאימות של המחשב: {reason}",
  "status.remote.stageAgents": "טוען סוכנים: {reason}",
  "status.remote.stageReads": "טוען מצב קריאה: {reason}",
  "status.remote.suspendedDetail": "יש לעדכן את OpenBot Mobile או את אפליקציית המחשב לפני ההתחברות.\n{detail}",
  "status.remote.cooldownDetail":
    "ההתחברות נכשלה אחרי {limit} ניסיונות. ניסיון נוסף בעוד {minutes}:{seconds}.\n{detail}",
  "status.remote.cooldown": "ההתחברות נכשלה אחרי {limit} ניסיונות. ניסיון נוסף בעוד {minutes}:{seconds}.",
  "status.remote.connectionLostDetail": {
    one: "החיבור אבד. ניסיון נוסף בעוד שנייה אחת.\n{detail}",
    two: "החיבור אבד. ניסיון נוסף בעוד שתי שניות.\n{detail}",
    other: "החיבור אבד. ניסיון נוסף בעוד {count} שניות.\n{detail}",
  },
  "status.remote.connectionLost": {
    one: "החיבור אבד. ניסיון נוסף בעוד שנייה אחת.",
    two: "החיבור אבד. ניסיון נוסף בעוד שתי שניות.",
    other: "החיבור אבד. ניסיון נוסף בעוד {count} שניות.",
  },
  "status.remote.attemptFailedDetail": {
    one: "ניסיון ההתחברות נכשל. ניסיון נוסף בעוד שנייה אחת.\n{detail}",
    two: "ניסיון ההתחברות נכשל. ניסיון נוסף בעוד שתי שניות.\n{detail}",
    other: "ניסיון ההתחברות נכשל. ניסיון נוסף בעוד {count} שניות.\n{detail}",
  },
  "status.remote.attemptFailed": {
    one: "ניסיון ההתחברות נכשל. ניסיון נוסף בעוד שנייה אחת.",
    two: "ניסיון ההתחברות נכשל. ניסיון נוסף בעוד שתי שניות.",
    other: "ניסיון ההתחברות נכשל. ניסיון נוסף בעוד {count} שניות.",
  },
  "status.remote.reconnectingDetail": {
    one: "מתחבר מחדש {attempt}/{count}\n{detail}",
    two: "מתחבר מחדש {attempt}/{count}\n{detail}",
    other: "מתחבר מחדש {attempt}/{count}\n{detail}",
  },
  "status.remote.reconnecting": {
    one: "מתחבר מחדש {attempt}/{count}",
    two: "מתחבר מחדש {attempt}/{count}",
    other: "מתחבר מחדש {attempt}/{count}",
  },
  "status.remote.messageCut":
    "[{size} MB מההודעה הזו אינם מוצגים במכשיר הזה. יש לפתוח אותה במחשב שמריץ את השרת כדי לקרוא את כולה.]",
} as const satisfies PartialTranslation<typeof source>;
