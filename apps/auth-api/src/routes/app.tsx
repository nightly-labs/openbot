import { createFileRoute } from "@tanstack/solid-router";
import { WEB_APPEARANCE_BOOT_SCRIPT } from "../../../../src/renderer/src/features/web-client/web-appearance-boot";

export const Route = createFileRoute("/app")({
  head: () => ({
    meta: [{ title: "OpenBot web" }, { name: "robots", content: "noindex, nofollow" }],
    scripts: [{ children: WEB_APPEARANCE_BOOT_SCRIPT }],
  }),
  headers: () => ({
    "Cache-Control": "no-store",
    "X-Robots-Tag": "noindex, nofollow",
    "Referrer-Policy": "no-referrer",
    "Permissions-Policy": "camera=(), geolocation=(), microphone=(self), payment=(), usb=()",
    "Content-Security-Policy": "frame-ancestors 'none'",
    "X-Frame-Options": "DENY",
  }),
});
