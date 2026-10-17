import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/mobile/app";

export const messages = {
  "mobile.app.route.scanQrCode": "扫描二维码",
  "mobile.app.route.createAgent": "创建助手",
  "mobile.app.route.addSharedAgent": "添加共享助手",
  "mobile.app.route.newSection": "新建分区",
  "mobile.app.route.settings": "设置",
  "mobile.app.route.profile": "个人资料",
  "mobile.app.route.accountSessions": "账号会话",
  "mobile.app.route.about": "关于",
  "mobile.app.route.support": "支持",
  "mobile.app.route.hiddenChats": "隐藏的对话",
  "mobile.app.route.share": "分享",
  "mobile.app.route.cropPhoto": "移动与缩放",
  "mobile.app.route.queuedMessages": "排队的消息",
  "mobile.app.route.messageOptions": "消息选项",
  "mobile.app.route.editMessage": "编辑消息",
  "mobile.app.route.serverOptions": "服务器选项",
  "mobile.app.route.members": "成员",
  "mobile.app.route.hostedServerPlans": "云服务器",
  "mobile.app.route.hostedServerSetup": "配置",
  "mobile.app.route.routines": "自动化任务",
  "mobile.app.route.routine": "自动化任务",
  "mobile.app.route.usage": "用量",
  // The quick actions of the app icon, which the phone shows when the icon is held.
  "mobile.app.quickAction.routines": "自动化任务",
  "mobile.app.quickAction.search": "搜索",
} as const satisfies PartialTranslation<typeof source>;
