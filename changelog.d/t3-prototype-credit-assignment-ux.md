### Added

- OpenBot credits. Buy credits for yourself or for a server from the Credits button in the page rail,
  or from Settings > Billing. The buy page has a slider and six packs in three tiers (Basic, Plus and Max), and the
  selector in the window corner sets who gets the credits. A server owner can move credits from their own balance to
  a server and back. This works in the desktop app and in the web client. Before checkout, a
  confirmation shows the total with VAT and asks for the billing country when it is not set. You
  can pay in EUR, USD, PLN or BRL. When a server is removed or deleted, its credits go to the
  owner's balance. Packs start at €10 or $10, and the discount grows from 10% on the smallest pack
  to 40% on the largest. A dollar pack has fewer credits than the euro pack at the same price. Each
  pack shows how many images and videos it buys with named models. Each purchase gets an invoice
  with VAT. The Terms now have a credits section: bought credits do not expire and are not refunded.
- In the server menu, a card at the top shows your credits, with a Get button to buy more. The
  submenu of each server starts with the same card for the credits of that server. On the buy page, a server owner can move their own credits to the server.
  This works in the desktop app and in the web client.
- Free monthly credits with a paid license. After the free trial, each paid month gives the license
  owner 50 credits with Starter, or 100 credits plus 50 for each extra user with Team. A yearly
  license gives them every month. Free credits are used first and expire at the end of their month;
  Settings > Billing shows how many expire and when. Moved to a server, they keep the same end date.
- OpenBot models in workflows. An image or video step can use an OpenBot model, which OpenBot
  credits pay for, with no other sign-in. The model list shows the price of each step in credits. On a
  server, the server's credits pay. On a computer that hosts a server, that server's credits pay too.
  Elsewhere, the credits of your account pay. A charge is exact to 0.1 credit, and you can
  move tenths of a credit. A failed or refused generation uses no credits. A generation that was sent
  always gives its file: it continues when you stop the run, and after the app closes or restarts.
  When the network fails, the step shows the error at once. Retry then gets the same generation, so
  you do not pay again, unless you changed the step. When a server signs in to an account during a
  generation, it still gets the file and does not pay a second time.
  A batch makes up to 4 results with an OpenBot model at the same time. Each result is a separate
  charge, and a failed result uses no credits. A result in progress shows its time in the result
  list, and you can select it to see its progress.
  When your credits do not pay for the full batch, you cannot start the step.
  A new video step starts at the default length of its model. A model that takes only a first frame
  shows no last-frame input.
  This works on this computer, on a joined server and in the web client.
  A joined server must also be on the new version to show these models.
- The account service records credit events in product analytics: purchases, moves, free monthly
  credits, and the model, kind and outcome of each generation that uses credits. The events have the
  account ID and fixed values only, with no prompt, file, job or server ID. The Privacy Policy
  describes them.
- The account service keeps a credit audit log of each credit change and each failed credit action:
  checkouts, purchases, moves, refunds, free credits, and the hold, charge or release of each
  generation, with the error code and the processor status of a failure. It keeps no prompt or file,
  and deletes a record after 400 days. `bun apps/auth-api/scripts/credit-audit.ts` lists and sums the
  records for an account, a server or a job.
