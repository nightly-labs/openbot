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

      <h2>The first launch</h2>
      <p>
        macOS checks the signature the first time you open the app, which takes a few seconds and happens once. After
        that OpenBot asks for access to the folder you want your first agent to work in. That folder is the only part of
        your disk it can read, and you can change it later.
      </p>
      <p>
        You are done. Nothing has been sent anywhere: the database it just created is on your disk, and it stays there
        until you connect a provider and ask for something.
      </p>
    </>
  );
}
