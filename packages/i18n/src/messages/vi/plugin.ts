import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/plugin";

export const messages = {
  // The plugin page in the marketplace.
  "plugin.link.website": "Trang web",
  "plugin.link.privacyPolicy": "Chính sách quyền riêng tư",
  "plugin.link.terms": "Điều khoản dịch vụ",
  "plugin.copyLink": "Sao chép liên kết",
  "plugin.askPrompt": "Hỏi {name}: {prompt}",
  "plugin.section.skills": "Kỹ năng",
  "plugin.section.information": "Thông tin",
  "plugin.info.developer": "Nhà phát triển",
  "plugin.info.category": "Danh mục",
  "plugin.info.version": "Phiên bản",

  // The uninstall confirmation. {number} is a count that has no plural form here.
  "plugin.uninstallDialog.title": "Ngắt kết nối {name}?",
  "plugin.uninstallDialog.description":
    "Việc này gỡ bỏ những gì {name} đã cài trên máy tính này. Không có gì khác trên máy tính hay trong trợ lý này bị thay đổi.",
  "plugin.uninstallDialog.confirm": "Ngắt kết nối",
  "plugin.uninstallDialog.appsLabel": "Ứng dụng sẽ gỡ bỏ, {number}",
  "plugin.uninstallDialog.appsTitle": "Ứng dụng bị gỡ khỏi máy tính này",
  "plugin.uninstallDialog.appsNote":
    "Công cụ của chúng sẽ không còn dùng được, và mọi thông tin đăng nhập OpenBot lưu cho chúng sẽ bị xóa.",
  "plugin.uninstallDialog.skillsLabel": "Kỹ năng sẽ gỡ bỏ, {number}",
  "plugin.uninstallDialog.skillsTitle": "Kỹ năng bị gỡ khỏi {agentName}",
} as const satisfies PartialTranslation<typeof source>;
