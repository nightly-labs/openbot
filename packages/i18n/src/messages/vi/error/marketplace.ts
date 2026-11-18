import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/marketplace";

export const messages = {
  "error.marketplace.timezoneInvalid": "Múi giờ cục bộ không hợp lệ.",
  "error.marketplace.installedAgentMissing": "Agent đã cài đặt không còn tồn tại.",
  "error.marketplace.differentListing": "Agent cục bộ này được cài từ một agent khác trên Cửa hàng.",
  "error.marketplace.marketplaceAvatarInvalid": "Ảnh đại diện của agent trên Cửa hàng không hợp lệ.",
  "error.marketplace.shareCardInvalid": "Thẻ chia sẻ không hợp lệ.",
  "error.marketplace.cannotPublish": "Không thể xuất bản agent này.",
  "error.marketplace.templateName": {
    one: "Hãy đặt cho agent này một tên dài từ 1 đến {count} ký tự.",
    other: "Hãy đặt cho agent này một tên dài từ 1 đến {count} ký tự.",
  },
  "error.marketplace.templateRole": {
    one: "Vai trò dài hơn {count} ký tự. Hãy rút ngắn lại.",
    other: "Vai trò dài hơn {count} ký tự. Hãy rút ngắn lại.",
  },
  "error.marketplace.templateNoInstructions": "Hãy thêm chỉ dẫn cho agent này trước khi xuất bản.",
  "error.marketplace.templateInstructions": {
    one: "Chỉ dẫn dài hơn {count} ký tự. Hãy rút ngắn lại.",
    other: "Chỉ dẫn dài hơn {count} ký tự. Hãy rút ngắn lại.",
  },
  "error.marketplace.templateAvatar": "Ảnh đại diện của agent này không hợp lệ. Hãy chọn lại trong phần cài đặt agent.",
  "error.marketplace.templateSkills": {
    one: "Một agent có thể xuất bản tối đa {count} kỹ năng. Hãy gỡ bớt một số kỹ năng.",
    other: "Một agent có thể xuất bản tối đa {count} kỹ năng. Hãy gỡ bớt một số kỹ năng.",
  },
  "error.marketplace.templateLocalSkills": {
    one: "Một agent có thể xuất bản tối đa {count} kỹ năng cục bộ. Hãy gỡ bớt một số kỹ năng.",
    other: "Một agent có thể xuất bản tối đa {count} kỹ năng cục bộ. Hãy gỡ bớt một số kỹ năng.",
  },
  "error.marketplace.templateSkill":
    "Không thể xuất bản kỹ năng “{name}”. Hãy kiểm tra tên và tệp SKILL.md của kỹ năng.",
  "error.marketplace.templateRoutines": {
    one: "Một agent có thể xuất bản tối đa {count} tác vụ định kỳ. Hãy gỡ bớt một số tác vụ.",
    other: "Một agent có thể xuất bản tối đa {count} tác vụ định kỳ. Hãy gỡ bớt một số tác vụ.",
  },
  "error.marketplace.templateRoutine": {
    one: "Tác vụ định kỳ “{name}” cần có tên dài tối đa {count} ký tự và một chỉ dẫn.",
    other: "Tác vụ định kỳ “{name}” cần có tên dài tối đa {count} ký tự và một chỉ dẫn.",
  },
  "error.marketplace.templateRoutineNoName": "không có tên",
  "error.marketplace.templateTooLarge":
    "Agent này quá lớn để xuất bản. Hãy rút ngắn chỉ dẫn, kỹ năng hoặc tác vụ định kỳ của agent.",
  "error.marketplace.linkInvalid": "Liên kết agent không hợp lệ.",
  "error.marketplace.changedSinceOpened":
    "Agent này đã thay đổi sau khi bạn mở. Hãy mở lại liên kết để xem phiên bản mới.",
  "error.marketplace.avatarInvalid": "Ảnh đại diện của agent không hợp lệ.",
  "error.marketplace.secretInName": "Hãy xóa thông tin bí mật hoặc địa chỉ email khỏi tên trước khi xuất bản.",
  "error.marketplace.secretInTitle": "Hãy xóa thông tin bí mật hoặc địa chỉ email khỏi tiêu đề trước khi xuất bản.",
  "error.marketplace.secretInInstructions":
    "Hãy xóa thông tin bí mật hoặc địa chỉ email khỏi chỉ dẫn trước khi xuất bản.",
  "error.marketplace.secretInRoutine":
    "Hãy xóa thông tin bí mật hoặc địa chỉ email khỏi tác vụ định kỳ “{name}” trước khi xuất bản.",
  "error.marketplace.secretInSkill":
    "Hãy xóa thông tin bí mật hoặc địa chỉ email khỏi kỹ năng “{name}” trước khi xuất bản.",
  "error.marketplace.catalogLoadFailed": "Không thể tải Cửa hàng. Hãy thử lại.",
  "error.marketplace.templateUnreadable": "Không thể đọc agent được chia sẻ này. Có thể chủ sở hữu đã gỡ nó.",
} as const satisfies PartialTranslation<typeof source>;
