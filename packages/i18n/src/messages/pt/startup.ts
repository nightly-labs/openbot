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
  "startup.newerDataUpdatingTitle": "Atualizando o OpenBot",
  "startup.newerDataUpdatingBody":
    "Uma versão mais recente do OpenBot salvou seus dados. O OpenBot instala a versão mais recente e depois abre de novo.\n\nSeus dados locais não foram redefinidos nem substituídos.",
  "startup.newerDataTitle": "Instale o OpenBot mais recente",
  "startup.newerDataBody":
    "Uma versão mais recente do OpenBot salvou seus dados, e esta versão ({version}) não consegue abri-los. Instale a versão mais recente para abrir seus dados.\n\nSeus dados locais não foram redefinidos nem substituídos.",
  "startup.newerDataDownload": "Baixar OpenBot",
  "startup.newerDataGuide": "Abrir guia",
  "startup.newerDataQuit": "Sair",
  "startup.recoveryWindowTitle": "Recuperação do OpenBot",
  "startup.recoveryTitle": "O OpenBot não abriu",
  "startup.recoveryBody": {
    one: "O OpenBot {version} parou antes de abrir, {count} vez seguida. Seus dados locais não foram redefinidos nem substituídos.",
    other:
      "O OpenBot {version} parou antes de abrir, {count} vezes seguidas. Seus dados locais não foram redefinidos nem substituídos.",
  },
  "startup.recoveryHint":
    "Tente novamente ou instale a última versão que abriu. Para obter ajuda, exporte o diagnóstico e envie o arquivo com seu relato.",
  "startup.recoveryRetry": "Tentar de novo",
  "startup.recoveryPreviousVersion": "Baixar versão anterior",
  "startup.recoveryExportDiagnostics": "Exportar diagnóstico",
  "startup.recoveryOpenDataFolder": "Abrir pasta de dados",
  "startup.recoveryQuit": "Sair",
  "startup.recoveryDiagnosticsSaved": "O arquivo de diagnóstico foi salvo.",
  "startup.recoveryActionFailed": "O OpenBot não conseguiu fazer esta ação.",
} as const satisfies PartialTranslation<typeof source>;
