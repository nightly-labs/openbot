---
name: "Outreach Draft"
description: "Draft a first business message built on one verified reason to write and one clear request. Length fits the channel. Without evidence, it writes an honest general draft instead of fake personalization, and it lists the claims the user must confirm. It never sends."
---

# Outreach Draft

## When to use

- A first message or a follow-up to a company or a business contact.
- After an Account Brief, to turn its evidence into a message.
- Not for bulk sequences or list building. This skill writes one message at a time.

## Inputs

1. **Recipient and channel.** Company, role or named business contact, and the channel: email, a professional
   network message, a connection note, or a follow-up.
2. **The offer.** What the user sells and one result it gives. Use only facts that the user gives or that their
   public pages state.
3. **The reason to write.** Tool path: an Account Brief in this chat, or a public company page read in
   `openbot_browser`. Paste path: notes the user gives. If there is no reason with a source, write the honest
   general draft.
4. **Restrictions.** Opt-outs, "do not contact" notes, or company rules that the user states.

## Steps

1. Pick one reason to write. It must have a source: a page, a date, a post by the company. Record it.
2. Pick one request. Make it small: a 15-minute call, a yes or no question, permission to send one resource.
3. Write the draft: the reason in the first sentence, why it matters to them in one or two sentences, the request.
4. Fit the length to the channel (see the checks).
5. Write one alternate draft with a different reason or a different request. Say when to use it.
6. List every claim in the draft that the user must confirm: product results, customer names, numbers, prices.
7. For a follow-up, add new value (a fact, a resource, a different question). Do not repeat the first message.

## Checks

- **Reason:** one, with a source. If none, the draft says why you write in general terms, with no fake detail.
- **Request:** exactly one.
- **Familiarity:** no "I loved your post", "as we discussed", shared contacts or past meetings unless the user
  confirms them.
- **Length:** email 60 to 120 words with a subject of 6 words or fewer; network message 40 to 80 words; connection
  note under 200 characters; follow-up under 60 words.
- **Urgency:** no false deadlines or scarcity.
- A draft passes when all checks pass. Fix a failed check before you show the draft.

## Output

```
Channel: email. Recipient: Head of Support, <company>.
Reason: <fact> (source: <page title>, read <date>)

Subject: <6 words or fewer>
<draft>

Alternate (use if <condition>):
<draft>

Claims to confirm before sending
- "cut response time by 30%": from your case study? Confirm the number and that it can be named.
```

## Approvals and stop conditions

- Never send, schedule, or add a contact to a sequence. Never send a connection request.
- On request, save the draft in a signed-in mail tab as a draft. Do not press Send.
- Do not look up or guess personal email addresses or phone numbers.
- Stop if the user asks to write to someone who opted out. Say so.

## Common failures

- Personalization that the evidence does not support.
- Two or three requests in one message.
- A long company pitch before the reason to write.
- Numbers about the user's product that nobody confirmed.
- A follow-up that only says "bumping this".
