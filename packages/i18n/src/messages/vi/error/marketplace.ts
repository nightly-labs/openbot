import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/marketplace";

export const messages = {
  // Agent marketplace and agent link errors.
  "error.marketplace.timezoneInvalid": "Múi giờ cục bộ không hợp lệ.",
  "error.marketplace.installedAgentMissing": "Trợ lý đã cài đặt không còn tồn tại.",
  "error.marketplace.differentListing": "Trợ lý cục bộ này được cài từ một trợ lý khác trong Cửa hàng.",
  "error.marketplace.marketplaceAvatarInvalid": "Ảnh đại diện của trợ lý trong Cửa hàng không hợp lệ.",
  "error.marketplace.shareCardInvalid": "Thẻ chia sẻ không hợp lệ.",
  "error.marketplace.cannotPublish": "Trợ lý này không thể xuất bản.",
  "error.marketplace.templateName": {
    other: "Đặt tên cho trợ lý này từ 1 đến {count} ký tự.",
  },
  "error.marketplace.templateRole": {
    other: "Vai trò dài hơn {count} ký tự. Hãy rút ngắn lại.",
  },
  "error.marketplace.templateNoInstructions": "Thêm chỉ dẫn cho trợ lý này trước khi xuất bản.",
  "error.marketplace.templateInstructions": {
    other: "Chỉ dẫn dài hơn {count} ký tự. Hãy rút ngắn lại.",
  },
  "error.marketplace.templateAvatar": "Ảnh đại diện của trợ lý này không hợp lệ. Hãy chọn lại trong cài đặt trợ lý.",
  "error.marketplace.templateSkills": {
    other: "Một trợ lý có thể xuất bản tối đa {count} kỹ năng. Hãy bớt đi một số kỹ năng.",
  },
  "error.marketplace.templateLocalSkills": {
    other: "Một trợ lý có thể xuất bản tối đa {count} kỹ năng cục bộ. Hãy bớt đi một số kỹ năng.",
  },
  "error.marketplace.templateSkill": 'Kỹ năng "{name}" không thể xuất bản. Kiểm tra tên và SKILL.md của nó.',
  "error.marketplace.templateRoutines": {
    other: "Một trợ lý có thể xuất bản tối đa {count} nhiệm vụ định kỳ. Hãy bớt đi một số.",
  },
  "error.marketplace.templateRoutine": {
    other: 'Nhiệm vụ định kỳ "{name}" cần tên tối đa {count} ký tự và một chỉ dẫn.',
  },
  // Fills `{name}` above when the routine has no name.
  "error.marketplace.templateRoutineNoName": "chưa có tên",
  "error.marketplace.templateTooLarge":
    "Trợ lý này quá lớn để xuất bản. Hãy rút ngắn chỉ dẫn, kỹ năng hoặc nhiệm vụ định kỳ.",
  "error.marketplace.linkInvalid": "Liên kết trợ lý không hợp lệ.",
  "error.marketplace.changedSinceOpened":
    "Trợ lý này đã thay đổi sau khi bạn mở nó. Mở lại liên kết để xem lại phiên bản mới.",
  "error.marketplace.avatarInvalid": "Ảnh đại diện của trợ lý không hợp lệ.",
  "error.marketplace.secretInName": "Xóa bí mật hoặc địa chỉ email khỏi tên trước khi xuất bản.",
  "error.marketplace.secretInTitle": "Xóa bí mật hoặc địa chỉ email khỏi tiêu đề trước khi xuất bản.",
  "error.marketplace.secretInInstructions": "Xóa bí mật hoặc địa chỉ email khỏi chỉ dẫn trước khi xuất bản.",
  "error.marketplace.secretInRoutine":
    'Xóa bí mật hoặc địa chỉ email khỏi nhiệm vụ định kỳ "{name}" trước khi xuất bản.',
  "error.marketplace.secretInSkill": 'Xóa bí mật hoặc địa chỉ email khỏi kỹ năng "{name}" trước khi xuất bản.',
  "error.marketplace.catalogLoadFailed": "Không thể tải Cửa hàng. Thử lại.",
  "error.marketplace.templateUnreadable": "Không thể đọc trợ lý được chia sẻ này. Chủ sở hữu có thể đã xóa nó.",
} as const satisfies PartialTranslation<typeof source>;
