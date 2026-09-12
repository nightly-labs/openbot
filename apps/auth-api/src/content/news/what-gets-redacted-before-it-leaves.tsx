export function WhatGetsRedactedBeforeItLeaves() {
  return (
    <>
      <p>
        A desktop app that talks to several model providers accumulates secrets: API keys, tokens, the contents of the
        environment it was started with. A log line is the easiest way in the world to leak one, and a diagnostics
        bundle is the easiest way to leak all of them at once.
      </p>

      <h2>Redact at the exit, not at the call site</h2>
      <p>
        Redacting where the secret is logged only works until someone adds a log line and forgets. The rule we hold
        instead is that every path out of the app redacts: logs, exported diagnostics, crash reports, analytics. If
        bytes can leave, they go through something that strips secrets first.
      </p>
      <p>
        It is a duller design than a clever helper at each call site, and it fails in the right direction. A new log
        line written by someone who has never read this article is still covered.
      </p>

      <h2>What analytics is allowed to know</h2>
      <p>
        The website counts pages and link clicks. The app does not send your prompts, your files or your provider
        traffic anywhere, and there is no path in it that would. Anything we cannot collect by accident is the sort of
        thing we prefer not to have to promise.
      </p>

      <h2>Read it for yourself</h2>
      <p>
        The source is public and the privacy document travels with it. If you find a path that logs something it should
        not, that is a bug worth reporting, and we would rather hear it from you than not hear it at all.
      </p>
    </>
  );
}
