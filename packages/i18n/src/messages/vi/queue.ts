import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/queue";

export const messages = {
  "queue.label": "Hàng đợi tin nhắn",
  "queue.moved": "Đã chuyển tin nhắn trong hàng đợi tới vị trí {position} trên {total}.",
  "queue.attachment": "Tệp đính kèm",
  "queue.hold.named": "Đang chờ - {name} đang làm việc trong {channel}",
  "queue.hold.unnamed": "Đang chờ - trợ lý này đang làm việc trong {channel}",
  "queue.item.label": "Tin nhắn trong hàng đợi {position}: {preview}",
  "queue.item.labelEditing": "Tin nhắn trong hàng đợi {position}, đang sửa: {preview}",
  "queue.item.editing": "Đang sửa",
  "queue.item.steerLabel": "Dẫn hướng tin nhắn trong hàng đợi {position}",
  "queue.item.steerTooltip": "Dẫn hướng tin nhắn",
  "queue.item.steering": "Đang dẫn hướng",
  "queue.item.steer": "Dẫn hướng",
  "queue.item.sendNowLabel": "Dừng trợ lý và gửi ngay tin nhắn trong hàng đợi {position}",
  "queue.item.sendNowTooltip": "Dừng trợ lý và gửi ngay tin nhắn này",
  "queue.item.sendNow": "Gửi ngay",
  "queue.item.notSteered": "Chưa dẫn hướng",
  "queue.item.steerFallback.providerUnsupported":
    "Nhà cung cấp này không thể dẫn hướng lượt đang chạy, nên tin nhắn phải chờ trong hàng đợi.",
  "queue.item.steerFallback.steerFailed": "Dẫn hướng không thành công, nên tin nhắn phải chờ trong hàng đợi.",
  "queue.item.steerFallback.routineRun": "Một nhiệm vụ định kỳ đang chạy, nên tin nhắn phải chờ trong hàng đợi.",
  "queue.item.runAsTask": "Chạy trong luồng phụ mới",
  "queue.item.runAsTaskLabel": "Chạy tin nhắn trong hàng đợi {position} trong luồng phụ mới",
  "queue.item.deleteLabel": "Xóa tin nhắn trong hàng đợi {position}",
  "queue.item.deleteTooltip": "Xóa tin nhắn",
  "queue.item.editLabel": "Sửa tin nhắn trong hàng đợi {position}",
  "queue.item.editTooltip": "Sửa tin nhắn",
  "queue.deleteHeld.title": "Xóa tin nhắn trong hàng đợi?",
  "queue.deleteHeld.body": "Một thiết bị khác đang sửa tin nhắn này. Trợ lý sẽ không nhận được tin nhắn.",
  "queue.deleteHeld.keep": "Giữ",
} as const satisfies PartialTranslation<typeof source>;
