import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/update";

export const messages = {
  // The app update button in Settings, one label for each updater phase.
  "update.action.check": "Kiểm tra cập nhật",
  "update.action.checking": "Đang kiểm tra cập nhật…",
  "update.action.download": "Tải bản cập nhật xuống",
  "update.action.downloading": "Đang tải bản cập nhật…",
  "update.action.restart": "Khởi động lại để cập nhật",
  "update.action.restarting": "Đang khởi động lại…",
  "update.action.retryDownload": "Thử tải xuống lại",
  "update.managedByHost": "Do máy tính quản lý",
  "update.upToDate": "Mới nhất",

  // The provider CLI update notification.
  "update.provider.update": "Cập nhật",
  "update.provider.upToDate": "{name} đã là bản mới nhất",
  "update.provider.checking": "Đang kiểm tra cập nhật cho {name}",
  "update.provider.available": "Có bản cập nhật cho {name}",
  "update.provider.updating": "Đang cập nhật {name}",
  "update.provider.waiting": "Đang chờ cập nhật {name}",
  "update.provider.failed": "Cập nhật {name} thất bại",
  "update.provider.settingUp": "Đang thiết lập",
  "update.provider.failedRetry": "Cập nhật thất bại. Hãy thử lại.",
  "update.provider.unknownVersion": "phiên bản không xác định",
  "update.provider.remoteHost": "Cập nhật CLI của nhà cung cấp chạy trên máy tính đang chạy nó.",
  "update.provider.unavailable": "Không thể cập nhật nhà cung cấp.",
  "update.provider.downloadsUnavailable": "Không thể tải xuống cho nhà cung cấp.",
  "update.provider.startFailed": "Không thể bắt đầu cập nhật. Hãy thử lại.",
  "update.provider.showDetails": "Hiện chi tiết",
  "update.provider.hideDetails": "Ẩn chi tiết",

  // An update that an admin of this server asked for. {name} is the admin.
  "update.scheduled.title": "{name} đã lên lịch cập nhật OpenBot",
  // The same notice when "Install updates automatically" scheduled the restart.
  "update.scheduled.automaticTitle": "OpenBot đang cài một bản cập nhật",
  "update.scheduled.whenIdle": "OpenBot khởi động lại khi các trợ lý không bận.",
  "update.scheduled.now": "OpenBot khởi động lại khi bản cập nhật được tải xuống.",
  "update.scheduled.cancel": "Hủy cập nhật",
  "update.scheduled.cancelFailed": "Không thể hủy bản cập nhật.",

  // A restart that the user of this computer asked for. It waits until no work runs.
  "update.idleRestart.relaunchTitle": "OpenBot khởi động lại khi các trợ lý không bận",
  "update.idleRestart.updateTitle": "OpenBot cài bản cập nhật khi các trợ lý không bận",
  "update.idleRestart.description": "Các lần chạy nhiệm vụ định kỳ mới phải chờ tới khi khởi động lại.",
  "update.idleRestart.waitingFor": "Đang chờ {reasons}.",
  "update.idleRestart.cancel": "Hủy khởi động lại",
  "update.idleRestart.cancelFailed": "Không thể hủy việc khởi động lại.",
  "update.idleRestart.requestFailed": "Không thể lên lịch khởi động lại.",
  "update.idleRestart.failedTitle": "OpenBot không khởi động lại",

  // The "What's new" dialog after an app update.
  "update.whatsNew.title": "Có gì mới trong OpenBot",
  "update.whatsNew.description": "Tính năng mới và thay đổi trong phiên bản OpenBot này.",
  "update.whatsNew.version": "Phiên bản {version}",
  "update.whatsNew.updatedFrom": "Cập nhật từ {from} lên {to}",
  "update.whatsNew.group.added": "Mới",
  "update.whatsNew.group.changed": "Cải thiện",
  "update.whatsNew.group.fixed": "Đã sửa",
  "update.whatsNew.notices": "Hãy làm việc này sau khi cập nhật",
  "update.whatsNew.showFixes": { other: "Hiện {count} bản sửa" },
  "update.whatsNew.hideFixes": "Ẩn các bản sửa",
  "update.whatsNew.loading": "Đang tải ghi chú phát hành…",
  "update.whatsNew.failed.title": "Không tải được ghi chú phát hành",
  "update.whatsNew.failed.body":
    "Hãy chắc chắn bạn đang có kết nối mạng rồi thử lại. Toàn bộ nhật ký thay đổi cũng hiển thị mọi thay đổi.",
  "update.whatsNew.empty.title": "Phiên bản này không có tính năng mới",
  "update.whatsNew.empty.body":
    "Phiên bản này không có ghi chú để hiển thị ở đây. Toàn bộ nhật ký thay đổi hiển thị mọi thay đổi.",
  "update.whatsNew.changelog": "Toàn bộ nhật ký thay đổi",
  "update.whatsNew.changelogFailed": "OpenBot không thể mở nhật ký thay đổi.",
  "update.whatsNew.done": "Đã hiểu",
} as const satisfies PartialTranslation<typeof source>;
