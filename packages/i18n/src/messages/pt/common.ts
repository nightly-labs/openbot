import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/common";

export const messages = {
  "common.cancel": "Cancelar",
  "common.save": "Salvar",
  "common.close": "Fechar",
  "common.delete": "Excluir",
  "common.remove": "Remover",
  "common.edit": "Editar",
  "common.rename": "Renomear",
  "common.retry": "Tentar novamente",
  "common.copy": "Copiar",
  "common.copied": "Copiado",
  "common.done": "Concluído",
  "common.back": "Voltar",
  "common.continue": "Continuar",
  "common.add": "Adicionar",
  "common.create": "Criar",
  "common.open": "Abrir",
  "common.search": "Buscar",
  "common.loading": "Carregando…",
  "common.saving": "Salvando…",
  "common.tryAgain": "Tente novamente",
  "common.connecting": "Conectando…",
  "common.download": "Baixar",
  "common.removing": "Removendo…",
  "common.sending": "Enviando…",
} as const satisfies PartialTranslation<typeof source>;
