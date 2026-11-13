import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/menu";

export const messages = {
  // The native application menu. Electron localizes its own `role:` entries from the operating
  // system, so only the custom items are here. A role's label does not follow the app language, so
  // the chat's right-click edit menu takes its labels from here.
  "menu.stopAllAgents": "Dừng mọi trợ lý",
  "menu.checkForUpdates": "Kiểm tra cập nhật…",
  "menu.preferences": "Cài đặt…",
  "menu.actualSize": "Kích thước thật",
  "menu.zoomIn": "Phóng to",
  "menu.zoomOut": "Thu nhỏ",
  "menu.copyLink": "Sao chép liên kết",
  "menu.quit": "Thoát OpenBot",
  "menu.quitConfirmTitle": "Thoát OpenBot?",
  "menu.quitConfirmBody": "Trợ lý và nhiệm vụ định kỳ sẽ dừng cho tới khi bạn mở lại OpenBot.",
  "menu.quitConfirm": "Thoát",
  "menu.quitHint": "Giữ ⌘Q hoặc nhấn hai lần để thoát",
  "menu.trayOpen": "Mở OpenBot",
  "menu.trayQuit": "Thoát OpenBot",
  "menu.trayTooltip": "OpenBot",
  "menu.undo": "Hoàn tác",
  "menu.redo": "Làm lại",
  "menu.cut": "Cắt",
  "menu.copy": "Sao chép",
  "menu.paste": "Dán",
  "menu.pasteAndMatchStyle": "Dán và giữ định dạng",
  "menu.delete": "Xóa",
  "menu.selectAll": "Chọn tất cả",
} as const satisfies PartialTranslation<typeof source>;
