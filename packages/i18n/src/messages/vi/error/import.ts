import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/import";

export const messages = {
  // Agent import errors and warnings.
  "error.import.manifestNotJson": "{manifest} không phải JSON hợp lệ.",
  "error.import.notAgentExport": "{manifest} không phải là bản xuất trợ lý của OpenBot.",
  "error.import.newerExportSkill": "Bản xuất này do một kỹ năng xuất mới hơn tạo ra. Hãy cập nhật OpenBot và thử lại.",
  "error.import.noAgents": "Bản xuất không có trợ lý nào.",
  "error.import.tooManyAgents": "Bản xuất có nhiều hơn {limit} trợ lý.",
  "error.import.tooManyChannels": "Bản xuất có nhiều hơn {limit} kênh.",
  "error.import.channelSkipped": "{name}: kênh bị bỏ qua vì không trợ lý nào của nó có trong bản xuất.",
  "error.import.membersLeftOut": "{name}: các thành viên không phải trợ lý trong bản xuất này bị bỏ qua.",
  "error.import.leadNotMember": "{name}: người phụ trách không phải là thành viên, nên kênh không có người phụ trách.",
  "error.import.routineLimit": "{name}: chỉ {limit} nhiệm vụ định kỳ đầu tiên được nhập.",
  "error.import.routineInvalid":
    '{name}: nhiệm vụ định kỳ "{routine}" bị bỏ qua vì tên, văn bản hoặc lịch của nó không hợp lệ.',
  "error.import.memoriesSkipped": "{name}: {skipped} trí nhớ bị bỏ qua vì chúng rỗng hoặc dài hơn {limit} ký tự.",
  "error.import.memoryLimit": "{name}: chỉ {limit} trí nhớ đầu tiên được nhập.",
  "error.import.manifestMissing": "Bản xuất phải chứa {manifest}.",
  "error.import.skillFolderMissing": "{name}: thư mục kỹ năng {skill} không có SKILL.md.",
  "error.import.avatarSkipped": "{name}: ảnh đại diện bị bỏ qua vì nó không phải PNG, JPEG hoặc WebP dưới 512 KB.",
  "error.import.exportClosed": "Bản xuất không còn mở. Hãy chọn lại.",
  "error.import.agentNotInExport": "Lựa chọn nêu tên một trợ lý không có trong bản xuất.",
  "error.import.channelNotInExport": "Lựa chọn nêu tên một kênh không có trong bản xuất.",
  "error.import.serverAgentLimit": "Một máy chủ có tối đa {limit} trợ lý.",
  "error.import.exportChanged": "Bản xuất đã thay đổi sau khi được kiểm tra. Hãy chọn lại.",
  "error.import.noMembersImported": "Không trợ lý nào của nó được nhập.",
  "error.import.leadNotImported": "{name}: người phụ trách của nó không được nhập, nên nó không có người phụ trách.",
  "error.import.routineSkipped": '{name}: nhiệm vụ định kỳ "{routine}" bị bỏ qua. {reason}',
  "error.import.fileRenamed": "{name}: {file} đã tồn tại, nên bản sao này được lưu thành {saved}.",
  "error.import.fileSkipped": "{name}: tệp {file} bị bỏ qua. {reason}",
  "error.import.chooseZip": "Hãy chọn một tệp .zip.",
  "error.import.unsafeFile": "Bản xuất chứa một tệp không an toàn: {name}",
  "error.import.tooManyFiles": "Bản xuất phải có không quá {limit} tệp.",
  "error.import.diskSpace":
    "{name}: các tệp của nó cần {size} GB dung lượng đĩa trống, và còn {free} GB trống. Hãy giải phóng dung lượng, rồi nhập lại trợ lý.",
  "error.import.remoteExpandedTooLarge": "Bản xuất phải giải nén dưới 500 MB và {limit} tệp.",
  "error.import.zipInvalid":
    "Tệp đã chọn không phải là tệp .zip hợp lệ. Nếu Grok Bot vẫn đang lưu nó, hãy đợi và chọn lại.",
  "error.import.entryDamaged": "Tệp bị hỏng trong bản xuất.",
  "error.import.foldersSkipped":
    "{number} tệp trong các thư mục .git và node_modules bị bỏ qua. Một công cụ có thể tạo lại chúng.",
  "error.import.empty": "Bản xuất trống.",
  "error.import.remoteZipTooLarge": "Để nhập vào một máy chủ đã tham gia, bản xuất phải là tệp .zip dưới 100 MB.",
  "error.import.hostBusy": "Máy chủ đang đọc các bản xuất khác. Hãy thử lại sau vài phút.",
  "error.import.skillKept":
    '{name}: máy chủ đã có kỹ năng "{skill}", nên trợ lý dùng kỹ năng đó. Hãy nhờ quản trị viên cập nhật nó.',
  // Hermes Agent import from a folder on this computer.
  "error.import.hermesNoProfiles":
    "Thư mục này không có hồ sơ Hermes nào. Hãy chọn thư mục Hermes, thư mục chứa config.yaml hoặc SOUL.md.",
  "error.import.hermesClosed": "Các hồ sơ Hermes không còn mở. Hãy đọc lại.",
  "error.import.hermesProfileMissing": "Lựa chọn nêu tên một hồ sơ Hermes chưa được đọc.",
  "error.import.hermesSoulLong":
    "{name}: SOUL.md dài hơn {limit} ký tự, nên chỉ dẫn chỉ giữ phần đầu của nó. Toàn bộ tệp nằm trong imported/hermes/SOUL.md.",
  "error.import.hermesSkillSkipped": '{name}: kỹ năng "{skill}" bị bỏ qua. {reason}',
  "error.import.hermesSkillCodeAdded":
    "Nó có mã mà không có khi các hồ sơ được đọc. Hãy đọc lại chúng để cho phép mã đó.",
  "error.import.hermesLinkNotSaved":
    "{name}: OpenBot không thể lưu trợ lý nào đến từ hồ sơ này, nên lần nhập sau sẽ thêm nó như một trợ lý mới.",
  // Instance transfer between two OpenBot computers.
  "error.import.transferRemoteTooLarge":
    "Tệp chuyển cho một máy chủ đã tham gia phải dưới 100 MB. Hãy tắt tệp không gian làm việc, hoặc xuất ít trợ lý hơn.",
  "error.import.transferNotFile": "Tệp này không phải là tệp chuyển của OpenBot.",
  "error.import.transferNewer": "Một phiên bản OpenBot mới hơn đã tạo tệp này. Hãy cập nhật OpenBot và thử lại.",
  "error.import.transferEmpty": "Tệp không có trợ lý nào và không có cài đặt nào.",
  "error.import.transferTooLarge":
    "Tệp chuyển phải dưới 2 GB và 50.000 tệp. Hãy tắt tệp không gian làm việc, hoặc xuất ít trợ lý hơn.",
  "error.import.transferAgentInvalid": "Trợ lý {number} trong tệp không hợp lệ, nên nó bị bỏ qua.",
  "error.import.transferSettingsInvalid": "Cài đặt ứng dụng trong tệp không hợp lệ, nên chúng không được nhập.",
  "error.import.transferModelMissing":
    '{name}: mô hình "{model}" chưa có sẵn ở đây, nên trợ lý dùng mô hình mặc định. Hãy chọn lại mô hình khi nhà cung cấp của nó sẵn sàng.',
  "error.import.transferSettingSkipped": "{name} không được nhập. {reason}",
  "error.import.transferRoutineFlowSkipped": "Quá trình nhập đã bỏ qua một luồng nhiệm vụ định kỳ. {reason}",
  "error.import.transferCustomAgentCommand":
    '{name}: trợ lý tùy chỉnh không được nhập, vì chúng chạy một lệnh. Hãy kiểm tra lệnh "{command}" và thêm trợ lý lại trong Cài đặt.',
  "error.import.transferSkillLimit":
    "{name}: chỉ {limit} kỹ năng đầu tiên trong {total} kỹ năng của nó có trong tệp, vì một trợ lý chỉ có thể có {limit} kỹ năng.",
  "error.import.transferFilesGone": "{number} tệp đã bị xóa trong khi bản xuất chạy, nên chúng không có trong tệp.",
  "error.import.transferProviderKey": "{name}: hãy nhập lại khóa API của nó trong Cài đặt.",
  "error.import.transferAgentEnv": "{name}: hãy nhập lại các giá trị của {names} trong Cài đặt.",
  "error.import.transferMcpValues":
    "{name}: máy chủ MCP được thêm ở trạng thái tắt. Hãy kiểm tra lệnh của nó, nhập lại các giá trị và địa chỉ đầy đủ, rồi bật nó trong cài đặt MCP.",
  "error.import.transferValuesCleared":
    "{name}: các giá trị có thể chứa bí mật đã bị xóa khỏi tham số hoặc địa chỉ của nó. Hãy nhập lại chúng trong Cài đặt.",
  "error.import.transferSharedKept": "{number} tệp trong thư mục Shared đã có ở đây, nên chúng được giữ nguyên.",
} as const satisfies PartialTranslation<typeof source>;
