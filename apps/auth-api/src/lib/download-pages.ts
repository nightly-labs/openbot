// The /download pages: one per operating system, and a hub that lists them. Each statement here
// comes from the release configuration, README.md or docs/TROUBLESHOOTING.md. Keep it to what the
// released app does, because these pages are what a search engine shows for "OpenBot for Linux".

import type { DownloadPlatform } from "./download-platforms";
import { LANDING_FAQ, type LandingQuestion } from "./landing-faq";
import { OPENBOT_ALTERNATE_DOWNLOAD_LINKS, OPENBOT_DOWNLOAD_LINKS, OPENBOT_DOWNLOAD_PAGE_LINKS } from "./landing-links";
import {
  OPENBOT_SITE_URL,
  OPENBOT_SOCIAL_IMAGE_ALT,
  OPENBOT_SOCIAL_IMAGE_META,
  OPENBOT_SOCIAL_IMAGE_URL,
  OPENBOT_SOFTWARE_APPLICATION,
  OPENBOT_X_HANDLE,
} from "./site-metadata";

/** The sitemap date of the four pages. Change it when their text changes. */
export const DOWNLOAD_PAGES_UPDATED_AT = "2026-10-03";

export interface DownloadInstaller {
  label: string;
  /** What the file is, for a reader who has to choose between two. */
  detail: string;
  href: string;
}

/** One instruction. `code` is a command to copy, shown under the text. */
export interface DownloadStep {
  text: string;
  code?: string;
}

export interface DownloadPageSection {
  title: string;
  steps: readonly DownloadStep[];
}

export interface DownloadPageContent {
  platform: DownloadPlatform;
  /** The name a reader uses for the system, which the title and the breadcrumb show. */
  name: string;
  title: string;
  description: string;
  heading: string;
  intro: string;
  installers: readonly DownloadInstaller[];
  requirements: readonly string[];
  installSteps: readonly DownloadStep[];
  /** Optional steps for one situation, such as a distribution that needs a security profile. */
  extraSections: readonly DownloadPageSection[];
  notes: readonly string[];
  faq: readonly LandingQuestion[];
  /** schema.org `operatingSystem` for this page's installer. */
  operatingSystem: string;
}

const PROVIDERS_ANSWER = LANDING_FAQ.find((entry) => entry.question === "Which AI models can OpenBot use?")?.answer;
const FREE_ANSWER =
  "Yes. The app costs $0, with no locked features, and needs no account. You pay only your AI provider, through the plan or API key you already have.";
const CONNECT_STEP: DownloadStep = {
  text: "Connect a provider, such as Codex with your ChatGPT plan or Claude Code with your Claude plan. Then describe the agent you want in one prompt and save it.",
};
const UPDATES_NOTE = "OpenBot checks for new versions and updates itself.";
const NETWORK_REQUIREMENT = "An internet connection for the AI provider you choose. A local model needs none.";

function providersQuestion(system: string): LandingQuestion {
  return {
    question: `Which AI agents can I run on ${system}?`,
    answer:
      PROVIDERS_ANSWER ??
      "Codex, Claude Code, Gemini, Grok and OpenCode, and any OpenAI-compatible endpoint, also one on your own computer.",
  };
}

export const DOWNLOAD_PAGES: Record<DownloadPlatform, DownloadPageContent> = {
  macos: {
    platform: "macos",
    name: "macOS",
    title: "Download OpenBot for Mac: AI agent app for macOS",
    description:
      "Download OpenBot for macOS 13 or later on Apple silicon or Intel. A free app that runs Codex, Claude Code, Gemini and Grok agents as a team on your Mac.",
    heading: "OpenBot for Mac",
    intro:
      "Run a team of AI agents on your Mac with the ChatGPT, Claude, Gemini or Grok plan you already pay for, or with your own model. Your chats and files stay on your Mac.",
    installers: [
      { label: "Download for Apple silicon", detail: "M1 or newer · DMG", href: OPENBOT_DOWNLOAD_LINKS.macos },
      { label: "Download for Intel", detail: "Intel Mac · DMG", href: OPENBOT_ALTERNATE_DOWNLOAD_LINKS.macos },
    ],
    requirements: [
      "macOS 13 Ventura or later",
      "Apple silicon (M1 or newer) or an Intel processor",
      NETWORK_REQUIREMENT,
    ],
    installSteps: [
      {
        text: "Download the DMG for your Mac. To find which one you need, open the Apple menu and choose About This Mac: a “Chip” line means Apple silicon, a “Processor” line means Intel.",
      },
      { text: "Open the DMG and drag OpenBot to the Applications folder." },
      {
        text: "Open OpenBot from Applications. The app is signed and notarized by Apple, so macOS only asks you once to confirm that you want to open an app from the internet.",
      },
      CONNECT_STEP,
    ],
    extraSections: [],
    notes: [
      UPDATES_NOTE,
      "Computer Use needs the Screen Recording and Accessibility permissions. macOS asks for them, and OpenBot does not go around the prompts.",
    ],
    faq: [
      { question: "Is OpenBot free on Mac?", answer: FREE_ANSWER },
      {
        question: "Does OpenBot run on an Intel Mac?",
        answer: "Yes. Download the Intel installer. It needs macOS 13 or later, like the Apple silicon one.",
      },
      providersQuestion("a Mac"),
    ],
    operatingSystem: "macOS 13 or later (Apple silicon or Intel)",
  },
  windows: {
    platform: "windows",
    name: "Windows",
    title: "Download OpenBot for Windows: AI agent app for Windows 10 and 11",
    description:
      "Download OpenBot for Windows 10 or 11 on x64. A free app that runs Codex, Claude Code, Gemini and Grok agents as a team on your PC.",
    heading: "OpenBot for Windows",
    intro:
      "Run a team of AI agents on your PC with the ChatGPT, Claude, Gemini or Grok plan you already pay for, or with your own model. Your chats and files stay on your PC.",
    installers: [
      { label: "Download for Windows", detail: "x64 · installer (.exe)", href: OPENBOT_DOWNLOAD_LINKS.windows },
    ],
    requirements: [
      "Windows 10 or Windows 11",
      "A 64-bit Intel or AMD (x64) processor. There is no Arm64 build for Windows.",
      NETWORK_REQUIREMENT,
    ],
    installSteps: [
      { text: "Download the installer." },
      {
        text: "Run the installer. It is not code-signed yet, so Windows can show “Windows protected your PC” or “Unknown publisher”. Select More info, then Run anyway.",
      },
      { text: "The installer installs OpenBot for your user and opens it. Later, open it from the Start menu." },
      CONNECT_STEP,
    ],
    extraSections: [],
    notes: [
      UPDATES_NOTE,
      "To check the installer before you run it, compare its checksum with the one on the GitHub release, or check the GitHub build attestation.",
    ],
    faq: [
      { question: "Is OpenBot free on Windows?", answer: FREE_ANSWER },
      {
        question: "Why does Windows warn about the installer?",
        answer:
          "The Windows installer is not code-signed yet, so SmartScreen does not know the publisher. The source code and every release build are public on GitHub, where you can check the checksum and the build attestation.",
      },
      providersQuestion("Windows"),
    ],
    operatingSystem: "Windows 10 or later (x64)",
  },
  linux: {
    platform: "linux",
    name: "Linux",
    title: "Download OpenBot for Linux: AI agent app as an AppImage",
    description:
      "Download OpenBot for Linux as an AppImage for x64 or arm64. A free app that runs Codex, Claude Code, Gemini and Grok agents as a team on your computer.",
    heading: "OpenBot for Linux",
    intro:
      "Run a team of AI agents on your Linux computer with the ChatGPT, Claude, Gemini or Grok plan you already pay for, or with your own model. Your chats and files stay on your computer.",
    installers: [
      { label: "Download for x64", detail: "x86_64 · AppImage", href: OPENBOT_DOWNLOAD_LINKS.linux },
      { label: "Download for arm64", detail: "aarch64 · AppImage", href: OPENBOT_ALTERNATE_DOWNLOAD_LINKS.linux },
    ],
    requirements: [
      "A 64-bit Linux distribution on x64 or arm64. Each release is tested on Ubuntu 24.04 x64.",
      "A desktop session. Remote desktop also needs an X11 session and the x64 AppImage.",
      NETWORK_REQUIREMENT,
    ],
    installSteps: [
      {
        text: "Download the AppImage for your processor. To find which one you need, run this command: x86_64 means x64, and aarch64 means arm64.",
        code: "uname -m",
      },
      { text: "Make the AppImage executable.", code: "chmod +x OpenBot-*.AppImage" },
      {
        text: "Run it. On the first start, OpenBot adds itself to your app launcher, so that openbot:// links open it.",
        code: "./OpenBot-*.AppImage",
      },
      CONNECT_STEP,
    ],
    extraSections: [
      {
        title: "Ubuntu 23.10 or newer, and Debian 13",
        steps: [
          {
            text: "These distributions restrict the user namespaces that the Electron sandbox needs, so OpenBot exits during launch until you install its AppArmor profile. Take the profile out of the AppImage:",
            code: "./OpenBot-*.AppImage --appimage-extract resources/linux/openbot.apparmor",
          },
          {
            text: "Install the profile, then reload AppArmor:",
            code: "sudo install -m 0644 squashfs-root/resources/linux/openbot.apparmor /etc/apparmor.d/openbot\nsudo systemctl reload apparmor",
          },
          {
            text: "The profile applies to an AppImage in ~/Applications, ~/Desktop, ~/Downloads, ~/.local/bin or /opt/OpenBot. Keep it in one of these, or edit the path in the profile before you install it. Do not start OpenBot with --no-sandbox: the sandbox is the boundary between a web page and the rest of your computer.",
          },
        ],
      },
      {
        title: "A server with no screen",
        steps: [
          {
            text: "On Ubuntu 24.04 with systemd, install OpenBot as an always-on server of your account, then sign in with an email code:",
            code: "curl -fsSL https://raw.githubusercontent.com/nightly-labs/openbot/main/scripts/install-server.sh | sudo bash\nsudo openbot login",
          },
          { text: "Then use it from the desktop app, the iPhone app or openbot.run/app." },
        ],
      },
    ],
    notes: [
      UPDATES_NOTE,
      "Voice prompts are not available on Linux.",
      "Remote desktop works with the x64 AppImage in an X11 session, such as Xorg or Xvfb. It does not work under Wayland, and the arm64 AppImage does not include it.",
    ],
    faq: [
      {
        question: "Is there an AI agent app for Linux?",
        answer:
          "Yes. OpenBot runs on Linux as an AppImage for x64 and arm64. It runs Codex, Claude Code, Gemini, Grok and OpenCode agents as a team, with the plans you already pay for or a local model.",
      },
      {
        question: "Why does OpenBot exit at once on Ubuntu?",
        answer:
          "Ubuntu 23.10 and newer, and Debian 13, restrict the user namespaces that the Electron sandbox needs. Install the AppArmor profile that ships in the AppImage, as the steps on this page show.",
      },
      {
        question: "Does OpenBot run on arm64 Linux?",
        answer: "Yes. Download the arm64 AppImage. It has the features of the x64 AppImage except remote desktop.",
      },
    ],
    operatingSystem: "Linux (x64 or arm64)",
  },
};

export const DOWNLOAD_HUB = {
  title: "Download OpenBot for Mac, Windows and Linux",
  description:
    "Download OpenBot, the free app that runs AI agents as a team on your computer. For macOS 13 or later, Windows 10 or later, and Linux on x64 or arm64.",
  heading: "Download OpenBot",
  intro:
    "Free for Mac, Windows and Linux. Download the installer for this computer, or choose your system to see its requirements and install steps.",
  /** The line on each card, shorter than the page's requirements. */
  summaries: {
    macos: "macOS 13+ · Apple silicon or Intel",
    windows: "Windows 10+ · x64",
    linux: "x64 or arm64 · AppImage",
  } satisfies Record<DownloadPlatform, string>,
} as const;

export function downloadPagePath(platform: DownloadPlatform | "hub"): string {
  return OPENBOT_DOWNLOAD_PAGE_LINKS[platform];
}

export function downloadPageUrl(platform: DownloadPlatform | "hub", siteUrl: string = OPENBOT_SITE_URL): string {
  return new URL(downloadPagePath(platform), siteUrl).toString();
}

function breadcrumbData(platform: DownloadPlatform | "hub", siteUrl: string) {
  const trail = [
    { name: "OpenBot", url: siteUrl },
    { name: "Download", url: downloadPageUrl("hub", siteUrl) },
    ...(platform === "hub" ? [] : [{ name: DOWNLOAD_PAGES[platform].name, url: downloadPageUrl(platform, siteUrl) }]),
  ];
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: trail.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: item.url,
    })),
  };
}

function faqData(faq: readonly LandingQuestion[]) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faq.map((entry) => ({
      "@type": "Question",
      name: entry.question,
      acceptedAnswer: { "@type": "Answer", text: entry.answer },
    })),
  };
}

export function downloadPageHead(platform: DownloadPlatform | "hub", siteUrl: string) {
  const page = platform === "hub" ? undefined : DOWNLOAD_PAGES[platform];
  const title = page?.title ?? DOWNLOAD_HUB.title;
  const description = page?.description ?? DOWNLOAD_HUB.description;
  const url = downloadPageUrl(platform, siteUrl);
  const application = page
    ? {
        ...OPENBOT_SOFTWARE_APPLICATION,
        operatingSystem: page.operatingSystem,
        downloadUrl: page.installers.map((installer) => new URL(installer.href, siteUrl).toString()),
      }
    : OPENBOT_SOFTWARE_APPLICATION;

  return {
    meta: [
      { title },
      { name: "description", content: description },
      { property: "og:type", content: "website" },
      { property: "og:site_name", content: "OpenBot" },
      { property: "og:locale", content: "en_US" },
      { property: "og:url", content: url },
      { property: "og:title", content: title },
      { property: "og:description", content: description },
      ...OPENBOT_SOCIAL_IMAGE_META,
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:site", content: OPENBOT_X_HANDLE },
      { name: "twitter:title", content: title },
      { name: "twitter:description", content: description },
      { name: "twitter:image", content: OPENBOT_SOCIAL_IMAGE_URL },
      { name: "twitter:image:alt", content: OPENBOT_SOCIAL_IMAGE_ALT },
      { "script:ld+json": application },
      { "script:ld+json": breadcrumbData(platform, siteUrl) },
      ...(page ? [{ "script:ld+json": faqData(page.faq) }] : []),
    ],
    links: [{ rel: "canonical", href: url }],
  };
}
