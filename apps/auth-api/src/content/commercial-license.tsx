// The text of the commercial license agreement. Legal wording: change it only from the approved source text,
// and move `COMMERCIAL_LICENSE_UPDATED_AT` with it.

import { Link } from "@tanstack/solid-router";

const LICENSES_EMAIL = "licenses@openbot.run";
const PRICING_URL = "https://openbot.run/pricing";
const PRICING_LABEL = "openbot.run/pricing";

export function CommercialLicense() {
  return (
    <>
      <h2>1. Definitions</h2>
      <p>
        1.1 "Software" means the OpenBot software, in source and object code form, in all versions released during the
        Term.
      </p>
      <p>
        1.2 "Licensor" means Synthetify Labs spółka z ograniczoną odpowiedzialnością, with its registered office at
        Trzebunia 513, 32-438 Trzebunia, Poland, registered in the National Court Register under KRS number 0000895882.
      </p>
      <p>1.3 "Licensee" means the legal entity or individual identified in the Order.</p>
      <p>
        1.4 "Commercial Use" means any use of the Software by or on behalf of a legal entity, or by any individual
        acting in the course of a business, that is not permitted under the Non-Commercial License. This includes use by
        employees for work, internal business operations, work for clients, and hosting for third parties.
      </p>
      <p>
        1.5 Two licenses. This agreement is the commercial license for the Software (the "Commercial License").
        References in this agreement to "this license" mean the Commercial License. Any use that is not Commercial Use
        is governed by the PolyForm Noncommercial License 1.0.0 (the "Non-Commercial License"), which applies to that
        use independently of the Commercial License.
      </p>
      <p>
        1.6 "Seat" means one slot, purchased under an Order, that is filled by one individual, who may use it on any
        Server under that Order. A Seat may not be shared. AI agents do not count as Seats.
      </p>
      <p>
        1.7 "Order" means the order form or online checkout that specifies the number of Seats, the start date of the
        subscription, the Billing Period, and the Fee. Seats added under clause 2.4 form part of the same Order, at the
        Fee determined under clause 2.4.
      </p>
      <p>
        1.8 "Term" means the period from the start date in the Order until the end of the Billing Period in which the
        last Seat under the Order is cancelled, or the date on which this license is terminated, whichever is earlier.
      </p>
      <p>
        1.9 "Billing Period" means each period, as selected in the Order, beginning on the start date in the Order, or
        on a renewal date.
      </p>
      <p>
        1.10 "OpenBot" means the AI coworker workspace software released by the Licensor, including its agents, tools,
        and admin panel. "OpenBot" and "Software" are used interchangeably.
      </p>
      <p>
        1.11 "Competing Product" means a product or service whose primary function is to let users create, run, or
        coordinate AI agents, and which is offered to third parties, whether for a fee or as part of another product.
      </p>
      <p>
        1.12 "Affiliate" means any entity that directly or indirectly controls, is controlled by, or is under common
        control with the Licensor.
      </p>
      <p>1.13 "Business day" means any day other than a Saturday, Sunday, or public holiday in Poland.</p>
      <p>
        1.14 "Contributor License Agreement" or "CLA" means the agreement under which the Licensor accepts contributions
        to OpenBot, as published by the Licensor.
      </p>
      <p>1.15 "Fee" or "Fees" means the amounts payable for Seats under clauses 2.3, 2.4, 2.7, and 2.8.</p>
      <p>
        1.16 "Server" means one instance of the OpenBot application, either running on infrastructure operated by or for
        the Licensee or on a hosted server purchased from the Licensor under separate terms. A Server stores the
        workspace data of that instance, including agents, conversations, files, and team data, and runs AI agent tasks.
        A Server is linked to an Order when it is activated under the administrator account bound to the license.
      </p>

      <h2>2. License Grant, Seats, and Payment</h2>
      <p>
        2.1 Grant. Subject to payment of the Fees and compliance with this license, the Licensor grants the Licensee a
        non-exclusive, non-transferable, non-sublicensable (except as permitted by clause 5.1), worldwide license during
        the Term to use the Software for Commercial Use, for the number of Seats purchased. The license covers
        installing, running, displaying, and storing the Software, and modifying it for the Licensee's own Commercial
        Use in accordance with clause 6.2.
      </p>
      <p>
        2.2 Seat assignment. Each Seat is filled by one individual, added by email address to one or more Servers
        through the admin panel. Only that individual may sign in with the Seat. A Seat may not be shared between
        individuals. The total number of individuals added to Servers under the Order may not exceed the number of Seats
        purchased.
      </p>
      <p>
        2.3 Fees. The Fee per Seat per Billing Period is the amount shown for the selected currency on the Licensor's
        pricing page at <a href={PRICING_URL}>{PRICING_LABEL}</a> on the date of the Order, subject to clauses 2.4 and
        2.7. The Licensee may pay in the currencies offered on that page.
      </p>
      <p>
        2.4 Adding Seats. The Licensee may purchase additional Seats at any time through the admin panel. Added Seats
        are billed pro rata from the date they are added, at the Fee shown on the Licensor's pricing page at{" "}
        <a href={PRICING_URL}>{PRICING_LABEL}</a> on that date. To add individuals beyond the total Seats purchased, the
        Licensee must first purchase additional Seats.
      </p>
      <p>
        2.5 Reassignment. Individuals are added to a Seat by an invitation. To replace an individual, the Licensee must
        first remove that individual from every Server under the Order. The Seat is freed only when the individual has
        been removed from all Servers, and the removed individual then loses access. Only after the Seat is freed may it
        be assigned to a different individual by a new invitation.
      </p>
      <p>
        2.6 Cancellation. The Licensee may cancel any Seat at any time. A cancelled Seat remains active and billable
        until the end of the current Billing Period, after which access ends. No refund is due for the unused part of
        the Billing Period.
      </p>
      <p>
        2.7 Price changes. The Licensor may change the Fee for renewal periods by giving at least 30 days' written
        notice before the renewal date. From that renewal date, all Seats under the Order are billed at the changed Fee.
        Without such notice, each Seat renews at the Fee that applied to it in the previous Billing Period. A change
        does not affect the current Billing Period.
      </p>
      <p>
        2.8 Payment. Fees are payable in advance for each Billing Period. The first Fee is payable immediately on
        purchase. Each renewal Fee is due on the renewal date. The Licensor charges the payment method on file on the
        renewal date and issues the invoice for that charge. Fees are exclusive of VAT, which is added where due.
      </p>
      <p>
        2.9 A hosted server purchased from the Licensor is a separate service governed by separate terms and is not
        provided under this license. It does not grant a license for Commercial Use. Each individual who signs in to
        OpenBot for Commercial Use, whether on a hosted Server or a self-operated Server, needs a Seat.
      </p>
      <p>
        2.10 Changes to this license. The Licensor may update this license. An updated version applies to a Licensee
        from its next renewal date, after the Licensor has given at least 30 days' written notice. An updated version
        does not apply to the current Billing Period without the Licensee's written consent.
      </p>

      <h2>3. License Verification, Data, and Audit</h2>
      <p>
        3.1 License binding. The license is bound to the email address of the Licensee's administrator, as registered at
        purchase. Access to OpenBot is limited to individuals added to Seats on the Licensee's Servers through the admin
        panel.
      </p>
      <p>
        3.2 Data. The Licensor will store the following data about the Licensee:
        <br />
        (a) the administrator email address bound to the license;
        <br />
        (b) company and billing details provided at purchase, including company name, tax identification number, and
        registered office, together with invoice records. Payment card data is held by the payment provider and is not
        stored by the Licensor;
        <br />
        (c) the number of Seats purchased;
        <br />
        (d) the number of Seats in use;
        <br />
        (e) the number of connected devices.
        <br />
        The Licensor processes this data as controller, in accordance with its privacy policy published at{" "}
        <Link to="/privacy-policy">https://openbot.run/privacy</Link>, and only for the purposes of providing the
        Software, verifying Seats, billing, and support.
      </p>
      <p>
        3.3 Connection loss. If the license server cannot be reached, the Software continues to operate for 24 hours.
        After that, new sign-ins are blocked until the license is validated again. Temporary unavailability of the
        license server is not a breach of this license by the Licensor.
      </p>
      <p>
        3.4 Circumvention. The Licensee shall not disable, bypass, or alter the license verification, nor use the
        Software under an account other than the one bound to the license, or for more Seats than purchased.
      </p>
      <p>
        3.5 Audit. The Licensor may audit the number of Seats used under the Licensee's account. If the audit shows the
        Licensee has used more Seats than it has purchased, the Licensee shall pay the difference.
      </p>
      <p>
        3.6 Administrator change. The administrator email bound to the license may be changed only by contacting the
        Licensor. The Licensee shall submit a written request, including proof that the requester is authorized to act
        for the Licensee, namely an extract from the relevant company register dated no more than 30 days before the
        request, and identification of the requesting person. The Licensor will verify the request and complete the
        change within 3 Business days after receiving all required documents. The Licensor shall delete the submitted
        documents once verification is complete and shall keep only a record of the date of verification and the
        outcome. Seats and their assignments are not affected by the change, and the previous administrator loses admin
        rights when the change takes effect.
      </p>
      <p>
        3.7 No access to content. OpenBot runs on the Licensee's own infrastructure or on a hosted Server chosen by the
        Licensee. The Licensor does not receive the Licensee's conversations, files, prompts, or the commands executed
        by OpenBot. The license check transmits only the data described in clause 3.2. Where hosting is purchased
        through the Licensor, the Server is operated by a third-party hosting provider. The Licensor has no access to
        the data stored on it.
      </p>

      <h2>4. Support</h2>
      <p>
        4.1 Included support. Standard support is included in the Fee for every Seat. It covers reports of defects in
        the Software and questions about its installation and use, through the channels the Licensor publishes. The
        Licensor will respond to each support request within 3 Business days.
      </p>
      <p>
        4.2 Scope. Support does not cover custom development, third-party integrations, or problems caused by
        modifications made by the Licensee.
      </p>

      <h2>5. Restrictions</h2>
      <p>
        5.1 Hosting for third parties. The Licensee may host OpenBot, provide OpenBot, or give access to it to third
        parties as a hosted or managed service. Every individual who signs in to OpenBot through such a service must
        hold a paid Seat of the Licensee and is billed accordingly.
      </p>
      <p>
        5.2 Embedding. Embedding OpenBot in a product offered to third parties requires the Licensor's prior written
        consent.
      </p>
      <p>
        5.3 Flow-down. Where the Licensee provides OpenBot or access to it under clause 5.1, it shall require each of
        its customers to agree to terms no less protective of the Licensor than this license, and it remains responsible
        for its customers' compliance.
      </p>
      <p>
        5.4 Notices. The Licensee shall not remove, obscure, or alter any copyright, license, or trademark notice in
        OpenBot.
      </p>
      <p>
        5.5 No competing products. Except as permitted by clause 5.1, the Licensee shall not, in Commercial Use, use
        OpenBot to build, train, or operate a Competing Product.
      </p>
      <p>5.6 Seats. In Commercial Use, the Licensee shall not share a Seat between individuals (see clause 2.2).</p>
      <p>
        5.7 Integrations. The Licensee may connect OpenBot to any third-party software it uses in its business,
        including messaging, collaboration, and other services. Such a connection is not provision of OpenBot to a third
        party under clause 5.1 provided that OpenBot is not made available through such a connection to the general
        public or to persons outside the Licensee's organisation.
      </p>

      <h2>6. Intellectual Property</h2>
      <p>
        6.1 Ownership of the Software. The Licensor owns the Software and all intellectual property rights in it, except
        for third-party components included in the Software, which are licensed under their own terms. This license
        grants no rights other than those expressly stated.
      </p>
      <p>
        6.2 Modifications and contributions. The Licensee owns the modifications it makes to OpenBot. The Licensee may
        contribute a modification to the Licensor under the Contributor License Agreement, and upon acceptance, the
        Licensee assigns to the Licensor the copyright in that contribution as provided in the CLA. The Licensor may
        then use, modify, and distribute the contribution, including under the Non-Commercial License. Modifications
        that are not contributed may not be distributed to third parties in Commercial Use.
      </p>
      <p>
        6.3 Trademarks. The Licensee may refer to OpenBot by name to state that it uses OpenBot, provided that it does
        not alter the name or logo, does not suggest endorsement by the Licensor, and follows the trademark guidelines
        published at <Link to="/brand">openbot.run/branding</Link>, as updated from time to time. All rights in the
        OpenBot name and logo remain with the Licensor.
      </p>
      <p>
        6.4 Outputs. "Output" means any text, file, code, data, or other result generated by OpenBot or its agents at
        the Licensee's instruction. The Licensor does not claim any rights in the Output. The Licensor makes no warranty
        that the Output is protected by copyright or other intellectual property rights, or that it does not infringe
        third-party rights. The Licensee is responsible for reviewing and using the Output in compliance with law.
      </p>

      <h2>7. Confidentiality</h2>
      <p>
        7.1 Definition. "Confidential Information" means non-public information disclosed by one party to the other
        under this license, including: (a) the Licensee's data and Seat records, and (b) the terms of the Order, the
        Fees, and any pricing or discount terms agreed between the parties.
      </p>
      <p>
        7.2 Obligations. Each party shall use the other party's Confidential Information only to perform this license,
        and shall not disclose it to third parties except to its employees, contractors, and professional advisers who
        need to know it and are bound by equivalent obligations.
      </p>
      <p>
        7.3 Exceptions. Clause 7.2 does not apply to information that is or becomes public through no fault of the
        receiving party, was lawfully known to it before disclosure, or must be disclosed by law or by a court or
        authority, provided the receiving party gives the disclosing party prompt notice where legally permitted.
      </p>
      <p>
        7.4 Licensee data. The Licensor shall process the Licensee's data only as needed to provide the Software, verify
        Seats, and provide support, in line with clause 3.2.
      </p>
      <p>7.5 Duration. The obligations in this section survive for 5 years after the Term ends.</p>
      <p>
        7.6 Retention of personal data. The Licensor shall delete the Licensee's personal data, including administrator
        email address and Seat records, within 30 days after the Term ends, except data it must keep for accounting or
        tax purposes, which it shall keep for the period required by law and data needed to establish, exercise or
        defend legal claims, which it may keep for the applicable limitation period.
      </p>

      <h2>8. Warranty and Liability</h2>
      <p>
        8.1 Disclaimer. OpenBot is provided "as is", without warranty of any kind, express or implied, including
        warranties of merchantability, fitness for a particular purpose, and non-infringement, to the extent permitted
        by law.
      </p>
      <p>
        8.2 Excluded damages. Neither party is liable for indirect, incidental, special, or consequential damages, or
        for lost profits, to the extent permitted by law. Nothing in this section limits liability under the General
        Data Protection Regulation (GDPR) or Polish data protection law. This clause 8.2 does not apply to the indemnity
        under clause 9.1.
      </p>
      <p>
        8.3 Liability cap. The Licensor's total liability under this license is limited to the Fees paid by the Licensee
        in the 12 months before the event giving rise to the claim.
      </p>
      <p>
        8.4 Licensee obligations not capped. The Licensee's liability for breach of clause 3.4, Section 5, Section 6,
        Section 7, or clause 12.8, and for its payment obligations under Section 2, is not limited or excluded by this
        Section 8.
      </p>
      <p>
        8.5 Exceptions. Clauses 8.1 to 8.3 do not limit liability for intent or gross negligence, for damage to life or
        health, or for any liability that cannot be excluded under Polish law.
      </p>
      <p>
        8.6 Licensee responsibility. The Licensee is responsible for the actions taken by its users and agents using
        OpenBot, and for the results it relies on. The Licensee is responsible for backing up the data stored on its
        Servers.
      </p>
      <p>
        8.7 Third-party models. The Licensee may connect OpenBot to AI models or services provided by third parties. The
        Licensee is solely responsible for those connections and for compliance with the terms of each third-party
        provider. The Licensor does not provide, and gives no warranty for, those models or services.
      </p>

      <h2>9. Indemnification</h2>
      <p>
        9.1 Indemnification. Neither party is obliged to indemnify the other party for third-party claims under this
        license, except that the Licensee shall indemnify and hold harmless the Licensor against third-party claims
        arising from the Licensee's hosting of OpenBot, from the provision of OpenBot or access to it to third parties
        under clause 5.1 or 5.2, from Output under clause 6.4, or from any use of OpenBot by the Licensee or its users
        in breach of this license or applicable law, including claims relating to data processed on the Licensee's
        Servers. This obligation does not apply to the extent such claims arise from the Licensor's breach of this
        license.
      </p>

      <h2>10. Renewal and Termination</h2>
      <p>10.1 Term. The Term is defined in clause 1.8. Billing Periods run within the Term as defined in clause 1.9.</p>
      <p>
        10.2 Renewal. Each Seat renews automatically at the end of each Billing Period, unless the Licensee cancels it
        under clause 2.6. Renewal is subject to any change to the Fee under clause 2.7 and any updated version of this
        license under clause 2.10.
      </p>
      <p>10.3 Cancellation. Cancellation is governed by clause 2.6.</p>
      <p>
        10.4 Termination for breach. Either party may terminate this license if the other party materially breaches it
        and does not remedy the breach within 3 Business days after written notice. Non-payment that continues for 7
        days after the due date is a material breach.
      </p>
      <p>
        10.5 Termination by the Licensor. The Licensor may terminate this license on 90 days' written notice, effective
        at the end of the Billing Period in which the notice period ends.
      </p>
      <p>
        10.6 Effect of termination. On termination, the Licensee shall stop using OpenBot under this license and shall
        stop providing access to OpenBot to any third party under clause 5.1, and the Licensor may deactivate the
        license. If the Licensor terminates this license under clause 10.4, the Licensee is not entitled to a refund of
        any Fees paid, and Fees due up to the end of the current Billing Period remain payable. This clause does not
        affect any use governed by the Non-Commercial License. Clause 7.6 applies to personal data.
      </p>

      <h2>11. Governing Law and Jurisdiction</h2>
      <p>
        11.1 Governing law. This license is governed by the laws of the Republic of Poland, excluding its
        conflict-of-laws rules.
      </p>
      <p>
        11.2 Jurisdiction. Any dispute arising from this license shall be resolved exclusively by the Polish common
        court having jurisdiction over the Licensor's registered office.
      </p>

      <h2>12. General Provisions</h2>
      <p>
        12.1 Assignment. The Licensee may not assign or transfer this license, in whole or in part, without the prior
        written consent of the Licensor. The Licensor may assign this license to an Affiliate or to a successor of its
        business without the Licensee's consent, on written notice.
      </p>
      <p>
        12.2 Entire agreement. This license, together with the Order and the documents referred to in this license, is
        the entire agreement between the parties on its subject matter and replaces all prior agreements and
        understandings about it.
      </p>
      <p>
        12.3 Notices. Notices under this license must be in writing. Notices sent by email are in writing for the
        purposes of this license. The Licensor sends all notices to the Licensee by email to the email addresses in the
        Order. The Licensee shall keep those email addresses up to date. A notice sent by email to the Licensee takes
        effect when sent. Notices to the Licensor are sent by email to{" "}
        <a href={`mailto:${LICENSES_EMAIL}`}>{LICENSES_EMAIL}</a> or by registered mail to Trzebunia 513, 32-438
        Trzebunia, Poland, and take effect on receipt.
      </p>
      <p>
        12.4 Severability. If any provision of this license is held invalid or unenforceable, the remaining provisions
        remain in effect. The parties shall replace the invalid provision with a valid one that comes closest to its
        commercial purpose.
      </p>
      <p>12.5 No waiver. A failure or delay in exercising a right under this license does not waive that right.</p>
      <p>
        12.6 Order of precedence. If this license conflicts with an Order, this license prevails, unless the Order
        expressly states otherwise. The relationship between the Commercial License and the Non-Commercial License is
        governed by clause 1.5.
      </p>
      <p>
        12.7 Force majeure. Neither party is liable for failure or delay in performing its obligations, other than
        payment obligations, caused by events beyond its reasonable control, including natural disasters, war,
        government action, and widespread failure of public telecommunications or internet infrastructure. The affected
        party shall notify the other party promptly and make reasonable efforts to resume performance.
      </p>
      <p>
        12.8 Sanctions and export control. Each party shall comply with applicable sanctions and export control laws.
        The Licensee shall not use, export, or make available OpenBot in breach of those laws, including to persons or
        territories subject to sanctions.
      </p>
      <p>
        12.9 Survival. Clauses 3.5, 3.6, 6, 7, 8, 9, 10.6, 11, and 12 survive the end of the Term, together with any
        payment obligations accrued before the end of the Term.
      </p>
      <p>
        12.10 Language. This license is made in English only. No translation is authoritative, and no other language
        version has legal effect.
      </p>

      <h2>13. Acceptance</h2>
      <p>
        13.1 Electronic acceptance. The Licensee accepts this license electronically by completing the purchase at
        checkout, after entering its company name and tax identification number or other company identification number,
        and ticking a box confirming that the buyer is authorized to bind the Licensee. Acceptance takes effect when the
        purchase is completed.
      </p>
      <p>
        13.2 Record. The Licensor records the date and time of acceptance, the company name and identification number
        entered, the version of this license accepted, and the Order to which it relates. The Licensor will provide a
        copy of the accepted version to the Licensee on request.
      </p>
      <p>
        13.3 Authority. The person completing the purchase on behalf of the Licensee represents that they are authorized
        to bind the Licensee to this license.
      </p>
      <p>13.4 Version. The version accepted is the version published on the date of the Order.</p>
      <p>
        13.5 Business purpose. The person completing the purchase represents that the Licensee acts in the course of its
        business or profession, that this license is of a professional nature for the Licensee, and that the Licensee is
        not a consumer within the meaning of the Polish Consumer Rights Act or any equivalent law.
      </p>
    </>
  );
}
