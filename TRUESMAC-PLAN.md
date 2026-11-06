# TrueSMAC: from one useful report to a business command center

**Start with a follow-up desk.** Give it yesterday's enquiries. It returns the people who still need a reply, the person responsible, and a draft linked to the original enquiry. The owner can act without reading an AI conversation. Use the same workflow internally, sell it as a managed service, and put it in a customer app only after the service proves useful.

**Status:** Plan only. OpenBot has been used to delegate a test task and return an answer. No customer has tested or paid for this workflow. The buyer, targets, and time estimates below are proposals. There is no need for a new OpenBot release to run the first test.

## 1. What the owner and team will see

The eventual product has three views. **Today** shows what needs attention, who owns it, and why. **Work** shows an assignment, its source, result, and any decision it needs. **Results** shows what changed in the business. For the first trial all three can fit in one report in an OpenBot chat. A client later sees only their own queue and results.

Example with invented data: enquiry E-014 asked for a Friday appointment. The team's response deadline passed. The sales owner sees **Reply due**, a link to E-014, and a draft asking what time works. A second enquiry with a confirmed booking stays off the follow-up list. If the booking record is missing, the employee marks **Needs review**. It does not invent a booking, an owner, or an available slot.

The whiteboard supplies the operating model: the owner sets a goal, a captain owns the result, an employee does the work, and only exceptions return to the owner. Start with you as owner and one existing employee as both reviewer of the input and writer of the report. Add a second employee only when a measured bottleneck justifies the handoff. You should not need to assign each enquiry or read each thread.

## 2. Build it in this order

| Stage and estimated effort | What we do | Evidence required to move on |
| --- | --- | --- |
| 1. Internal replay, 1–2 working days | Pick one inbox or lead sheet and its owner. Write down what counts as overdue and what stops follow-up. Have a human label ten anonymized past enquiries before the employee sees them. Run the same input through OpenBot's main chat. | Every recommendation points to its source; no recommendations to contact an opted-out or booked person; rerunning produces no duplicate items. Inspect every missed or false follow-up. |
| 2. Internal daily use, 5 working days | Run one report per day. Compare it with the owner's normal process. Record input count, missed items, false alarms, review minutes, extra prompts, and run cost. | Proposed target: at least 90% of human-marked due items found, zero opt-out violations, and at least 30% less time on comparison days. Show raw counts. If volume is too small, extend the trial. If supervision consumes the savings, fix the workflow or stop. |
| 3. Managed service, 2–4 weeks plus customer recruitment | Interview three owners who already book work from inbound enquiries. Ask for one recent missed follow-up, who noticed, and what it cost. Offer one owner a fixed-scope paid trial: one source, one team, daily queue, weekly results. Use their deadlines and exclusions. | First buyer pays, uses the queue, and elects to continue. A second client can receive the same service by changing settings rather than code. Track both, along with delivery cost. |
| 4. Self-service pilot, estimate 4–8 weeks after repeat demand | Build one input connection, a rule setup screen, a test run, the Today queue, and a weekly report. Add client access, account isolation, usage limits, billing, and disconnect/export before wider rollout. | A new client connects their source and produces a correct first report without you running OpenBot. Test access across two client accounts, source failure, retry, and billing limits. Verify recurring price covers delivery and support. |
| 5. Expand the command center, one workflow at a time | Start with the next frequent request from paying users: for example, appointment reminders, sales reporting, or support triage. Give each workflow an owner, rules, and success measure. Add cross-team assignments when a real job crosses teams. | A client uses the new workflow repeatedly and pays enough to cover it. Keep the same Today, Work, and Results views as the product grows. |

## 3. How the first workflow runs

1. **Read one source.** For the replay, use a CSV containing an enquiry ID, time received, responsible person if known, last inbound and outbound times, booking status, contact preference, and a short redacted note. Use a fixed “as of” time, time zone, and business hours. Keep human labels in a separate answer sheet.
2. **Apply the team's rules.** Exclude opt-outs and closed or booked records. Compare the last message and the deadline. Give a pending item one of three results: reply due, waiting on customer, or needs review. Ask a human about missing or contradictory facts. Use fixed rules for times and exclusions; use the model to interpret notes or write drafts.
3. **Return one queue.** For each item show the source ID, owner or “unassigned,” reason, due time, and draft where appropriate. Include the number read and excluded so an empty queue can be checked. During the trial the owner sends any replies through the normal inbox. The report does not send anything.
4. **Close the loop.** Record corrections, action taken, and time spent. Use actual replies and bookings from the source for weekly results. Treat unknowns as unknown. Compare response times with the prior period and keep volume visible; a rise in bookings alone does not prove the tool caused it.
5. **Recover from failure.** If input is missing or stale, show the last successful read and the reason; do not say “nothing due.” After reconnection, resume from the last confirmed item and update existing entries by source ID. In the app the operator should be able to retry a failed run without duplicating work.

## 4. What to reuse, what to build, and who does it

| Part | First version | When demand is proven |
| --- | --- | --- |
| Operator workspace | Use OpenBot's main chat, an existing employee, a named assignment, and one written set of rules. Include the rules directly in the first task. No new plugin, team-wide script access, or release needed. | Store the proven rules as a versioned skill with example inputs and expected results. Add delegation only where it improves the outcome. |
| Customer records | The customer's inbox or CRM remains the source of truth. Use an anonymized export for the first trial. Use a separate, access-controlled environment per client before taking real client data. Do not treat two chat folders as customer isolation. | Add the one read-only connector used by the first paying clients. Store only what the report needs on the client's designated host. Test permissions, disconnection, restart, and removal with disposable accounts. |
| Customer product | Deliver a daily queue and a weekly scorecard in an agreed format. Record what the client actually uses and which fields they ignore. | Build a client view over narrowly scoped results. Reuse OpenBot as the operator workspace where it fits. Keep the customer app independent of employee count, model, and chat structure. Decide hosting from pilot requirements; keep client records and chats off the shared account service. |
| Ownership | Basheer picks the source, defines a good answer, and owns buyer conversations. Codex prepares the trial, compares outputs, and builds only the missing parts. The OpenBot employee produces the queue. The team's usual owner decides what to send. | The client sets deadlines, assigns owners, and handles exceptions. TrueSMAC owns reliability, onboarding, support, and costs. |

**First build order after the report proves useful:** source reader → rules and duplicate handling → saved run with source references → Today queue and retry → weekly results. Build one complete route through the system before adding another source. Defer multi-agent routing, a CRM replacement, a marketplace, and custom branding until an identified customer needs them.

## 5. Sales and cost decisions

The first buyer hypothesis is an owner of an appointment-based service business or small agency with one person responsible for inbound enquiries. The test offer is: **“Each working day, your team gets a verified list of enquiries that still need a reply, with an owner and draft for each.”** Ask which inbox already has enough volume to make that worthwhile. If three relevant owners cannot show examples or will not try it, revisit the problem before adding features.

Time the current process before setting a price. For the paid pilot, quote a fixed fee for a stated number of weeks, a limit on enquiries, and one source. State what is included and what would cost extra. Each week record **fee minus model costs, tools, and operator time at an agreed hourly rate**. Also record setup time separately. If the buyer wants to renew but delivery loses money, narrow the scope, change the price, or simplify the work before taking more clients.

A weekly scorecard needs only five lines: items received and due; correct and missed recommendations; replies sent and median response time; confirmed bookings; and minutes and money spent delivering the report. Keep client results separate from TrueSMAC's delivery costs. Route only ambiguous or disputed items to a stronger model if a comparison shows a measurable gain.

## Day one

**Basheer:** name one inbox or lead sheet whose owner can recognize a missed follow-up. **Codex:** prepare the sample format, the answer sheet, the employee assignment, and the comparison report. **OpenBot:** return one report from ten cases. If no suitable data is ready, use ten invented cases to check the mechanics; that does not count as customer validation or time saved.

First milestone: a human can open one report, trace each recommendation, and say which ones they would use. No new app screen is needed for that milestone.

## References

- [Command-center whiteboard](../../Desktop/command-center-whiteboard/how-cook-command-center-works.pdf): department ownership, handoffs, and reports to the owner.
- [Cook: reusable playbooks](https://trycook.ai/docs/what-is-a-playbook), [test a playbook](https://trycook.ai/docs/after-you-install), and [client portal](https://trycook.ai/docs/client-portal): operator workflow, safe rehearsal, and client delivery.
- [Serge's two-layer explanation](https://www.youtube.com/watch?v=3Mbzx7Pz06Y&t=184s) and [Cook's operator report](https://www.youtube.com/watch?v=FCEM8ikTPQM&t=298s): examples of the business system and the team that operates it. Their results are not forecasts for TrueSMAC.
