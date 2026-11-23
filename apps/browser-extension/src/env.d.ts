interface ImportMetaEnv {
  readonly VITE_OPENBOT_API_URL: string;
  readonly VITE_OPENBOT_WEB_URL: string;
  readonly VITE_OPENBOT_X_RULES_URL: string;
}

declare const __OPENBOT_X_NOTES__: boolean;

declare var openbotRefs: Map<string, WeakRef<Element>> | undefined;
