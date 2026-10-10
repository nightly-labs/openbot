import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/preview";

export const messages = {
  "preview.panel.label": "Prévia do arquivo",
  "preview.panel.resize": "Redimensionar prévia do arquivo",
  "preview.panel.copy": "Copiar texto do arquivo",
  "preview.panel.openExternally": "Abrir arquivo externamente",
  "preview.panel.download": "Baixar arquivo",
  "preview.panel.reveal": "Mostrar arquivo no Finder",
  "preview.panel.close": "Fechar prévia do arquivo",
  "preview.panel.back": "Voltar",
  "preview.panel.rawMarkdown": "Mostrar código Markdown",
  "preview.panel.rawHtml": "Mostrar código HTML",
  "preview.panel.wrapLines": "Quebrar linhas longas",
  "preview.folder.empty": "Esta pasta está vazia.",
  "preview.folder.truncated": "Somente os primeiros {limit} itens são mostrados.",
  "preview.truncated": "Prévia truncada após {limit} caracteres.",
  "preview.unavailable": "Prévia indisponível.",
  "preview.unsupported.title": "Prévia indisponível",
  "preview.unsupported.description": "Este tipo de arquivo pode ser aberto no aplicativo padrão.",
  "preview.unsupported.openExternally": "Abrir externamente",
  "preview.spreadsheet.readFailed": "Não foi possível ler esta planilha.",
  "preview.spreadsheet.truncated": "Prévia limitada às primeiras {rows} linhas e {columns} colunas.",
} as const satisfies PartialTranslation<typeof source>;
