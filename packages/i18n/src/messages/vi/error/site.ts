import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/site";

export const messages = {
  // Hosted site errors.
  "error.site.absolutePath": "Chọn đường dẫn thư mục trang web tuyệt đối.",
  "error.site.rootSymlink": "Không được phép dùng symlink trong các trang web được lưu trữ.",
  "error.site.notDirectory": "Nguồn trang web phải là một thư mục.",
  "error.site.outsideWorkspace": "Trang web phải nằm trong không gian làm việc của trợ lý này hoặc OpenBot Shared.",
  "error.site.packageJsonInvalid": "package.json của trang web không hợp lệ.",
  "error.site.astroServerOutput": "Astro phải dùng đầu ra tĩnh.",
  "error.site.astroAdapter": "Không được phép dùng bộ điều hợp máy chủ Astro và tích hợp React.",
  "error.site.astroApiRoutes": "Không được phép dùng tuyến API Astro và hành động máy chủ.",
  "error.site.astroMiddleware": "Không được phép dùng middleware Astro và mã nguồn máy chủ.",
  "error.site.astroNotBuilt": "Hãy dựng dự án Astro trước. Cần có sẵn thư mục dist/.",
  "error.site.astroDistNotDirectory": "Astro dist/ phải là một thư mục thật.",
  "error.site.astroDistOutside": "Astro dist/ phải nằm trong thư mục dự án.",
  "error.site.directoryOutsideRoot": "Thư mục trang web phải nằm trong thư mục gốc nguồn.",
  "error.site.siteTooLarge": "Trang web vượt quá giới hạn 2 MB.",
  "error.site.missingIndex": "Thư mục gốc của trang web phải chứa index.html.",
  "error.site.symlink": "Không được phép dùng symlink: {name}",
  "error.site.unsupportedEntry": "Mục trang web không được hỗ trợ: {name}",
  "error.site.tooManyFiles": "Một trang web chứa tối đa {limit} tệp.",
  "error.site.hiddenFile": "Không được phép dùng tệp ẩn: {path}",
  "error.site.unsafePath": "Đường dẫn tệp này không được phép: {path}",
  "error.site.secretFile": "Không được phép dùng thông tin xác thực, khóa riêng và mã nguồn máy chủ: {path}",
  "error.site.fileType": "Loại tệp này không được phép: {path}",
  "error.site.fileOutsideRoot": "Tệp trang web phải nằm trong thư mục gốc nguồn: {path}",
  "error.site.fileTooLarge": "Một tệp vượt quá giới hạn 1 MB: {path}",
  "error.site.serverLimit": {
    other:
      "Máy chủ này đã đạt giới hạn {count} trang web đang hoạt động. Để xuất bản trang web khác, hãy xóa một trang web hoặc dùng máy chủ đám mây có gói nhiều trang web hơn.",
  },
  // Shown when the servers with no plan use all the sites of their shared pool.
  "error.site.sharedLimit":
    "Các máy chủ không có gói trong tài khoản của bạn dùng chung các trang web đang hoạt động, và tất cả đều đang được dùng. Để xuất bản trang web ở đây, hãy xóa một trang web trên một trong các máy chủ này, thêm người dùng vào giấy phép của bạn, hoặc dùng máy chủ đám mây có gói nhiều trang web hơn.",
  "error.site.accountLimit":
    "Tài khoản của bạn đã có số trang web đang hoạt động tối đa trên tất cả máy chủ: {count}. Để xuất bản trang web khác, hãy xóa một trang web.",
  "error.site.unlinkedLimit": {
    other:
      "Máy tính này không phải máy chủ, và tài khoản của nó đã đạt giới hạn {count} trang web đang hoạt động. Để xuất bản trang web khác, hãy xóa một trang web hoặc dùng máy chủ đám mây có gói nhiều trang web hơn.",
  },
} as const satisfies PartialTranslation<typeof source>;
