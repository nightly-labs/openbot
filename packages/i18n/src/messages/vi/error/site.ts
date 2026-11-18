import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/site";

export const messages = {
  "error.site.absolutePath": "Hãy chọn đường dẫn tuyệt đối cho thư mục trang web.",
  "error.site.rootSymlink": "Trang web được lưu trữ không được chứa liên kết tượng trưng (symlink).",
  "error.site.notDirectory": "Nguồn của trang web phải là một thư mục.",
  "error.site.outsideWorkspace":
    "Trang web phải nằm trong không gian làm việc của agent này hoặc trong OpenBot Shared.",
  "error.site.packageJsonInvalid": "Tệp package.json của trang web không hợp lệ.",
  "error.site.astroServerOutput": "Astro phải dùng đầu ra tĩnh (static).",
  "error.site.astroAdapter": "Không cho phép adapter máy chủ Astro và tích hợp React.",
  "error.site.astroApiRoutes": "Không cho phép route API và server action của Astro.",
  "error.site.astroMiddleware": "Không cho phép middleware Astro và mã nguồn phía máy chủ.",
  "error.site.astroNotBuilt": "Hãy build dự án Astro trước. Cần có sẵn thư mục dist/ của dự án.",
  "error.site.astroDistNotDirectory": "dist/ của Astro phải là một thư mục thật.",
  "error.site.astroDistOutside": "dist/ của Astro phải nằm trong thư mục dự án.",
  "error.site.directoryOutsideRoot": "Các thư mục của trang web phải nằm trong thư mục gốc nguồn.",
  "error.site.siteTooLarge": "Trang web vượt quá giới hạn 2 MB.",
  "error.site.missingIndex": "Thư mục gốc của trang web phải chứa index.html.",
  "error.site.symlink": "Không cho phép liên kết tượng trưng: {name}",
  "error.site.unsupportedEntry": "Mục trang web không được hỗ trợ: {name}",
  "error.site.tooManyFiles": "Một trang web chỉ có thể chứa tối đa {limit} tệp.",
  "error.site.hiddenFile": "Không cho phép tệp ẩn: {path}",
  "error.site.unsafePath": "Không cho phép đường dẫn tệp này: {path}",
  "error.site.secretFile": "Không cho phép thông tin xác thực, khóa riêng tư và mã nguồn phía máy chủ: {path}",
  "error.site.fileType": "Không cho phép loại tệp này: {path}",
  "error.site.fileOutsideRoot": "Các tệp của trang web phải nằm trong thư mục gốc nguồn: {path}",
  "error.site.fileTooLarge": "Một tệp vượt quá giới hạn 1 MB: {path}",
  "error.site.serverLimit": {
    one: "Máy chủ này đã đạt giới hạn {count} trang web đang hoạt động. Để xuất bản thêm trang web, hãy xóa một trang web hoặc dùng máy chủ đám mây có gói nhiều trang web hơn.",
    other:
      "Máy chủ này đã đạt giới hạn {count} trang web đang hoạt động. Để xuất bản thêm trang web, hãy xóa một trang web hoặc dùng máy chủ đám mây có gói nhiều trang web hơn.",
  },
  "error.site.sharedLimit":
    "Các máy chủ không có gói trong tài khoản của bạn dùng chung số trang web đang hoạt động, và tất cả đều đã được dùng. Để xuất bản trang web tại đây, hãy xóa một trang web trên một trong các máy chủ này, thêm người dùng vào giấy phép của bạn, hoặc dùng máy chủ đám mây có gói nhiều trang web hơn.",
  "error.site.accountLimit":
    "Tài khoản của bạn đã có số trang web đang hoạt động tối đa trên tất cả máy chủ: {count}. Để xuất bản thêm trang web, hãy xóa một trang web.",
  "error.site.unlinkedLimit": {
    one: "Máy tính này không phải là máy chủ, và tài khoản của nó đã đạt giới hạn {count} trang web đang hoạt động. Để xuất bản thêm trang web, hãy xóa một trang web hoặc dùng máy chủ đám mây có gói nhiều trang web hơn.",
    other:
      "Máy tính này không phải là máy chủ, và tài khoản của nó đã đạt giới hạn {count} trang web đang hoạt động. Để xuất bản thêm trang web, hãy xóa một trang web hoặc dùng máy chủ đám mây có gói nhiều trang web hơn.",
  },
} as const satisfies PartialTranslation<typeof source>;
