---
name: "Support Reply"
description: "Draft a customer reply that states what is known and the next step, plus a separate internal note and, when needed, an escalation package with repro steps, account facts and impact. No refunds, exceptions or dates without a policy that allows them. Sends only on an explicit request."
---

# Support Reply

## When to use

- A customer message needs an answer: a question, a bug report, a billing or account request.
- A ticket must go to another team with everything they need.
- Not for fixing the product. Use Bug Triage to find the cause of a technical issue.

## Inputs

1. **The ticket.** Tool path: the helpdesk or shared inbox in a signed-in tab (`openbot_browser.list_tabs` first),
   or an installed plugin found with `tool_search`. Paste path: the message text the user gives.
2. **Product facts.** The help center, documentation, release notes or status page, read in the browser, or text
   the user gives.
3. **Policy.** The written refund, credit, SLA or exception policy. Without one, you can promise nothing about
   money or dates.
4. **Account facts.** Plan, version, platform, dates, from the helpdesk or the admin view the user opens. Never ask
   the customer for a password, a full card number, or an API key.

## Steps

1. Restate the issue in one line, in the customer's words.
2. Split what you know into confirmed facts (with source) and suspected causes.
3. Decide the route with the rubric.
4. Write the reply: acknowledge the specific issue, give the confirmed answer or the next step, say what happens
   next and who acts. Use ordered steps only when they match the customer's product version.
5. Write the internal note: sources used, suspected causes, open questions, and what you did not check.
6. For Escalate, write the escalation package.
7. Read the reply against the checks. Remove any promise without a policy source.

## Rubric

- **Answer:** the documentation or a policy answers it. Reply only.
- **Answer and escalate:** you can give a next step now, but a fix, a refund decision or an account change needs
  another team.
- **Escalate now:** possible security issue, data loss, outage, legal threat, or a payment problem. Short holding
  reply, package to the owner.
- **Checks:** every factual sentence has a source; no promised refund, credit, exception, fix date or delivery
  date without a cited policy; no blame on the customer; no internal guesses in the reply; one clear next step.

## Output

```
Route: Answer and escalate

Reply (draft, not sent)
Hi <name>,
<acknowledge the specific issue>
<confirmed answer or next step>
<what happens next and when, only if a policy or the owner gives the date>
<sign-off>

Internal note
- Confirmed: <fact> (source: <help article, ticket field>)
- Suspected: <cause> (not confirmed)
- Not checked: <...>

Escalation package
- Summary: <one line>
- Repro: 1. ... 2. ... Expected: ... Actual: ...
- Account facts: plan <...>, version <...>, platform <...>, first seen <date>
- Impact: <users affected, blocked workflow, money at stake>
- Evidence: <ticket id, screenshots, error text>
- Ask: <the decision or fix needed>
```

## Approvals and stop conditions

- Send only when the user says to send this reply. "Looks good" is not a send instruction; ask.
- Do not issue refunds or credits, change plans, reset accounts or close tickets without the user's yes.
- Remove secrets, tokens and card numbers from the internal note and the package. Write "[redacted]".
- Stop and use Escalate now for anything that looks like a security issue or data loss.

## Common failures

- "We will fix this by Friday" with no owner who said so.
- A refund or exception offered because the customer is upset, without a policy.
- Internal guesses about the cause in the customer reply.
- An escalation that the next team cannot reproduce.
- A long generic apology and no next step.
