import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/startup";

export const messages = {
  "startup.failedTitle": "OpenBot không thể khởi động",
  "startup.failedBody":
    "{message}\n\nDữ liệu cục bộ của bạn không bị đặt lại hay ghi đè. Xem hướng dẫn khắc phục sự cố để biết các bước khôi phục.",
  "startup.archiveChangedTitle": "Tệp của OpenBot đã bị thay đổi",
  "startup.archiveChangedBody":
    "Một chương trình khác đã thay đổi tệp app.asar của OpenBot. OpenBot vẫn đang chạy, nhưng sẽ không mở được sau khi bạn thoát.\n\nĐể sửa OpenBot, hãy cài đặt lại. Dữ liệu cục bộ của bạn vẫn được giữ nguyên.",
  "startup.archiveChangedDownload": "Tải xuống OpenBot",
  "startup.filesDamagedBody":
    "Một số tệp của OpenBot bị hỏng hoặc bị thiếu.\n\nĐể sửa OpenBot, hãy cài đặt lại. Dữ liệu cục bộ của bạn vẫn được giữ nguyên.",
  "startup.newerDataUpdatingTitle": "Đang cập nhật OpenBot",
  "startup.newerDataUpdatingBody":
    "Một phiên bản OpenBot mới hơn đã lưu dữ liệu của bạn. OpenBot sẽ cài đặt phiên bản mới nhất rồi mở lại.\n\nDữ liệu cục bộ của bạn không bị đặt lại hay ghi đè.",
  "startup.newerDataTitle": "Cài đặt OpenBot mới nhất",
  "startup.newerDataBody":
    "Một phiên bản OpenBot mới hơn đã lưu dữ liệu của bạn và phiên bản này ({version}) không thể mở dữ liệu đó. Hãy cài đặt phiên bản mới nhất để mở dữ liệu của bạn.\n\nDữ liệu cục bộ của bạn không bị đặt lại hay ghi đè.",
  "startup.newerDataDownload": "Tải xuống OpenBot",
  "startup.newerDataGuide": "Mở hướng dẫn",
  "startup.newerDataQuit": "Thoát",
  "startup.newerDataLoopTitle": "OpenBot mới nhất không mở được",
  "startup.newerDataLoopBody":
    "Một phiên bản OpenBot mới hơn đã lưu dữ liệu của bạn và phiên bản này ({version}) không thể mở dữ liệu đó. OpenBot {loopVersion} đã dừng trước khi mở nhiều lần liên tiếp nên sẽ không được cài đặt lại.\n\nHãy cài đặt phiên bản mới hơn {loopVersion} khi có. Để được trợ giúp, hãy mở hướng dẫn.\n\nDữ liệu cục bộ của bạn không bị đặt lại hay ghi đè.",
  "startup.newerDataReleases": "Xem các bản phát hành",
  "startup.recoveryWindowTitle": "Khôi phục OpenBot",
  "startup.recoveryTitle": "OpenBot không mở được",
  "startup.recoveryBody": {
    one: "OpenBot {version} đã dừng trước khi mở, {count} lần liên tiếp. Dữ liệu cục bộ của bạn không bị đặt lại hay ghi đè.",
    other:
      "OpenBot {version} đã dừng trước khi mở, {count} lần liên tiếp. Dữ liệu cục bộ của bạn không bị đặt lại hay ghi đè.",
  },
  "startup.recoveryHint":
    "Hãy thử lại, hoặc cài đặt phiên bản gần nhất đã mở được. Để được trợ giúp, hãy xuất dữ liệu chẩn đoán và gửi tệp kèm báo cáo của bạn.",
  "startup.recoveryHintLatest":
    "OpenBot không tìm thấy phiên bản cũ hơn nào mở được dữ liệu của bạn. Hãy thử lại, hoặc cài đặt phiên bản mới nhất. Để được trợ giúp, hãy xuất dữ liệu chẩn đoán và gửi tệp kèm báo cáo của bạn.",
  "startup.recoveryRetry": "Thử lại",
  "startup.recoveryPreviousVersion": "Tải phiên bản trước",
  "startup.recoveryLatestVersion": "Tải phiên bản mới nhất",
  "startup.recoveryExportDiagnostics": "Xuất dữ liệu chẩn đoán",
  "startup.recoveryOpenDataFolder": "Mở thư mục dữ liệu",
  "startup.recoveryQuit": "Thoát",
  "startup.recoveryDiagnosticsSaved": "Đã lưu tệp chẩn đoán.",
  "startup.recoveryActionFailed": "OpenBot không thể thực hiện thao tác này.",
} as const satisfies PartialTranslation<typeof source>;
