import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/mcp";

export const messages = {
  "error.mcp.redirectByName": "No se puede acceder a esta dirección por nombre.",
  "error.mcp.redirectGetOnly": "Esta dirección solo responde a GET.",
  "error.mcp.redirectNotSignIn": "Esta dirección no forma parte de un inicio de sesión.",
  "error.mcp.redirectRefused": "Se rechazó el inicio de sesión. Vuelve a OpenBot e inténtalo de nuevo.",
  "error.mcp.redirectNoSignIn": "Ningún inicio de sesión está esperando esto. Es posible que haya terminado.",
  "error.mcp.redirectSignedIn": "OpenBot ha iniciado sesión. Puedes cerrar esta ventana.",
  "error.mcp.signInFileUnreadable": "El archivo de inicio de sesión de MCP no se puede leer.",
  "error.mcp.signInFileTooLarge": "El archivo de inicio de sesión de MCP es demasiado grande.",
  "error.mcp.unsupported": "Este servidor no admite servidores MCP.",
} as const satisfies PartialTranslation<typeof source>;
