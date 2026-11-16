### Added

- A CRM page for owners and admins. The CRM is experimental and off by default: an owner or admin
  turns it on in Server Settings > Experimental. Keep leads and customers with their statuses, tags, contact
  details and plans, and track open, late and paid payments in each currency. A paid monthly,
  quarterly or yearly payment makes the next one. Filter, sort, resize, move and hide columns, and
  export the sheet to CSV.
- Agents can read the CRM and propose changes, such as a new customer or a paid payment. An owner or
  admin selects which agents may do this, and approves or rejects each proposal in Review. Agents
  never change the CRM directly, and they do not see the fields that you hide from agents. An agent
  that team members can see cannot use the CRM: set it to No access for Everyone and each role.
- Connect Stripe to the CRM with a read-only restricted key: click Connectors on the CRM page, or
  right-click CRM in the rail and select Connectors. Create key in Stripe opens a key with only the
  Read access that OpenBot needs. Every 5 minutes, and when you click
  Sync now, OpenBot imports your Stripe customers, active subscriptions as plans, and open and paid
  invoices as payments, and marks a payment paid when Stripe gets the money. Stripe keeps the plans
  and payments that it imports, so you change them in Stripe. OpenBot never writes to Stripe.
- Right-click a pinned page in the rail and select Unpin to remove it from the rail. The page stays
  in the More menu.
- The CRM also works on a joined server, in the desktop app and in the web client. The server must
  also be on this version. The CRM switch belongs to the server, so it applies to every owner and admin
  of that server.
