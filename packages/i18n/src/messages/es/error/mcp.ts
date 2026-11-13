import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/mcp";

export const messages = {
  "error.mcp.redirectByName": "No se puede acceder a esta dirección por nombre.",
  "error.mcp.redirectNotSignIn": "Esta dirección no forma parte de un inicio de sesión.",
  "error.mcp.redirectRefused": "Se rechazó el inicio de sesión. Vuelve a OpenBot e inténtalo de nuevo.",
  "error.mcp.redirectNoSignIn": "Ningún inicio de sesión está esperando esto. Es posible que haya terminado.",
  "error.mcp.redirectSignedIn": "OpenBot ha iniciado sesión. Puedes cerrar esta ventana.",
  "error.mcp.signInFileUnreadable": "El archivo de inicio de sesión de MCP no se puede leer.",
  "error.mcp.signInFileTooLarge": "El archivo de inicio de sesión de MCP es demasiado grande.",
  "error.mcp.unsupported": "Este servidor no admite servidores MCP.",
  "error.mcp.signInOnHost": "Solo puedes iniciar sesión en un servidor MCP desde OpenBot en el equipo host.",
  "error.mcp.signInAppUnsupported": "Este servidor no admite apps de inicio de sesión. Actualiza OpenBot en el host.",
  "error.mcp.redirectRelayed": "OpenBot envió el inicio de sesión al servidor. Puedes cerrar esta ventana.",
  "error.mcp.relayEnded": "Este inicio de sesión terminó. Vuelve a iniciarlo.",
  "error.mcp.relayNoState":
    "La página de inicio de sesión del servidor no protege su dirección de retorno, así que OpenBot no la abre en este equipo.",
  "error.mcp.relayAddressInvalid":
    "Esta no es la dirección del final de este inicio de sesión. Copia la dirección completa del navegador.",
} as const satisfies PartialTranslation<typeof source>;
