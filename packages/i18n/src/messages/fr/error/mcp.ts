import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/mcp";

export const messages = {
  // MCP sign-in errors, and the sign-in page in the browser.
  "error.mcp.redirectByName": "Cette adresse n’est pas accessible par un nom.",
  "error.mcp.redirectNotSignIn": "Cette adresse ne fait pas partie d’une connexion.",
  "error.mcp.redirectRefused": "La connexion a été refusée. Revenez à OpenBot, puis réessayez.",
  "error.mcp.redirectNoSignIn": "Aucune connexion n’attend cette réponse. Elle est peut-être terminée.",
  "error.mcp.redirectSignedIn": "OpenBot est connecté. Vous pouvez fermer cette fenêtre.",
  "error.mcp.signInFileUnreadable": "Impossible de lire le fichier de connexion MCP.",
  "error.mcp.signInFileTooLarge": "Le fichier de connexion MCP est trop volumineux.",
  "error.mcp.unsupported": "Ce serveur ne prend pas en charge les serveurs MCP.",
  "error.mcp.signInOnHost": "La connexion à un serveur MCP ne fonctionne que dans OpenBot sur l’ordinateur hôte.",
  "error.mcp.signInAppUnsupported":
    "Ce serveur ne prend pas en charge les apps de connexion. Mettez à jour OpenBot sur l’hôte.",
  "error.mcp.redirectRelayed": "OpenBot a envoyé la connexion au serveur. Vous pouvez fermer cette fenêtre.",
  "error.mcp.relayEnded": "Cette connexion est terminée. Relancez-la.",
  "error.mcp.relayNoState":
    "La page de connexion du serveur ne protège pas son adresse de retour : OpenBot ne l’ouvre donc pas sur cet ordinateur.",
  "error.mcp.relayAddressInvalid":
    "Ce n’est pas l’adresse de fin de cette connexion. Copiez l’adresse complète depuis le navigateur.",
} as const satisfies PartialTranslation<typeof source>;
