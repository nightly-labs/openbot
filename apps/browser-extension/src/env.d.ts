interface ImportMetaEnv {
  /** The account service. `vite.config.ts` sets it: production unless `VITE_OPENBOT_API_URL` names another. */
  readonly VITE_OPENBOT_API_URL: string;
  /** The web app (openbot.run, or the local stack's API address), where the extension signs in. */
  readonly VITE_OPENBOT_WEB_URL: string;
  /** Where the newest selectors for X come from (`X_PAGE_RULES_ROUTE` of the account service). */
  readonly VITE_OPENBOT_X_RULES_URL: string;
}

/** True in a development build of the content script on X: it writes why its button did not change. */
declare const __OPENBOT_X_NOTES__: boolean;
