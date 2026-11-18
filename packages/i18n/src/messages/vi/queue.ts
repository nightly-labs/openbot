import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/queue";

export const messages = {
  "queue.label": "Hàng đợi tin nhắn",
  "queue.moved": "Đã chuyển tin nhắn trong hàng đợi đến vị trí {position}/{total}.",
  "queue.attachment": "Tệp đính kèm",
  "queue.hold.named": "Đang chờ - {name} đang làm việc trong {channel}",
  "queue.hold.unnamed": "Đang chờ - agent này đang làm việc trong {channel}",
  "queue.item.label": "Tin nhắn trong hàng đợi {position}: {preview}",
  "queue.item.labelEditing": "Tin nhắn trong hàng đợi {position}, đang sửa: {preview}",
  "queue.item.editing": "Đang sửa",
  "queue.item.steerLabel": "Định hướng bằng tin nhắn trong hàng đợi {position}",
  "queue.item.steerTooltip": "Định hướng bằng tin nhắn",
  "queue.item.steering": "Đang định hướng",
  "queue.item.steer": "Định hướng",
  "queue.item.sendNowLabel": "Dừng agent và gửi ngay tin nhắn trong hàng đợi {position}",
  "queue.item.sendNowTooltip": "Dừng agent và gửi ngay tin nhắn này",
  "queue.item.sendNow": "Gửi ngay",
  "queue.item.notSteered": "Chưa định hướng",
  "queue.item.steerFallback.providerUnsupported":
    "Nhà cung cấp này không thể định hướng lượt đang chạy, nên tin nhắn sẽ chờ trong hàng đợi.",
  "queue.item.steerFallback.steerFailed": "Định hướng không thành công, nên tin nhắn sẽ chờ trong hàng đợi.",
  "queue.item.steerFallback.routineRun": "Một tác vụ định kỳ đang chạy, nên tin nhắn sẽ chờ trong hàng đợi.",
  "queue.item.runAsTask": "Chạy trong luồng mới",
  "queue.item.runAsTaskLabel": "Chạy tin nhắn trong hàng đợi {position} trong một luồng mới",
  "queue.item.deleteLabel": "Xóa tin nhắn trong hàng đợi {position}",
  "queue.item.deleteTooltip": "Xóa tin nhắn",
  "queue.item.editLabel": "Sửa tin nhắn trong hàng đợi {position}",
  "queue.item.editTooltip": "Sửa tin nhắn",
  "queue.deleteHeld.title": "Xóa tin nhắn trong hàng đợi?",
  "queue.deleteHeld.body": "Một thiết bị khác đang sửa tin nhắn này. Agent sẽ không nhận được tin nhắn.",
  "queue.deleteHeld.keep": "Giữ lại",
} as const satisfies PartialTranslation<typeof source>;
