import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/mcp";

export const messages = {
  // MCP oturum açma hataları ve tarayıcıdaki oturum açma sayfası.
  "error.mcp.redirectByName": "Bu adrese adıyla ulaşılamıyor.",
  "error.mcp.redirectNotSignIn": "Bu adres bir oturum açma işleminin parçası değil.",
  "error.mcp.redirectRefused": "Oturum açma reddedildi. OpenBot'a geri dönün ve tekrar deneyin.",
  "error.mcp.redirectNoSignIn": "Bunun için bekleyen bir oturum açma işlemi yok. Sona ermiş olabilir.",
  "error.mcp.redirectSignedIn": "OpenBot oturumu açıldı. Bu pencereyi kapatabilirsiniz.",
  "error.mcp.signInFileUnreadable": "MCP oturum açma dosyası okunamıyor.",
  "error.mcp.signInFileTooLarge": "MCP oturum açma dosyası çok büyük.",
  "error.mcp.unsupported": "MCP sunucuları bu sunucu tarafından desteklenmiyor.",
  "error.mcp.signInOnHost": "Bir MCP sunucusunda oturum açma yalnızca ana makinedeki OpenBot'ta çalışır.",
  "error.mcp.signInAppUnsupported":
    "Bu sunucu oturum açma uygulamalarını desteklemiyor. Ana makinedeki OpenBot'u güncelleyin.",
  "error.mcp.redirectRelayed": "OpenBot oturum açmayı sunucuya gönderdi. Bu pencereyi kapatabilirsiniz.",
  "error.mcp.relayEnded": "Bu oturum açma sona erdi. Yeniden başlatın.",
  "error.mcp.relayNoState":
    "Sunucunun oturum açma sayfası dönüş adresini korumuyor, bu yüzden OpenBot onu bu bilgisayarda açmaz.",
  "error.mcp.relayAddressInvalid": "Bu, bu oturum açmanın sonundaki adres değil. Tarayıcıdan tam adresi kopyalayın.",
} as const satisfies PartialTranslation<typeof source>;
