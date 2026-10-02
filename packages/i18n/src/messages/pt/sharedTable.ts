import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/sharedTable";

export const messages = {
  "sharedTable.title": "Tabelas",
  "sharedTable.description":
    "O que os agentes mantêm entre tarefas, com o agente que iniciou cada conjunto de registros",
  "sharedTable.close": "Fechar tabelas",
  "sharedTable.loading": "Carregando tabelas…",
  "sharedTable.empty":
    "Nenhuma tabela ainda. Um agente cria uma quando uma tarefa precisa manter registros entre interações, e todos os agentes podem usá-la.",
  "sharedTable.loadFailed": "Não foi possível carregar as tabelas.",
  "sharedTable.deleteFailed": "Não foi possível excluir.",
  "sharedTable.madeOutside": "Criada fora do OpenBot · qualquer agente pode excluí-la",
  "sharedTable.keptBy": "Mantida por {name}",
  "sharedTable.keptByDeleted": "Mantida por um agente que não existe mais",
  "sharedTable.deleteName": "Excluir {name}",
  "sharedTable.confirmDelete": "Excluir para todos os agentes? Os registros não poderão ser recuperados.",
  "sharedTable.notCounted": "não contados",
  "sharedTable.records": { one: "{count} registro", other: "{count} registros" },
} as const satisfies PartialTranslation<typeof source>;
