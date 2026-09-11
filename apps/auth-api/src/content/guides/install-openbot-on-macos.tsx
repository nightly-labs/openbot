import { ArticleClip, ArticleImage } from "../../components/content/ArticleMedia";
import dragToApplications from "./media/install-openbot-on-macos/drag-to-applications.mp4";
import dragToApplicationsPoster from "./media/install-openbot-on-macos/drag-to-applications-poster.webp";
import firstLaunch from "./media/install-openbot-on-macos/first-launch.webp";

export function InstallOpenBotOnMacos() {
  return (
    <>
      <p>
        OpenBot is a desktop app. The install itself is a download and a drag; the first launch then asks you to sign
        in, to pick the provider you want your agents to use, and to allow two macOS permissions.
      </p>

      <h2>Check that your Mac can run it</h2>
      <p>
        OpenBot is built for Apple silicon and needs macOS 13 Ventura or later. There is no Intel build, and an Intel
        Mac cannot open this one. To check, open the Apple menu and choose About This Mac: a chip named M1 or later is
        Apple silicon. One macOS build is published, so the download page has nothing to choose between.
      </p>

      <h2>Move it to Applications</h2>
      <p>
        Open the disk image and drag OpenBot into Applications. Running it from the disk image works, but the updater
        cannot replace an app it does not own, so the first update would fail rather than install.
      </p>

      <ArticleClip
        src={dragToApplications}
        poster={dragToApplicationsPoster}
        width={1280}
        height={720}
        label="The OpenBot icon dragged out of the disk image window and dropped into the Applications folder."
        caption="One drag, once. Every update after this one replaces the app where it stands."
      />

      <h2>The first launch</h2>
      <p>
        macOS checks the signature the first time you open the app, which takes a few seconds and happens once. OpenBot
        then signs you in with a one-time code sent to your email, asks which AI provider to use, and shows the two
        macOS permissions that Computer Use needs: Screen Recording, so it can see app windows, and Accessibility, so it
        can click and type in them. Each one opens System Settings at the right pane.
      </p>

      <ArticleImage
        src={firstLaunch}
        width={1600}
        height={1000}
        alt="The OpenBot first-launch window, headed OpenBot might control your computer. Screen Recording and Accessibility each have a line saying what they are for and an Open Settings button, above Back and Next."
        caption="These two permissions are about controlling the screen, not about your files."
      />

      <h2>What an agent may touch</h2>
      <p>
        Be clear about this before you hand over a task. Each agent gets a folder of its own under ~/OpenBot, which is
        where it starts and where it keeps its work, but that folder is not a fence. An agent runs with full access: it
        can read and change files elsewhere on the computer, run programs and use the network, in the same way as a
        command-line tool you start yourself. Give an agent a task you would be willing to run yourself, and keep
        backups.
      </p>

      <p>
        Your work stays on this computer. The account holds who you are and which teams you belong to; the chats, the
        files and the commands live in a database on your disk.
      </p>
    </>
  );
}
