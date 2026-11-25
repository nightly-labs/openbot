import { messages as common } from "./common";
import { messages as format } from "./format";
import { messages as language } from "./language";

export const shared = {
  ...common,
  ...format,
  ...language,
} as const;
