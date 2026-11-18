import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/attachment";

export const messages = {
  "error.attachment.notFound": "הקובץ המצורף לא נמצא.",
  "error.attachment.fileTooLarge": "קובץ חורג ממגבלת 100 MB.",
  "error.attachment.totalTooLarge": "הקבצים המצורפים חורגים ממגבלת הסך הכול של 250 MB.",
  "error.attachment.unavailable": "הקובץ הזה כבר אינו זמין.",
  "error.attachment.tooMany": "אפשר לבחור עד {limit} קבצים.",
  "error.attachment.mediaUnsupported":
    "השרת הזה אינו תומך בקבצים מצורפים מסוג MP3 או MOV. יש לעדכן את OpenBot במארח ולנסות שוב.",
  "error.attachment.emlUnsupported":
    "השרת הזה אינו תומך בקבצים מצורפים מסוג EML. יש לעדכן את OpenBot במארח ולנסות שוב.",
  "error.attachment.zipUnsupported":
    "השרת הזה אינו תומך בקבצים מצורפים מסוג ZIP. יש לעדכן את OpenBot במארח ולנסות שוב.",
  "error.attachment.mp4Unsupported":
    "השרת הזה אינו תומך בקבצים מצורפים מסוג MP4. יש לעדכן את OpenBot במארח ולנסות שוב.",
  "error.attachment.svgUnsupported":
    "השרת הזה אינו תומך בקבצים מצורפים מסוג SVG. יש לעדכן את OpenBot במארח ולנסות שוב.",
  "error.attachment.previewTooLarge": "הקובץ חורג ממגבלת 100 MB.",
} as const satisfies PartialTranslation<typeof source>;
