import { ArticleClip, ArticleImage } from "../../components/content/ArticleMedia";
import dragToApplications from "./media/install-openbot-on-macos/drag-to-applications.mp4";
import dragToApplicationsPoster from "./media/install-openbot-on-macos/drag-to-applications-poster.webp";
import firstLaunch from "./media/install-openbot-on-macos/first-launch.webp";

export function InstallOpenBotOnMacos() {
  return (
    <>
      <p>
        OpenBot is a desktop app. There is no account to make first and nothing to configure before it opens: the
        install is a download, a drag, and one permission dialog.
      </p>

      <h2>Pick the right build</h2>
      <p>
        Two builds are published for macOS, one for Apple silicon and one for Intel. If you are unsure which machine you
        have, open the Apple menu and choose About This Mac; anything that says M1 or later is Apple silicon. The
        download page picks for you when it can, so in most cases you can take the button it offers.
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
        macOS checks the signature the first time you open the app, which takes a few seconds and happens once. After
        that OpenBot asks for access to the folder you want your first agent to work in. That folder is the only part of
        your disk it can read, and you can change it later.
      </p>

      <ArticleImage
        src={firstLaunch}
        width={1600}
        height={1000}
        alt="OpenBot on first launch. A sheet asks which folder the first agent may work in, with the path ~/Projects/website in the field and a Choose Folder button beside Cancel."
        caption="The folder named here is the whole of the app's reach into your disk."
      />
      <p>
        You are done. Nothing has been sent anywhere: the database it just created is on your disk, and it stays there
        until you connect a provider and ask for something.
      </p>
    </>
  );
}
