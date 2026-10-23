import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/kind";

/** The sentence for each kind `classifyUserError` decides. `@openbot/user-errors` owns the mapping. */
export const messages = {
  "error.kind.network": "无法连接，请检查网络后重试。",
  "error.kind.timeout": "请求超时。重试前请先确认该操作是否已完成。",
  "error.kind.storage": "存储空间不足。请先在运行 OpenBot 的电脑上释放一些空间，然后重试。",
  "error.kind.filePermission": "OpenBot 没有权限完成该操作。请检查文件或文件夹权限后重试。",
  "error.kind.notFound": "找不到所需的文件或文件夹。请恢复它或选择另一个，然后重试。",
  "error.kind.readOnly": "该文件夹为只读。请选择可写入的文件夹后重试。",
  "error.kind.conflict": "已存在同名项目。请换一个名称后重试。",
  "error.kind.auth": "身份验证失败。请检查账号或服务器连接后重试。",
  "error.kind.permission": "你没有权限完成该操作，请向所有者申请访问权限。",
  "error.kind.rateLimit": "请求过于频繁，请稍等片刻后重试。",
  "error.kind.service": "服务暂时不可用，请稍等片刻后重试。",
} as const satisfies PartialTranslation<typeof source>;
