import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/billing";

export const messages = {
  "error.billing.lifecycleFailed": "无法更改服务器套餐，请刷新账单后重试。",
  "error.billing.confirmMismatch": "请输入服务器名称以确认删除。",
  "error.billing.restartBusy": "服务器当前无法重启，请一分钟后再试。",
  "error.billing.restartUnavailable": "此服务器无法从这里重启，请联系支持团队。",
  "error.billing.planRequired": "该服务器的套餐已结束，请续费后启动服务器。",
  "error.billing.planSoldOut": "该套餐已售罄，请选择其他套餐。",
  "error.billing.storageUnavailable": "此存储空间不适用于该服务器。",
  "error.billing.storagePaymentFailed": "存储空间付款失败。请更新付款方式后重试。",
  "error.billing.licenseExists": "该账号已有许可证，请改为更改其用户数。",
  "error.billing.licenseCurrency": "许可证必须使用你其他套餐的币种。",
  "error.billing.planCurrency": "新套餐必须使用你其他套餐的币种。",
  "error.billing.licenseUsersInUse": "许可证的用户数不能少于当前正在使用的人数。",
  "error.billing.licensePaymentFailed": "新增用户的付款失败。请更新付款方式后重试。",
  "error.billing.licenseUnavailable": "许可证暂时不可用。",
  "error.billing.mediaContentRefused":
    "模型的安全检查拒绝了提示词或图片。它常常拒绝真实人物、知名角色、品牌、暴力和成人内容。请修改后重试。未使用任何积分。",
  "error.billing.licenseOneUser": "该许可证只包含 1 位用户。如需添加用户，请改为团队版。",
  "error.billing.licensePlanChange": "该许可证无法改为该套餐。请取消它，然后购买新套餐。",
  "error.billing.noLicense": "该账号没有许可证。",
  "error.billing.countryRequired": "付款前请填写账单国家/地区。请先更新 OpenBot，然后重试。",
  "error.billing.detailsInvalid": "请检查国家/地区和增值税号。增值税号必须属于所选国家/地区。",
  "error.billing.vatIdInvalid": "欧盟增值税系统中没有此增值税号。请检查号码，或不填增值税号继续。",
  "error.billing.vatUnavailable": "现在无法付款，请稍后重试。",
  "error.billing.invalidRequest": "账单请求无效。",
  "error.billing.invalidResponse": "账单响应无效。",
  "error.billing.notStripePage": "该账单页面不是 Stripe 页面。",
  "error.billing.customServerOfferMissing": "此服务器没有可付款的方案。",
  "error.billing.checkoutUnavailable": "现在无法开始付款。请一分钟后重试。",
} as const satisfies PartialTranslation<typeof source>;
