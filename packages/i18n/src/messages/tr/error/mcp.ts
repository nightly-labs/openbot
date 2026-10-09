import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/mcp";

export const messages = {
  // MCP oturum açma hataları ve tarayıcıdaki oturum açma sayfası.
  "error.mcp.redirectByName": "Bu adrese adıyla ulaşılamıyor.",
  "error.mcp.redirectGetOnly": "Bu adres yalnızca GET isteklerine yanıt verir.",
  "error.mcp.redirectNotSignIn": "Bu adres bir oturum açma işleminin parçası değil.",
  "error.mcp.redirectRefused": "Oturum açma reddedildi. OpenBot'a geri dönün ve tekrar deneyin.",
  "error.mcp.redirectNoSignIn": "Bunun için bekleyen bir oturum açma işlemi yok. Sona ermiş olabilir.",
  "error.mcp.redirectSignedIn": "OpenBot oturumu açıldı. Bu pencereyi kapatabilirsiniz.",
  "error.mcp.signInFileUnreadable": "MCP oturum açma dosyası okunamıyor.",
  "error.mcp.signInFileTooLarge": "MCP oturum açma dosyası çok büyük.",
  "error.mcp.unsupported": "MCP sunucuları bu sunucu tarafından desteklenmiyor.",
  "error.mcp.signInOnHost": "Bir MCP sunucusunda oturum açma yalnızca ana bilgisayardaki OpenBot'ta çalışır.",
} as const satisfies PartialTranslation<typeof source>;
