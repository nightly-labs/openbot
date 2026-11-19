import { router } from "expo-router";

export function backOrConnected(): void {
  if (router.canGoBack()) router.back();
  else router.replace("/connected");
}
