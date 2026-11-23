import { X_PAGE_RULES_DEFAULT, type XPageRules } from "@openbot/contracts/browser-extension-x";

/**
 * The selectors that the browser extension uses on X now. When X changes its page, put a copy here
 * with the new selectors and deploy the account service: each extension takes it within an hour, with
 * no store review. Keep only CSS selectors; the extension runs no code from the network.
 */
export const X_PAGE_RULES_CURRENT: XPageRules = X_PAGE_RULES_DEFAULT;
