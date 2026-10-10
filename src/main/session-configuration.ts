/**
 * Everything that configures the default Electron session: the renderer's Content-Security-Policy,
 * its permission handlers, and the custom protocols that serve the packaged renderer bundle,
 * attachments, visual reply pages, avatars and server logos.
 *
 * **This module body must stay side-effect free.** The main entry point imports it, and an import
 * evaluates before the entry point's own statements - which is where `app.setPath("userData", ...)`
 * and `app.enableSandbox()` run. Anything executed at this module's top level would therefore run
 * against the wrong profile and an unsandboxed default. Every function here touches
 * `session.defaultSession` only when called, and each is called from inside `app.whenReady()`.
 */

import { readFile, stat } from "node:fs/promises";
import { extname, isAbsolute, relative, resolve } from "node:path";
import { isChatVisualMimeType } from "@openbot/contracts/chat-visual";
import { LOCAL_SERVER_ID } from "@openbot/contracts/ipc";
import { app, session } from "electron";
import type { AgentService } from "../backend/agent-service";
import { runCauseEffect } from "../backend/effect-boundary";
import type { MailboxStore } from "../backend/mailbox-store";
import {
  attachmentCorsHeaders,
  attachmentDocumentHeaders,
  CHAT_VISUAL_PAGE_LIMIT,
  chatVisualResponse,
} from "./chat-visual-protocol";
import { buildContentSecurityPolicy, readSelfHostedSignalOrigin } from "./content-security-policy";
import { filePreviewPages } from "./file-preview-pages";
import { fileResponse } from "./file-response";
import type { RemoteServerManager } from "./remote-server-manager";
import { canCheckRendererPermission, canRequestRendererPermission } from "./renderer-permissions";
import type { TeamStore } from "./team-store";
import { isTrustedRendererUrl } from "./trusted-renderer";

export function configureContentSecurityPolicy(): void {
  const policy = buildContentSecurityPolicy(
    app.isPackaged,
    process.env.REMOTE_SIGNAL_URL,
    readSelfHostedSignalOrigin(process.env.OPENBOT_AUTH_API_URL, process.env.OPENBOT_REMOTE_SIGNAL_URL),
  );

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    if (details.resourceType !== "mainFrame" || !isTrustedRendererUrl(details.url)) {
      callback({ responseHeaders: details.responseHeaders });
      return;
    }
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        "Content-Security-Policy": [policy],
      },
    });
  });
}

export function configureRendererPermissions(): void {
  session.defaultSession.setPermissionCheckHandler((_webContents, permission, requestingOrigin, details) =>
    canCheckRendererPermission(permission, requestingOrigin, details),
  );
  // The frame that asks decides, not its window: a visual reply frame inside the trusted window
  // must not get the microphone or the clipboard.
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback, details) => {
    const mediaTypes = ("mediaTypes" in details ? details.mediaTypes : undefined) ?? [];
    callback(
      canRequestRendererPermission(permission, {
        requestingUrl: details.requestingUrl,
        isMainFrame: details.isMainFrame,
        mediaTypes,
      }),
    );
  });
}

export interface AttachmentProtocolDependencies {
  mailbox: MailboxStore;
  agents: AgentService;
  remoteServers: RemoteServerManager;
}

export function configureAttachmentProtocol({ mailbox, agents, remoteServers }: AttachmentProtocolDependencies): void {
  session.defaultSession.protocol.handle("openbot-attachment", async (request) => {
    try {
      const url = new URL(request.url);
      const id = url.pathname.split("/").filter(Boolean).at(-1);
      const attachment = id ? await runCauseEffect(mailbox.resolveAttachment(id)) : null;
      if (!attachment) return new Response("Not found", { status: 404 });
      return await runCauseEffect(
        fileResponse(attachment.path, {
          "Content-Type": attachment.mimeType,
          "Cache-Control": "no-store",
          ...attachmentCorsHeaders(request.headers.get("Origin")),
          ...attachmentDocumentHeaders(attachment.mimeType),
          "X-Content-Type-Options": "nosniff",
          "Content-Disposition": "inline",
        }),
      );
    } catch {
      return new Response("Not found", { status: 404 });
    }
  });
  session.defaultSession.protocol.handle("openbot-remote-attachment", async (request) => {
    try {
      const url = new URL(request.url);
      const serverId = decodeURIComponent(url.hostname);
      const attachmentId = decodeURIComponent(url.pathname.split("/").filter(Boolean)[0] ?? "");
      if (!serverId || !attachmentId) return new Response("Not found", { status: 404 });
      const attachment = await runCauseEffect(remoteServers.downloadAttachment(attachmentId, serverId));
      return new Response(Buffer.from(attachment.bytes), {
        headers: {
          "Content-Type": attachment.mimeType,
          "Cache-Control": "no-store",
          ...attachmentCorsHeaders(request.headers.get("Origin")),
          ...attachmentDocumentHeaders(attachment.mimeType),
          "X-Content-Type-Options": "nosniff",
          "Content-Disposition": "inline",
        },
      });
    } catch {
      return new Response("Not found", { status: 404 });
    }
  });
  // A visual reply page: an HTML attachment with the frame script, in a sandbox. See
  // `chat-visual-protocol.ts`.
  session.defaultSession.protocol.handle("openbot-visual", async (request) => {
    try {
      const url = new URL(request.url);
      if (url.hostname === "preview") return filePreviewPages.response(request);
      const id = url.hostname === "file" ? url.pathname.split("/").filter(Boolean).at(-1) : undefined;
      const attachment = id ? await runCauseEffect(mailbox.resolveAttachment(id)) : null;
      if (!attachment || !isChatVisualMimeType(attachment.mimeType)) return new Response("Not found", { status: 404 });
      if ((await stat(attachment.path)).size > CHAT_VISUAL_PAGE_LIMIT)
        return new Response("Not found", { status: 404 });
      return chatVisualResponse(await readFile(attachment.path));
    } catch {
      return new Response("Not found", { status: 404 });
    }
  });
  session.defaultSession.protocol.handle("openbot-remote-visual", async (request) => {
    try {
      const url = new URL(request.url);
      const serverId = decodeURIComponent(url.hostname);
      const attachmentId = decodeURIComponent(url.pathname.split("/").filter(Boolean)[0] ?? "");
      if (!serverId || !attachmentId) return new Response("Not found", { status: 404 });
      const attachment = await runCauseEffect(remoteServers.downloadAttachment(attachmentId, serverId));
      if (!isChatVisualMimeType(attachment.mimeType)) return new Response("Not found", { status: 404 });
      return chatVisualResponse(attachment.bytes);
    } catch {
      return new Response("Not found", { status: 404 });
    }
  });
  session.defaultSession.protocol.handle("openbot-avatar", async (request) => {
    try {
      const url = new URL(request.url);
      if (url.hostname !== "agent") return new Response("Not found", { status: 404 });
      const agentId = decodeURIComponent(url.pathname.split("/").filter(Boolean)[0] ?? "");
      const avatar = agentId ? agents.resolveAvatar(agentId) : null;
      if (!avatar || avatar.version !== url.searchParams.get("v")) {
        return new Response("Not found", { status: 404 });
      }
      return await runCauseEffect(
        fileResponse(avatar.path, {
          "Content-Type": avatar.mimeType,
          "Cache-Control": "private, max-age=31536000, immutable",
          "X-Content-Type-Options": "nosniff",
        }),
      );
    } catch {
      return new Response("Not found", { status: 404 });
    }
  });
  session.defaultSession.protocol.handle("openbot-remote-avatar", async (request) => {
    try {
      const url = new URL(request.url);
      const serverId = decodeURIComponent(url.hostname);
      const agentId = decodeURIComponent(url.pathname.split("/").filter(Boolean)[0] ?? "");
      if (!serverId || !agentId) return new Response("Not found", { status: 404 });
      const version = url.searchParams.get("v");
      if (!version) return new Response("Not found", { status: 404 });
      const avatar = await runCauseEffect(remoteServers.downloadAgentAvatar(agentId, serverId, version));
      return new Response(Buffer.from(avatar.bytes), {
        headers: {
          "Content-Type": avatar.mimeType,
          "Cache-Control": "private, max-age=31536000, immutable",
          "X-Content-Type-Options": "nosniff",
        },
      });
    } catch {
      return new Response("Not found", { status: 404 });
    }
  });
}

export interface ServerLogoProtocolDependencies {
  teamStore: TeamStore;
  remoteServers: RemoteServerManager;
}

export function configureServerLogoProtocols({ teamStore, remoteServers }: ServerLogoProtocolDependencies): void {
  session.defaultSession.protocol.handle("openbot-server-logo", async (request) => {
    try {
      const url = new URL(request.url);
      const logo = teamStore.resolveLogo();
      if (url.hostname !== LOCAL_SERVER_ID || !logo || logo.version !== url.searchParams.get("v")) {
        return new Response("Not found", { status: 404 });
      }
      return await runCauseEffect(
        fileResponse(logo.path, {
          "Content-Type": logo.mimeType,
          "Cache-Control": "private, max-age=31536000, immutable",
          "X-Content-Type-Options": "nosniff",
        }),
      );
    } catch {
      return new Response("Not found", { status: 404 });
    }
  });
  session.defaultSession.protocol.handle("openbot-remote-server-logo", async (request) => {
    try {
      const url = new URL(request.url);
      const serverId = decodeURIComponent(url.hostname);
      const version = url.searchParams.get("v");
      if (!serverId || !version) return new Response("Not found", { status: 404 });
      const logo = await runCauseEffect(remoteServers.downloadServerLogo(serverId, version));
      return new Response(Buffer.from(logo.bytes), {
        headers: {
          "Content-Type": logo.mimeType,
          "Cache-Control": "private, max-age=31536000, immutable",
          "X-Content-Type-Options": "nosniff",
        },
      });
    } catch {
      return new Response("Not found", { status: 404 });
    }
  });
}

export function configureApplicationProtocol(): void {
  const rendererRoot = resolve(__dirname, "../renderer");
  session.defaultSession.protocol.handle("openbot-app", async (request) => {
    try {
      const url = new URL(request.url);
      if (url.host !== "app") return new Response("Not found", { status: 404 });
      const pathname = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
      const filePath = resolve(rendererRoot, `.${pathname}`);
      const candidate = relative(rendererRoot, filePath);
      if (candidate.startsWith("..") || isAbsolute(candidate)) {
        return new Response("Not found", { status: 404 });
      }
      return new Response(await readFile(filePath), {
        headers: {
          "Content-Type": applicationContentType(filePath),
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
        },
      });
    } catch {
      return new Response("Not found", { status: 404 });
    }
  });
}

function applicationContentType(
  path: string,
):
  | "text/html; charset=utf-8"
  | "text/javascript; charset=utf-8"
  | "text/css; charset=utf-8"
  | "image/svg+xml"
  | "image/png"
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
    case ".woff2":
      return "font/woff2";
    default:
      return "application/octet-stream";
  }
}
