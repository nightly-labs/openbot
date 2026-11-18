import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/voice";

export const messages = {
  "error.voice.downloadFailed": "Không thể tải xuống mô hình giọng nói. Hãy thử lại.",
  "error.voice.downloadStopped": "Đã dừng tải xuống mô hình giọng nói.",
  "error.voice.removeBusy": "Hãy chờ đến khi chuyển giọng nói thành văn bản kết thúc, rồi gỡ mô hình.",
  "error.voice.removeFailed": "Không thể gỡ mô hình giọng nói. Hãy thử lại.",
  "error.voice.runtimeUnavailable": "Chuyển giọng nói thành văn bản cục bộ không khả dụng trên nền tảng này.",
  "error.voice.modelUnavailable": "Mô hình giọng nói không khả dụng.",
  "error.voice.transcriptionTimedOut": "Chuyển giọng nói thành văn bản đã hết thời gian chờ.",
  "error.voice.prepareRequired":
    "Chuyển giọng nói thành văn bản cục bộ không khả dụng. Hãy chạy `bun run voice:prepare` và khởi động lại OpenBot.",
  "error.voice.transcriptionFailed": "OpenBot không thể chuyển bản ghi âm này thành văn bản.",
  "error.voice.cloud.keyRequired": "Hãy thêm khóa API {provider} trong Cài đặt → Giọng nói.",
  "error.voice.cloud.keyRejected": "{provider} không chấp nhận khóa API. Hãy kiểm tra khóa trong Cài đặt → Giọng nói.",
  "error.voice.cloud.quotaExceeded": "Bạn đã dùng hết hạn mức {provider}.",
  "error.voice.cloud.rateLimited": "{provider} đang bận. Hãy thử lại sau giây lát.",
  "error.voice.cloud.termsRequired":
    "Hãy chấp nhận điều khoản ElevenLabs trong tài khoản ElevenLabs của bạn, rồi thử lại.",
  "error.voice.cloud.streamEnded": "Luồng đọc chính tả đã kết thúc. Hãy ghi âm lại.",
  "error.voice.cloud.tooLong": "Bản ghi âm quá dài.",
  "error.voice.cloud.keySaveFailed": "Không thể lưu khóa API {provider}.",
  "error.voice.speech.runtimeUnavailable": "Đọc giọng nói cục bộ không khả dụng trên nền tảng này.",
  "error.voice.speech.modelRequired": "Hãy tải xuống mô hình đọc giọng nói trong Cài đặt → Giọng nói.",
  "error.voice.speech.timedOut": "Đọc to câu trả lời đã hết thời gian chờ.",
  "error.voice.speech.failed": "OpenBot không thể đọc to câu trả lời.",
  "error.voice.speech.providerFailed": "{provider} không gửi âm thanh. Hãy thử lại.",
  "error.voice.speech.providerUnreachable": "Không thể kết nối tới {provider}. Hãy kiểm tra kết nối.",
  "error.voice.recordingNotKept": "OpenBot không thể giữ lại bản ghi âm giọng nói.",
  "error.voice.live.timedOut": "Giọng nói trực tiếp của Codex không khởi động kịp thời. Hãy thử lại.",
  "error.voice.live.failed": "Giọng nói trực tiếp đã dừng: {reason}",
  "error.voice.live.disconnected": "Giọng nói trực tiếp đã ngắt kết nối.",
  "error.voice.live.hostFailed":
    "Codex trên máy chủ không thể khởi động giọng nói trực tiếp. Hãy nhờ chủ sở hữu cập nhật Codex trên máy tính đó và đăng nhập bằng ChatGPT, rồi thử lại.",
  "error.voice.live.signIn": "Đăng nhập Codex bằng tài khoản ChatGPT để dùng giọng nói trực tiếp.",
  "error.voice.live.unavailable":
    "OpenAI không thể khởi động giọng nói trực tiếp. Sự cố nằm ở phía OpenAI. Hãy thử lại sau.",
  "error.voice.live.refused":
    "OpenAI đã từ chối khởi động giọng nói trực tiếp. Hãy thử lại sau, hoặc tắt giọng nói trực tiếp trong Cài đặt để nói chuyện bằng giọng nói.",
  "error.voice.live.off": "Giọng nói trực tiếp của Codex đang tắt. Hãy bật trong Cài đặt → Giọng nói.",
  "error.voice.server.routeOff":
    "Máy chủ giọng nói chưa được thiết lập cho việc này. Hãy kiểm tra Cài đặt → Giọng nói.",
  "error.voice.server.keyRefused": "{host} đã từ chối khóa API.",
  "error.voice.server.invalidAnswer": "{host} không gửi câu trả lời tương thích OpenAI.",
  "error.voice.server.invalidAudio": "{host} đã gửi âm thanh mà OpenBot không thể phát. Hãy dùng máy chủ gửi WAV.",
  "error.voice.server.tooLarge": "Câu trả lời từ {host} quá lớn.",
} as const satisfies PartialTranslation<typeof source>;
