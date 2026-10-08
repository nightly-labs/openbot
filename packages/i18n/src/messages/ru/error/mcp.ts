import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/mcp";

export const messages = {
  "error.mcp.redirectByName": "Этот адрес недоступен по имени.",
  "error.mcp.redirectGetOnly": "Этот адрес отвечает только на GET.",
  "error.mcp.redirectNotSignIn": "Этот адрес не относится ко входу.",
  "error.mcp.redirectRefused": "Вход отклонён. Вернитесь в OpenBot и повторите попытку.",
  "error.mcp.redirectNoSignIn": "Нет входа, который ждал бы этого. Возможно, он уже завершён.",
  "error.mcp.redirectSignedIn": "Вход в OpenBot выполнен. Это окно можно закрыть.",
  "error.mcp.signInFileUnreadable": "Файл входа MCP не читается.",
  "error.mcp.signInFileTooLarge": "Файл входа MCP слишком большой.",
  "error.mcp.unsupported": "Этот сервер не поддерживает серверы MCP.",
  "error.mcp.signInOnHost": "Войти в сервер MCP можно только в OpenBot на компьютере-хосте.",
} as const satisfies PartialTranslation<typeof source>;
