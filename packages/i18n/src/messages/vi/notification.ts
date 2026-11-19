import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/notification";

export const messages = {
  "notification.needsInput": "Cần bạn nhập thông tin.",
  "notification.needsApproval": "Cần bạn phê duyệt.",
  "notification.needsBrowserStep": "Cần bạn hoàn tất một bước trong trình duyệt.",
  "notification.needsApprovalFor": "Cần bạn phê duyệt: {action}",
  "notification.finished": "Đã hoàn tất công việc.",
  "notification.workflowApproval": "Một bước đang chờ bạn phê duyệt.",
  "notification.workflowOutput": "Một quy trình có kết quả mới.",
  "notification.failed": "Đã dừng do lỗi.",
  "notification.subagentFailed": "Một agent phụ đã dừng do lỗi.",
  "notification.subagentFailedFor": "Một agent phụ đã dừng do lỗi: {task}",
  "notification.channelTitle": "{agent} trong {channel}",
  "notification.channelMessage": "Đã gửi một tin nhắn.",
  "notification.usageLimit.title": "Tài khoản {provider} đã đạt giới hạn",
  "notification.usageLimit.body": {
    one: "{count} agent đang chờ. OpenBot sẽ thử lại sau.",
    other: "{count} agent đang chờ. OpenBot sẽ thử lại sau.",
  },
  "notification.usageLimit.bodyResets": {
    one: "{count} agent đang chờ. Đặt lại {reset}.",
    other: "{count} agent đang chờ. Đặt lại {reset}.",
  },
  "notification.machineAlert.disk": "{server}: ổ đĩa đã đầy {percent}",
  "notification.machineAlert.memory": "{server}: đã dùng {percent} bộ nhớ",
  "notification.machineAlert.cpu": "{server}: CPU bận {percent}",
  "notification.machineAlert.body": "Đã vượt ngưỡng cảnh báo {level}. Xem Cài đặt máy chủ > Lưu trữ.",
  "notification.test": "Thông báo đang hoạt động.",
  "notification.welcome": "OpenBot sẽ báo cho bạn tại đây khi một agent cần bạn.",
  "notification.toast.region": "Thông báo",
  "notification.toast.close": "Đóng thông báo",
} as const satisfies PartialTranslation<typeof source>;
