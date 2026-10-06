import { fetch as expoFetch } from "expo/fetch";
import { withRequestLog } from "./support-log";

/** `expo/fetch` with a support log line for each request. Import it instead of `expo/fetch`. */
export const fetch = withRequestLog(expoFetch);
