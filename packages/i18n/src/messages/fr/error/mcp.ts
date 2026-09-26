import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/mcp";

export const messages = {
  // MCP sign-in errors, and the sign-in page in the browser.
  "error.mcp.redirectByName": "Cette adresse n’est pas accessible par un nom.",
  "error.mcp.redirectGetOnly": "Cette adresse répond uniquement aux requêtes GET.",
  "error.mcp.redirectNotSignIn": "Cette adresse ne fait pas partie d’une connexion.",
  "error.mcp.redirectRefused": "La connexion a été refusée. Revenez à OpenBot, puis réessayez.",
  "error.mcp.redirectNoSignIn": "Aucune connexion n’attend cette réponse. Elle est peut-être terminée.",
  "error.mcp.redirectSignedIn": "OpenBot est connecté. Vous pouvez fermer cette fenêtre.",
  "error.mcp.signInFileUnreadable": "Impossible de lire le fichier de connexion MCP.",
  "error.mcp.signInFileTooLarge": "Le fichier de connexion MCP est trop volumineux.",
  "error.mcp.unsupported": "Ce serveur ne prend pas en charge les serveurs MCP.",
} as const satisfies PartialTranslation<typeof source>;
