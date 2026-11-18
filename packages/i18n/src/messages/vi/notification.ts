import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/notification";

export const messages = {
  // Desktop notifications, raised by the main process while the window may be closed, and browser
  // notifications, raised by the web client while its tab is open.
  "notification.needsInput": "Cần bạn nhập liệu.",
  "notification.needsApproval": "Cần bạn phê duyệt.",
  "notification.needsBrowserStep": "Cần bạn hoàn tất một bước trong trình duyệt.",
  "notification.needsApprovalFor": "Cần bạn phê duyệt: {action}",
  "notification.finished": "Đã hoàn tất công việc.",
  // A workflow step that waits for a person to approve or reject it.
  "notification.workflowApproval": "Một bước đang chờ bạn phê duyệt.",
  // A workflow output step that tells the user its result.
  "notification.workflowOutput": "Một quy trình có kết quả mới.",
  "notification.failed": "Đã dừng vì lỗi.",
  // A subagent of a turn failed. {task} is the task that the subagent card shows.
  "notification.subagentFailed": "Một trợ lý phụ đã dừng vì lỗi.",
  "notification.subagentFailedFor": "Một trợ lý phụ đã dừng vì lỗi: {task}",
  // The title of a notification about an agent in a channel: the agent and the channel name.
  "notification.channelTitle": "{agent} trong {channel}",
  // The body of a channel reply notification when the preview of agent words is off.
  "notification.channelMessage": "Đã gửi một tin nhắn.",
  "notification.usageLimit.title": "Tài khoản {provider} đã đạt giới hạn",
  "notification.usageLimit.body": {
    other: "{count} trợ lý đang chờ. OpenBot sẽ thử lại sau.",
  },
  "notification.usageLimit.bodyResets": {
    other: "{count} trợ lý đang chờ. Đặt lại {reset}.",
  },
  // A metric of a server machine passed its alert level. {percent} and {level} are formatted percents.
  "notification.machineAlert.disk": "{server}: ổ đĩa đã dùng {percent}",
  "notification.machineAlert.memory": "{server}: bộ nhớ đã dùng {percent}",
  "notification.machineAlert.cpu": "{server}: CPU bận {percent}",
  "notification.machineAlert.body": "Nó đã vượt mức cảnh báo {level}. Xem Cài đặt máy chủ > Lưu trữ.",
  "notification.test": "Thông báo đang hoạt động.",
  "notification.welcome": "OpenBot sẽ báo cho bạn ở đây khi một trợ lý cần bạn.",
  // The toast region in each window.
  "notification.toast.region": "Thông báo",
  "notification.toast.close": "Đóng thông báo",
} as const satisfies PartialTranslation<typeof source>;
