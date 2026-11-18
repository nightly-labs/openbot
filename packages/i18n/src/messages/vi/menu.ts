import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/menu";

export const messages = {
  "menu.stopAllAgents": "Dừng tất cả agent",
  "menu.checkForUpdates": "Kiểm tra bản cập nhật…",
  "menu.preferences": "Cài đặt…",
  "menu.actualSize": "Kích thước thực",
  "menu.zoomIn": "Phóng to",
  "menu.zoomOut": "Thu nhỏ",
  "menu.copyLink": "Sao chép liên kết",
  "menu.copyImage": "Sao chép hình ảnh",
  "menu.quit": "Thoát OpenBot",
  "menu.quitConfirmTitle": "Thoát OpenBot?",
  "menu.quitConfirmBody": "Các agent và tác vụ định kỳ sẽ dừng cho đến khi bạn mở lại OpenBot.",
  "menu.quitConfirm": "Thoát",
  "menu.quitHint": "Giữ ⌘Q hoặc nhấn hai lần để thoát",
  "menu.closeWorkingTitle": { one: "{count} agent vẫn đang làm việc", other: "{count} agent vẫn đang làm việc" },
  "menu.closeWorkingBody":
    "Nếu bạn thoát OpenBot, các agent sẽ dừng. Hãy để ứng dụng tiếp tục chạy để chúng hoàn thành. Để hiện lại cửa sổ, hãy mở OpenBot.",
  "menu.closeKeepRunning": "Tiếp tục chạy",
  "menu.trayOpen": "Mở OpenBot",
  "menu.trayQuit": "Thoát OpenBot",
  "menu.trayTooltip": "OpenBot",
  "menu.hideDynamicIsland": "Ẩn Dynamic Island",
  "menu.undo": "Hoàn tác",
  "menu.redo": "Làm lại",
  "menu.cut": "Cắt",
  "menu.copy": "Sao chép",
  "menu.paste": "Dán",
  "menu.pasteAndMatchStyle": "Dán và khớp kiểu",
  "menu.delete": "Xóa",
  "menu.selectAll": "Chọn tất cả",
} as const satisfies PartialTranslation<typeof source>;
