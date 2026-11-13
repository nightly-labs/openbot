import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/mcp";

export const messages = {
  "error.mcp.redirectByName": "Ten adres nie jest osiągalny po nazwie.",
  "error.mcp.redirectNotSignIn": "Ten adres nie jest częścią logowania.",
  "error.mcp.redirectRefused": "Logowanie zostało odrzucone. Wróć do OpenBot i spróbuj ponownie.",
  "error.mcp.redirectNoSignIn": "Żadne logowanie nie czeka na ten adres. Mogło się już zakończyć.",
  "error.mcp.redirectSignedIn": "OpenBot jest zalogowany. Możesz zamknąć to okno.",
  "error.mcp.signInFileUnreadable": "Nie można odczytać pliku logowania MCP.",
  "error.mcp.signInFileTooLarge": "Plik logowania MCP jest za duży.",
  "error.mcp.unsupported": "Ten serwer nie obsługuje serwerów MCP.",
  "error.mcp.signInOnHost": "Logowanie do serwera MCP działa tylko w OpenBot na komputerze hosta.",
  "error.mcp.signInAppUnsupported": "Ten serwer nie obsługuje aplikacji logowania. Zaktualizuj OpenBot na hoście.",
  "error.mcp.redirectRelayed": "OpenBot wysłał logowanie do serwera. Możesz zamknąć to okno.",
  "error.mcp.relayEnded": "To logowanie się zakończyło. Rozpocznij je ponownie.",
  "error.mcp.relayNoState":
    "Strona logowania serwera nie chroni swojego adresu powrotu, więc OpenBot nie otworzy jej na tym komputerze.",
  "error.mcp.relayAddressInvalid": "To nie jest adres z końca tego logowania. Skopiuj pełny adres z przeglądarki.",
} as const satisfies PartialTranslation<typeof source>;
