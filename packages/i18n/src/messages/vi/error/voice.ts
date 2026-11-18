import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/voice";

export const messages = {
  // Voice transcription errors.
  "error.voice.downloadFailed": "Không thể tải xuống mô hình giọng nói. Hãy thử lại.",
  "error.voice.downloadStopped": "Quá trình tải xuống mô hình giọng nói đã bị dừng.",
  "error.voice.removeBusy": "Hãy đợi đến khi chuyển văn bản giọng nói kết thúc, rồi gỡ bỏ mô hình.",
  "error.voice.removeFailed": "Không thể gỡ bỏ mô hình giọng nói. Hãy thử lại.",
  "error.voice.runtimeUnavailable": "Chuyển văn bản giọng nói cục bộ không khả dụng trên nền tảng này.",
  "error.voice.modelUnavailable": "Mô hình giọng nói không khả dụng.",
  "error.voice.transcriptionTimedOut": "Chuyển văn bản giọng nói đã hết thời gian chờ.",
  "error.voice.prepareRequired":
    "Chuyển văn bản giọng nói cục bộ không khả dụng. Hãy chạy `bun run voice:prepare` và khởi động lại OpenBot.",
  "error.voice.transcriptionFailed": "OpenBot không thể chuyển văn bản bản ghi âm này.",
  // A provider that takes dictation or reads replies aloud with the user's own key. {provider} is ElevenLabs or xAI.
  "error.voice.cloud.keyRequired": "Hãy thêm khóa API {provider} của bạn trong Cài đặt → Giọng nói.",
  "error.voice.cloud.keyRejected": "{provider} không chấp nhận khóa API. Hãy kiểm tra khóa trong Cài đặt → Giọng nói.",
  "error.voice.cloud.quotaExceeded": "Hạn mức của {provider} đã hết.",
  "error.voice.cloud.rateLimited": "{provider} đang bận. Hãy thử lại sau ít phút.",
  "error.voice.cloud.termsRequired": "Chấp nhận điều khoản ElevenLabs trong tài khoản ElevenLabs của bạn, rồi thử lại.",
  "error.voice.cloud.streamEnded": "Luồng ghi lời nói đã kết thúc. Hãy ghi lại.",
  "error.voice.cloud.tooLong": "Bản ghi âm quá dài.",
  "error.voice.cloud.keySaveFailed": "Không thể lưu khóa API của {provider}.",
  "error.voice.speech.runtimeUnavailable": "Giọng nói cục bộ không khả dụng trên nền tảng này.",
  "error.voice.speech.modelRequired": "Hãy tải xuống mô hình giọng nói trong Cài đặt → Giọng nói.",
  "error.voice.speech.timedOut": "Đọc to câu trả lời đã hết thời gian chờ.",
  "error.voice.speech.failed": "OpenBot không thể đọc to câu trả lời.",
  // A cloud model for spoken replies. {provider} is ElevenLabs or xAI.
  "error.voice.speech.providerFailed": "{provider} không gửi tệp âm thanh. Hãy thử lại.",
  "error.voice.speech.providerUnreachable": "Không thể kết nối tới {provider}. Hãy kiểm tra kết nối.",
  "error.voice.recordingNotKept": "OpenBot không thể giữ bản ghi âm giọng nói.",
  "error.voice.live.timedOut": "Giọng nói trực tiếp của Codex không khởi động kịp thời gian. Hãy thử lại.",
  "error.voice.live.failed": "Giọng nói trực tiếp đã dừng: {reason}",
  "error.voice.live.disconnected": "Giọng nói trực tiếp đã mất kết nối.",
  "error.voice.live.hostFailed":
    "Codex trên máy chủ không thể khởi động giọng nói trực tiếp. Hãy nhờ chủ sở hữu cập nhật Codex trên máy tính đó và đăng nhập bằng ChatGPT, rồi thử lại.",
  "error.voice.live.signIn": "Hãy đăng nhập vào Codex bằng tài khoản ChatGPT của bạn để dùng giọng nói trực tiếp.",
  "error.voice.live.unavailable":
    "OpenAI không thể khởi động giọng nói trực tiếp. Vấn đề nằm ở phía OpenAI. Hãy thử lại sau.",
  "error.voice.live.off": "Giọng nói trực tiếp của Codex đang tắt. Hãy bật nó trong Cài đặt → Giọng nói.",
  // The user's own voice server.
  "error.voice.server.routeOff":
    "Máy chủ giọng nói chưa được thiết lập cho việc này. Hãy kiểm tra Cài đặt → Giọng nói.",
  "error.voice.server.keyRefused": "{host} đã từ chối khóa API.",
  "error.voice.server.invalidAnswer": "{host} không gửi câu trả lời tương thích với OpenAI.",
  "error.voice.server.invalidAudio": "{host} gửi tệp âm thanh mà OpenBot không thể phát. Hãy dùng máy chủ gửi WAV.",
  "error.voice.server.tooLarge": "Câu trả lời từ {host} quá lớn.",
} as const satisfies PartialTranslation<typeof source>;
