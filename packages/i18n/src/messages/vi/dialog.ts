import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/dialog";

export const messages = {
  // Native file pickers.
  "dialog.chooseSiteDirectory": "Chọn thư mục trang tĩnh",
  "dialog.chooseAgentFolder": "Chọn thư mục cho {agent}",
  "dialog.chooseAgentExclusion": "Chọn thư mục mà {agent} không được thay đổi",
  "dialog.chooseSkill": "Chọn thư mục kỹ năng hoặc tệp ZIP",
  "dialog.filter.skillPackages": "Gói kỹ năng",
  "dialog.filter.images": "Ảnh",
  "dialog.filter.supportedFiles": "Tệp được hỗ trợ",
  "dialog.filter.attachment": "Tệp đính kèm",
  "dialog.filter.zipArchive": "Tệp ZIP",
  "dialog.filter.jsonDocument": "Tài liệu JSON",
  "dialog.chooseAgentExport": "Chọn tệp xuất trợ lý",
  "dialog.chooseHermesFolder": "Chọn thư mục Hermes",
  "dialog.filter.agentExports": "Tệp xuất trợ lý",
  "dialog.chooseVaultCsv": "Chọn tệp xuất mật khẩu",
  "dialog.filter.csv": "Tệp CSV",
  "dialog.saveExportSkill": "Lưu kỹ năng xuất",
  "dialog.saveTransfer": "Lưu tệp chuyển",
  "dialog.chooseTransfer": "Chọn tệp chuyển",
  "dialog.filter.transfer": "Tệp chuyển của OpenBot",
  "dialog.chooseExternalLinkApp": "Chọn trình duyệt",
  "dialog.filter.applications": "Ứng dụng",
} as const satisfies PartialTranslation<typeof source>;
