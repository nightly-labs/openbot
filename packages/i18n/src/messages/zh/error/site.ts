import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/site";

export const messages = {
  // Hosted site errors.
  "error.site.absolutePath": "请选择站点目录的绝对路径。",
  "error.site.rootSymlink": "托管站点不允许使用符号链接。",
  "error.site.notDirectory": "站点源必须是一个目录。",
  "error.site.outsideWorkspace": "站点必须位于该助手的工作区或 OpenBot 共享文件夹内。",
  "error.site.packageJsonInvalid": "站点的 package.json 无效。",
  "error.site.astroServerOutput": "Astro 必须使用静态输出。",
  "error.site.astroAdapter": "不允许使用 Astro 服务端适配器和 React 集成。",
  "error.site.astroApiRoutes": "不允许使用 Astro API 路由和服务端操作。",
  "error.site.astroMiddleware": "不允许使用 Astro 中间件和服务端源码。",
  "error.site.astroNotBuilt": "请先构建 Astro 项目，需要已存在的 dist/ 目录。",
  "error.site.astroDistNotDirectory": "Astro 的 dist/ 必须是真实目录。",
  "error.site.astroDistOutside": "Astro 的 dist/ 必须位于项目目录内。",
  "error.site.directoryOutsideRoot": "站点目录必须位于源根目录内。",
  "error.site.siteTooLarge": "站点超过了 2 MB 的上限。",
  "error.site.missingIndex": "站点根目录必须包含 index.html。",
  "error.site.symlink": "不允许使用符号链接：{name}",
  "error.site.unsupportedEntry": "不支持的站点条目：{name}",
  "error.site.tooManyFiles": "一个站点最多包含 {limit} 个文件。",
  "error.site.hiddenFile": "不允许包含隐藏文件：{path}",
  "error.site.unsafePath": "不允许使用该文件路径：{path}",
  "error.site.secretFile": "不允许包含凭据、私钥或服务端源码：{path}",
  "error.site.fileType": "不允许使用该文件类型：{path}",
  "error.site.fileOutsideRoot": "站点文件必须位于源根目录内：{path}",
  "error.site.fileTooLarge": "某个文件超过了 1 MB 上限：{path}",
  "error.site.serverLimit": {
    one: "该服务器已达到 {count} 个活跃站点的上限。要发布其他站点，请删除一个站点，或使用站点更多套餐的云服务器。",
    other: "该服务器已达到 {count} 个活跃站点的上限。要发布其他站点，请删除一个站点，或使用站点更多套餐的云服务器。",
  },
  "error.site.unlinkedLimit": {
    one: "该电脑不是服务器，其账户已达到 {count} 个活跃站点的上限。要发布其他站点，请删除一个站点，或使用站点更多套餐的云服务器。",
    other:
      "该电脑不是服务器，其账户已达到 {count} 个活跃站点的上限。要发布其他站点，请删除一个站点，或使用站点更多套餐的云服务器。",
  },
} as const satisfies PartialTranslation<typeof source>;
