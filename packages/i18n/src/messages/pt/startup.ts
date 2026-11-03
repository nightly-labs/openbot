import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/startup";

export const messages = {
  "startup.failedTitle": "O OpenBot não conseguiu iniciar",
  "startup.failedBody":
    "{message}\n\nSeus dados locais não foram redefinidos nem sobrescritos. Consulte o guia de solução de problemas para ver os passos de recuperação.",
  "startup.archiveChangedTitle": "Arquivos do OpenBot foram alterados",
  "startup.archiveChangedBody":
    "Outro programa alterou o arquivo app.asar do OpenBot. O OpenBot funciona agora, mas não vai abrir depois que você fechá-lo.\n\nPara reparar, instale o OpenBot novamente. Seus dados locais são mantidos.",
  "startup.archiveChangedDownload": "Baixar OpenBot",
} as const satisfies PartialTranslation<typeof source>;
