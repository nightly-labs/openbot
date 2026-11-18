import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/dialog";

export const messages = {
  "dialog.chooseSiteDirectory": "Chọn thư mục trang web tĩnh",
  "dialog.chooseAgentFolder": "Chọn thư mục cho {agent}",
  "dialog.chooseAgentExclusion": "Chọn thư mục mà {agent} không được thay đổi",
  "dialog.chooseSkill": "Chọn thư mục kỹ năng hoặc tệp ZIP",
  "dialog.filter.skillPackages": "Gói kỹ năng",
  "dialog.filter.images": "Hình ảnh",
  "dialog.filter.supportedFiles": "Tệp được hỗ trợ",
  "dialog.filter.attachment": "Tệp đính kèm",
  "dialog.filter.zipArchive": "Tệp nén ZIP",
  "dialog.filter.jsonDocument": "Tài liệu JSON",
  "dialog.chooseAgentExport": "Chọn tệp xuất agent",
  "dialog.chooseHermesFolder": "Chọn thư mục Hermes",
  "dialog.filter.agentExports": "Tệp xuất agent",
  "dialog.chooseVaultCsv": "Chọn tệp xuất mật khẩu",
  "dialog.filter.csv": "Tệp CSV",
  "dialog.saveExportSkill": "Lưu kỹ năng xuất",
  "dialog.saveTransfer": "Lưu tệp chuyển dữ liệu",
  "dialog.chooseTransfer": "Chọn tệp chuyển dữ liệu",
  "dialog.filter.transfer": "Tệp chuyển dữ liệu OpenBot",
  "dialog.chooseExternalLinkApp": "Chọn trình duyệt",
  "dialog.filter.applications": "Ứng dụng",
} as const satisfies PartialTranslation<typeof source>;
