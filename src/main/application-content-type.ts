import { extname } from "node:path";

/** The content type of a file of the renderer build, for the app protocol and the server setup page. */
export function applicationContentType(
  path: string,
):
  | "text/html; charset=utf-8"
  | "text/javascript; charset=utf-8"
  | "text/css; charset=utf-8"
  | "image/svg+xml"
  | "image/png"
  | "image/webp"
  | "font/woff2"
  | "application/octet-stream" {
  switch (extname(path).toLowerCase()) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".js":
      return "text/javascript; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".svg":
      return "image/svg+xml";
    case ".png":
      return "image/png";
    case ".webp":
      return "image/webp";
    case ".woff2":
      return "font/woff2";
    default:
      return "application/octet-stream";
  }
}
