import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/plugin";

export const messages = {
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

  "plugin.uninstallDialog.title": "Ngắt kết nối {name}?",
  "plugin.uninstallDialog.description":
    "Thao tác này gỡ những gì {name} đã cài trên máy tính này. Không có gì khác trên host này hoặc trên agent này thay đổi.",
  "plugin.uninstallDialog.confirm": "Ngắt kết nối",
  "plugin.uninstallDialog.appsLabel": "Ứng dụng sẽ gỡ, {number}",
  "plugin.uninstallDialog.appsTitle": "Ứng dụng bị gỡ khỏi host này",
  "plugin.uninstallDialog.appsNote":
    "Các công cụ của chúng sẽ không còn dùng được, và mọi thông tin đăng nhập OpenBot đã lưu cho chúng sẽ bị xóa.",
  "plugin.uninstallDialog.skillsLabel": "Kỹ năng sẽ gỡ, {number}",
  "plugin.uninstallDialog.skillsTitle": "Kỹ năng bị gỡ khỏi {agentName}",
} as const satisfies PartialTranslation<typeof source>;
