import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/mobile/appLock";

export const messages = {
  "mobile.appLock.title": "Khóa ứng dụng",
  "mobile.appLock.method.pin": "Mã PIN",
  "mobile.appLock.method.faceId": "Face ID",
  "mobile.appLock.method.touchId": "Touch ID",
  "mobile.appLock.method.phone": "Mở khóa điện thoại",
  "mobile.appLock.methods.title": "Mở khóa bằng",
  "mobile.appLock.methods.footer":
    "Bật mã PIN, {method}, hoặc cả hai. Khi đó OpenBot sẽ khóa khi bạn rời ứng dụng và yêu cầu một trong hai khi bạn quay lại.",
  "mobile.appLock.methods.footerPinOnly":
    "Bật mã PIN. Khi đó OpenBot sẽ khóa khi bạn rời ứng dụng và yêu cầu mã PIN khi bạn quay lại.",
  "mobile.appLock.changePin": "Đổi mã PIN",
  "mobile.appLock.lockAfter.title": "Khóa OpenBot",
  "mobile.appLock.lockAfter.immediately": "Ngay lập tức",
  "mobile.appLock.lockAfter.minutes": { one: "Sau {count} phút", other: "Sau {count} phút" },
  "mobile.appLock.lockAfter.hours": { one: "Sau {count} giờ", other: "Sau {count} giờ" },
  "mobile.appLock.lockWithPhone": "Khi điện thoại khóa",
  "mobile.appLock.lockAfter.footer": "Thời gian bắt đầu tính khi bạn rời OpenBot. OpenBot luôn khóa khi khởi động lại.",
  "mobile.appLock.device.turnOnPrompt": "Bật {method} cho OpenBot",
  "mobile.appLock.device.failed": "{method} không xác nhận được. Hãy thử lại.",
  "mobile.appLock.device.unavailable": "Hãy đặt mật mã cho điện thoại trước.",
  "mobile.appLock.pinSetup.title": "Mã PIN",
  "mobile.appLock.pinSetup.enter": "Nhập mã PIN mới gồm 4 chữ số",
  "mobile.appLock.pinSetup.confirm": "Nhập lại mã PIN",
  "mobile.appLock.pinSetup.mismatch": "Hai mã PIN không khớp. Hãy thử lại.",
  "mobile.appLock.pinSetup.saveFailed": "Không thể lưu mã PIN. Hãy thử lại.",
  "mobile.appLock.lock.title": "OpenBot đang khóa",
  "mobile.appLock.lock.confirmTitle": "Xác nhận đó là bạn",
  "mobile.appLock.lock.enterPin": "Nhập mã PIN của bạn",
  "mobile.appLock.lock.unlockPrompt": "Mở khóa OpenBot",
  "mobile.appLock.lock.useDevice": "Dùng {method}",
  "mobile.appLock.lock.unlock": "Mở khóa",
  "mobile.appLock.lock.wrongPin": "Mã PIN không đúng.",
  "mobile.appLock.lock.attemptsLeft": {
    one: "Mã PIN không đúng. Còn {count} lần thử trước khi bị đăng xuất.",
    other: "Mã PIN không đúng. Còn {count} lần thử trước khi bị đăng xuất.",
  },
  "mobile.appLock.lock.waitSeconds": {
    one: "Quá nhiều lần thử. Hãy thử lại sau {count} giây.",
    other: "Quá nhiều lần thử. Hãy thử lại sau {count} giây.",
  },
  "mobile.appLock.lock.waitMinutes": {
    one: "Quá nhiều lần thử. Hãy thử lại sau {count} phút.",
    other: "Quá nhiều lần thử. Hãy thử lại sau {count} phút.",
  },
  "mobile.appLock.lock.checkFailed": "Không thể kiểm tra mã PIN. Hãy thử lại.",
  "mobile.appLock.lock.pinMissing":
    "Điện thoại này chưa có mã PIN cho OpenBot. Hãy đăng xuất để đặt lại khóa ứng dụng.",
  "mobile.appLock.lock.loadFailed": "Không thể đọc cài đặt khóa ứng dụng.",
  "mobile.appLock.lock.retry": "Thử lại",
  "mobile.appLock.lock.forgotPin": "Quên mã PIN?",
  "mobile.appLock.lock.signOut": "Đăng xuất",
  "mobile.appLock.lock.signOutTitle": "Đăng xuất khỏi OpenBot?",
  "mobile.appLock.lock.signOutBody":
    "Thao tác này sẽ gỡ khóa ứng dụng và đăng xuất bạn trên điện thoại này. Hãy kết nối lại bằng cách quét mã mới từ OpenBot trên máy tính.",
  "mobile.appLock.lock.signedOut": "Nhập sai mã PIN quá nhiều lần. OpenBot đã đăng xuất bạn trên điện thoại này.",
  "mobile.appLock.lock.delete": "Xóa chữ số",
  "mobile.appLock.lock.progress": {
    one: "Đã nhập {count}/4 chữ số",
    other: "Đã nhập {count}/4 chữ số",
  },
} as const satisfies PartialTranslation<typeof source>;
