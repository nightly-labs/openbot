import { fetch as expoFetch } from "expo/fetch";
import { withRequestLog } from "./support-log";

export const fetch = withRequestLog(expoFetch);
