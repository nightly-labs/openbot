import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/import";

export const messages = {
  "error.import.manifestNotJson": "{manifest} không phải là JSON hợp lệ.",
  "error.import.notAgentExport": "{manifest} không phải là bản xuất agent của OpenBot.",
  "error.import.newerExportSkill": "Bản xuất này được tạo bằng kỹ năng xuất mới hơn. Hãy cập nhật OpenBot và thử lại.",
  "error.import.noAgents": "Bản xuất không chứa agent nào.",
  "error.import.tooManyAgents": "Bản xuất chứa hơn {limit} agent.",
  "error.import.tooManyChannels": "Bản xuất chứa hơn {limit} kênh.",
  "error.import.channelSkipped": "{name}: kênh bị bỏ qua vì không có agent nào của kênh nằm trong bản xuất.",
  "error.import.membersLeftOut": "{name}: các thành viên không phải là agent trong bản xuất này sẽ bị bỏ ra.",
  "error.import.leadNotMember": "{name}: trưởng nhóm không phải là thành viên, nên kênh không có trưởng nhóm.",
  "error.import.routineLimit": "{name}: chỉ {limit} tác vụ định kỳ đầu tiên được nhập.",
  "error.import.routineInvalid":
    "{name}: tác vụ định kỳ “{routine}” bị bỏ qua vì tên, nội dung hoặc lịch chạy không hợp lệ.",
  "error.import.memoriesSkipped": "{name}: {skipped} mục bộ nhớ bị bỏ qua vì trống hoặc dài hơn {limit} ký tự.",
  "error.import.memoryLimit": "{name}: chỉ {limit} mục bộ nhớ đầu tiên được nhập.",
  "error.import.manifestMissing": "Bản xuất phải chứa {manifest}.",
  "error.import.skillFolderMissing": "{name}: thư mục kỹ năng {skill} không có SKILL.md.",
  "error.import.avatarSkipped": "{name}: ảnh đại diện bị bỏ qua vì không phải PNG, JPEG hoặc WebP dưới 512 KB.",
  "error.import.exportClosed": "Bản xuất không còn mở. Hãy chọn lại.",
  "error.import.agentNotInExport": "Lựa chọn có một agent không nằm trong bản xuất.",
  "error.import.channelNotInExport": "Lựa chọn có một kênh không nằm trong bản xuất.",
  "error.import.serverAgentLimit": "Một máy chủ chỉ có thể có tối đa {limit} agent.",
  "error.import.exportChanged": "Bản xuất đã thay đổi sau khi được kiểm tra. Hãy chọn lại.",
  "error.import.noMembersImported": "Không có agent nào của kênh được nhập.",
  "error.import.leadNotImported": "{name}: trưởng nhóm chưa được nhập, nên kênh không có trưởng nhóm.",
  "error.import.routineSkipped": "{name}: tác vụ định kỳ “{routine}” bị bỏ qua. {reason}",
  "error.import.fileRenamed": "{name}: {file} đã tồn tại, nên bản sao này được lưu thành {saved}.",
  "error.import.fileSkipped": "{name}: tệp {file} bị bỏ qua. {reason}",
  "error.import.chooseZip": "Hãy chọn một tệp .zip.",
  "error.import.unsafeFile": "Bản xuất chứa một tệp không an toàn: {name}",
  "error.import.tooManyFiles": "Bản xuất chỉ được có tối đa {limit} tệp.",
  "error.import.diskSpace":
    "{name}: các tệp cần {size} GB dung lượng đĩa trống, nhưng chỉ còn {free} GB. Hãy giải phóng dung lượng, rồi nhập lại agent.",
  "error.import.remoteExpandedTooLarge": "Bản xuất sau khi giải nén phải dưới 500 MB và {limit} tệp.",
  "error.import.zipInvalid":
    "Tệp đã chọn không phải là .zip hợp lệ. Nếu Grok Bot vẫn đang lưu tệp, hãy đợi rồi chọn lại.",
  "error.import.entryDamaged": "Tệp trong bản xuất bị hỏng.",
  "error.import.foldersSkipped":
    "{number} tệp trong các thư mục .git và node_modules bị bỏ ra. Một công cụ có thể tạo lại chúng.",
  "error.import.empty": "Bản xuất trống.",
  "error.import.remoteZipTooLarge": "Để nhập vào máy chủ đã tham gia, bản xuất phải là tệp .zip dưới 100 MB.",
  "error.import.hostBusy": "Máy chủ đang đọc các bản xuất khác. Hãy thử lại sau vài phút.",
  "error.import.uploadDiskSpace":
    "Bản xuất cần {size} GB dung lượng đĩa trống trên máy chủ, nhưng chỉ còn {free} GB. Hãy giải phóng dung lượng trên máy chủ, rồi chọn lại bản xuất.",
  "error.import.remoteZipTooLargeOldHost":
    "Máy chủ này chỉ nhận bản xuất tối đa 100 MB. Hãy cập nhật OpenBot trên máy chủ để nhập bản xuất lớn hơn.",
  "error.import.skillKept":
    "{name}: máy chủ đã có kỹ năng “{skill}”, nên agent dùng kỹ năng đó. Hãy nhờ quản trị viên cập nhật kỹ năng.",
  "error.import.skillRenamed":
    "{name}: tên kỹ năng “{skill}” quá giống tên một kỹ năng khác, nên được lưu thành “{renamed}”.",
  "error.import.hermesNoProfiles":
    "Thư mục này không có hồ sơ Hermes nào. Hãy chọn thư mục Hermes, nơi chứa config.yaml hoặc SOUL.md.",
  "error.import.hermesClosed": "Các hồ sơ Hermes không còn mở. Hãy đọc lại.",
  "error.import.hermesProfileMissing": "Lựa chọn có một hồ sơ Hermes chưa được đọc.",
  "error.import.hermesSoulLong":
    "{name}: SOUL.md dài hơn {limit} ký tự, nên hướng dẫn chỉ giữ phần đầu. Toàn bộ tệp nằm ở imported/hermes/SOUL.md.",
  "error.import.hermesSkillSkipped": "{name}: kỹ năng “{skill}” bị bỏ qua. {reason}",
  "error.import.hermesSkillCodeAdded": "Kỹ năng có mã mà lúc đọc hồ sơ chưa có. Hãy đọc lại hồ sơ để cho phép.",
  "error.import.hermesLinkNotSaved":
    "{name}: OpenBot không thể lưu agent nào đến từ hồ sơ này, nên lần nhập sau sẽ thêm nó thành agent mới.",
  "error.import.transferRemoteTooLarge":
    "Tệp chuyển dữ liệu cho máy chủ đã tham gia phải dưới 100 MB. Hãy tắt tệp không gian làm việc, hoặc xuất ít agent hơn.",
  "error.import.transferNotFile": "Tệp này không phải là tệp chuyển dữ liệu của OpenBot.",
  "error.import.transferNewer": "Tệp này được tạo bởi phiên bản OpenBot mới hơn. Hãy cập nhật OpenBot và thử lại.",
  "error.import.transferEmpty": "Tệp không chứa agent hay cài đặt nào.",
  "error.import.transferTooLarge":
    "Tệp chuyển dữ liệu phải dưới 2 GB và 50.000 tệp. Hãy tắt tệp không gian làm việc, hoặc xuất ít agent hơn.",
  "error.import.transferAgentInvalid": "Agent {number} trong tệp không hợp lệ, nên bị bỏ qua.",
  "error.import.transferSettingsInvalid": "Cài đặt ứng dụng trong tệp không hợp lệ, nên không được nhập.",
  "error.import.transferModelMissing":
    "{name}: mô hình “{model}” chưa có ở đây, nên agent dùng mô hình mặc định. Hãy chọn lại mô hình khi nhà cung cấp của nó sẵn sàng.",
  "error.import.transferAgentSettingSkipped": "{name}: một cài đặt của agent không được áp dụng. {reason}",
  "error.import.transferChannelInstructionsCut":
    "{name}: tệp chỉ chứa {limit} ký tự đầu tiên của hướng dẫn kênh, vì kênh mới chỉ được có {limit} ký tự.",
  "error.import.transferSettingSkipped": "{name} không được nhập. {reason}",
  "error.import.transferRunsSkipped": "{name}: lịch sử chạy của tác vụ định kỳ “{routine}” không được nhập.",
  "error.import.transferSharedSkillsSkipped": "Không thể đọc các kỹ năng dùng chung, nên chúng không có trong tệp.",
  "error.import.transferSharedSkillsNotAdded": "Không thể thêm các kỹ năng dùng chung trong tệp vào máy chủ này.",
  "error.import.transferMemberPreferencesSkipped": {
    one: "Không thể lưu lựa chọn của {count} thành viên.",
    other: "Không thể lưu lựa chọn của {count} thành viên.",
  },
  "error.import.transferSharedSkillExists": "Máy chủ này đã có một kỹ năng dùng chung cùng tên nhưng khác tệp.",
  "error.import.transferServerPreferencesSkipped": {
    one: "{count} tùy chọn máy chủ trong tệp không hợp lệ ở đây, nên không được nhập.",
    other: "{count} tùy chọn máy chủ trong tệp không hợp lệ ở đây, nên không được nhập.",
  },
  "error.import.transferRoutineFlowSkipped":
    "Quá trình nhập đã bỏ qua một liên kết tác vụ định kỳ giữa các agent. {reason}",
  "error.import.transferCustomAgentCommand":
    "{name}: agent tùy chỉnh không được nhập vì chúng chạy một lệnh. Hãy kiểm tra lệnh “{command}” và thêm lại agent trong Cài đặt.",
  "error.import.transferSkillLimit":
    "{name}: tệp chỉ chứa {limit} kỹ năng đầu tiên trong tổng số {total} kỹ năng của agent, vì một agent chỉ được có {limit} kỹ năng.",
  "error.import.transferFilesGone": "{number} tệp đã bị xóa trong lúc xuất, nên không có trong tệp.",
  "error.import.transferProviderKey": "{name}: hãy nhập lại khóa API trong Cài đặt.",
  "error.import.transferAgentEnv": "{name}: hãy nhập lại giá trị của {names} trong Cài đặt.",
  "error.import.transferMcpValues":
    "{name}: máy chủ MCP được thêm ở trạng thái tắt. Hãy kiểm tra lệnh, nhập lại các giá trị và địa chỉ đầy đủ, rồi bật nó trong Cửa hàng, Ứng dụng.",
  "error.import.transferValuesCleared":
    "{name}: các giá trị có thể chứa bí mật đã bị xóa khỏi đối số hoặc địa chỉ. Hãy nhập lại trong Cài đặt.",
  "error.import.transferSharedKept": "{number} tệp trong thư mục Shared đã có ở đây, nên được giữ nguyên.",
  "error.import.transferChannelInvalid": "Kênh {number} trong tệp không hợp lệ, nên bị bỏ qua.",
  "error.import.transferChannelLimit": "Tệp chỉ chứa {limit} kênh đầu tiên.",
  "error.import.transferWorkflowInvalid": "Một quy trình trong tệp không hợp lệ, nên bị bỏ qua.",
  "error.import.transferRoutineWebhook":
    "{name}: tác vụ định kỳ “{routine}” có địa chỉ webhook mới. Hãy mở nó, tạo bí mật mới, rồi gửi cả hai cho bên gửi.",
  "error.import.transferWorkflowWebhook":
    "{name}: quy trình cần địa chỉ webhook mới. Hãy mở nó, tạo lại địa chỉ, rồi gửi cho bên gửi.",
  "error.import.transferWorkflowConnection":
    "{name}: hãy chọn lại kết nối Slack, Discord hoặc Telegram của quy trình sau khi bạn kết nối tại đây.",
  "error.import.transferHistorySkipped": "{name}: lịch sử trò chuyện trong tệp không hợp lệ, nên không được nhập.",
  "error.import.transferChatsSkipped": {
    one: "{name}: {count} cuộc trò chuyện không được nhập.",
    other: "{name}: {count} cuộc trò chuyện không được nhập.",
  },
  "error.import.transferLocalScripts":
    "{name}: “Tập lệnh cục bộ” đã bật cho agent này. Hãy bật lại trong cài đặt của agent nếu bạn tin tưởng tệp.",
  "error.import.transferAgentNewChats":
    "{name}: “Agent bắt đầu cuộc trò chuyện mới” đã bật cho agent này. Hãy bật lại trong cài đặt của agent nếu bạn tin tưởng tệp.",
  "error.import.transferAlwaysAllow":
    "{name}: bạn đã luôn cho phép agent này trên máy tính kia. Tại đây, agent sẽ hỏi trước cho đến khi bạn cho phép lại.",
  "error.import.transferFolders":
    "{name}: agent đã dùng {number} thư mục bên ngoài không gian làm việc. Hãy thêm lại trong cài đặt của agent, mục Thư mục.",
  "error.import.transferPartsClosed": "Quá trình chuyển dữ liệu với máy chủ đã dừng. Hãy thử lại.",
  "error.import.transferPartInvalid": "Một phần của tệp chuyển dữ liệu không đến đúng cách. Hãy thử lại.",
  "error.import.transferStepFailed": "Máy chủ này chưa lưu được.",
  "error.import.transferNoSpace": "Máy chủ không đủ dung lượng đĩa trống cho tệp chuyển dữ liệu này.",
} as const satisfies PartialTranslation<typeof source>;
