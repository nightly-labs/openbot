import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/menu";

export const messages = {
  "menu.stopAllAgents": "Tüm ajanları durdur",
  "menu.checkForUpdates": "Güncellemeleri Denetle…",
  "menu.preferences": "Ayarlar…",
  "menu.actualSize": "Gerçek Boyut",
  "menu.zoomIn": "Yakınlaştır",
  "menu.zoomOut": "Uzaklaştır",
  "menu.copyLink": "Bağlantıyı Kopyala",
  "menu.copyImage": "Görüntüyü Kopyala",
  "menu.quit": "OpenBot'tan çık",
  "menu.quitConfirmTitle": "OpenBot'tan çıkılsın mı?",
  "menu.quitConfirmBody": "OpenBot'u yeniden açana kadar ajanlar ve rutinler durur.",
  "menu.quitConfirm": "Çık",
  "menu.quitHint": "Çıkmak için ⌘Q'yu basılı tutun veya iki kez basın",
  "menu.trayOpen": "OpenBot'u aç",
  "menu.trayQuit": "OpenBot'tan çık",
  "menu.trayTooltip": "OpenBot",
  "menu.undo": "Geri al",
  "menu.redo": "Yinele",
  "menu.cut": "Kes",
  "menu.copy": "Kopyala",
  "menu.paste": "Yapıştır",
  "menu.pasteAndMatchStyle": "Yapıştır ve stili eşleştir",
  "menu.delete": "Sil",
  "menu.selectAll": "Tümünü seç",
} as const satisfies PartialTranslation<typeof source>;
