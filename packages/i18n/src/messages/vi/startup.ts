import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/startup";

export const messages = {
  // The one native error box: the app could not start, so no renderer exists to show it.
  "startup.failedTitle": "OpenBot không thể khởi động",
  "startup.failedBody":
    "{message}\n\nDữ liệu cục bộ của bạn không bị đặt lại hay ghi đè. Xem hướng dẫn xử lý sự cố để biết các bước khôi phục.",
  // Shown while OpenBot runs, when another program changed `app.asar`: the next start would fail with no message.
  "startup.archiveChangedTitle": "Tệp OpenBot đã bị thay đổi",
  "startup.archiveChangedBody":
    "Một chương trình khác đã thay đổi tệp app.asar của OpenBot. OpenBot đang chạy, nhưng sẽ không mở được sau khi bạn thoát.\n\nĐể sửa OpenBot, hãy cài lại. Dữ liệu cục bộ của bạn vẫn còn.",
  "startup.archiveChangedDownload": "Tải OpenBot xuống",
  // An older OpenBot started over data that a newer one migrated: it installs the latest release.
  "startup.newerDataUpdatingTitle": "Đang cập nhật OpenBot",
  "startup.newerDataUpdatingBody":
    "Phiên bản OpenBot mới hơn đã lưu dữ liệu của bạn. OpenBot cài phiên bản mới nhất rồi mở lại.\n\nDữ liệu cục bộ của bạn không bị đặt lại hay ghi đè.",
  "startup.newerDataTitle": "Cài phiên bản OpenBot mới nhất",
  "startup.newerDataBody":
    "Phiên bản OpenBot mới hơn đã lưu dữ liệu của bạn, và phiên bản này ({version}) không thể mở dữ liệu đó. Hãy cài phiên bản mới nhất để mở dữ liệu của bạn.\n\nDữ liệu cục bộ của bạn không bị đặt lại hay ghi đè.",
  "startup.newerDataDownload": "Tải OpenBot xuống",
  "startup.newerDataGuide": "Mở hướng dẫn",
  "startup.newerDataQuit": "Thoát",
} as const satisfies PartialTranslation<typeof source>;
