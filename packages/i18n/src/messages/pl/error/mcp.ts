import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/mcp";

export const messages = {
  "error.mcp.redirectByName": "Ten adres nie jest osiągalny po nazwie.",
  "error.mcp.redirectGetOnly": "Ten adres odpowiada tylko na GET.",
  "error.mcp.redirectNotSignIn": "Ten adres nie jest częścią logowania.",
  "error.mcp.redirectRefused": "Logowanie zostało odrzucone. Wróć do OpenBot i spróbuj ponownie.",
  "error.mcp.redirectNoSignIn": "Żadne logowanie nie czeka na ten adres. Mogło się już zakończyć.",
  "error.mcp.redirectSignedIn": "OpenBot jest zalogowany. Możesz zamknąć to okno.",
  "error.mcp.signInFileUnreadable": "Nie można odczytać pliku logowania MCP.",
  "error.mcp.signInFileTooLarge": "Plik logowania MCP jest za duży.",
  "error.mcp.unsupported": "Ten serwer nie obsługuje serwerów MCP.",
  "error.mcp.signInOnHost": "Logowanie do serwera MCP działa tylko w OpenBot na komputerze hosta.",
} as const satisfies PartialTranslation<typeof source>;
