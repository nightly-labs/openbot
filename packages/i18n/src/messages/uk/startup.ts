import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/startup";

export const messages = {
  "startup.failedTitle": "OpenBot не вдалося запустити",
  "startup.failedBody":
    "{message}\n\nЛокальні дані не скинуто й не перезаписано. Кроки відновлення — у посібнику з усунення несправностей.",
} as const satisfies PartialTranslation<typeof source>;
