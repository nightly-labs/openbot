// The text of the terms and conditions. Legal wording: change it only from the approved source text,
// and move `TERMS_UPDATED_AT` with it.

import { Link } from "@tanstack/solid-router";

const CONTACT_EMAIL = "hello@openbot.run";
const PRICING_LABEL = "http://openbot.run/pricing";

export function Terms() {
  return (
    <>
      <p>Please read the Terms &amp; Conditions carefully before you start to use the Platform.</p>

      <h2>Acceptance of the Terms &amp; Conditions</h2>
      <p>
        These Terms &amp; Conditions ("Terms") govern the use of OpenBot and form a legally binding agreement between
        you and OpenBot. By accessing or using the Services, you agree to these Terms. If you are acting on behalf of an
        organization, you represent that you have the authority to accept these Terms on its behalf.
      </p>

      <h2>Accounts and Eligibility</h2>
      <p>
        To access or use the Platform, you must be at least 16 years old and have the legal capacity to enter into a
        binding agreement. By using the Platform, you represent that you meet these requirements.
      </p>
      <p>
        You are responsible for maintaining the confidentiality and security of your account credentials and for all
        activities conducted through your account. You agree to notify OpenBot without undue delay if you become aware
        of any unauthorised access to or use of your account or any other security incident affecting your account.
      </p>

      <h2>Services description</h2>
      <p>
        OpenBot is a source-available platform that enables users to create, configure, manage, and collaborate with
        artificial intelligence agents ("AI Agents").
      </p>
      <p>Depending on the selected functionality, users can:</p>
      <ul>
        <li>create and customise AI Agents for specific tasks and workflows;</li>
        <li>organise AI Agents into teams and shared working environments;</li>
        <li>assign tasks, manage queues, and schedule recurring activities;</li>
        <li>enable communication and collaboration between AI Agents;</li>
        <li>connect external AI providers, applications, tools, and services;</li>
        <li>manage agent workspaces, files, and generated outputs;</li>
        <li>access supported browser automation and computer interaction features;</li>
        <li>discover, install, and share agents, plugins, and skills through the Marketplace;</li>
        <li>collaborate with other authorised users; and</li>
        <li>operate OpenBot on their own devices or servers or through optional hosted server services.</li>
      </ul>
      <p>OpenBot acts as a software environment for accessing and coordinating AI technologies.</p>
      <p>
        The availability of individual features may depend on the user's device, operating system, selected AI provider,
        connected services, account configuration, and subscription plan.
      </p>

      <h2>Non-Commercial Use</h2>
      <p>
        OpenBot is available free of charge for personal and non-commercial use, subject to the software licence
        applicable to the relevant version.
      </p>
      <p>
        Users may operate OpenBot on their own computers without purchasing a Hosted Server or a Commercial License.
      </p>

      <h2>Commercial Use</h2>
      <p>
        Commercial Use of OpenBot requires a valid Commercial License, unless otherwise permitted under the applicable
        software licence.
      </p>
      <p>OpenBot offers two Commercial License plans:</p>
      <ul>
        <li>Starter License – intended for one individual user (one Seat).</li>
        <li>
          Team License – intended for teams of at least five individual users (a minimum of five Seats), with the option
          to purchase additional Seats.
        </li>
      </ul>
      <p>
        Each Seat is assigned to one individual and may not be shared between users. AI Agents do not count as Seats.
      </p>
      <p>
        Commercial License subscriptions are available with monthly or annual billing periods. Current pricing and plan
        details are available on the <Link to="/pricing">{PRICING_LABEL}</Link> page.
      </p>
      <p>
        The detailed rules governing Commercial Licenses, including Seat assignments, additional Seats, renewals,
        cancellations, and commercial usage rights, are set out in the separate{" "}
        <Link to="/commercial-license">OpenBot Commercial License Agreement</Link>.
      </p>

      <h2>Hosted Server Services</h2>
      <p>
        OpenBot offers optional Hosted Server Services, allowing users to operate OpenBot on hosted infrastructure
        instead of their own computers or independently managed servers.
      </p>
      <p>
        The available Hosted Server plans include Starter, Standard, and Pro, which differ in their intended use,
        available resources, storage capacity, performance, and other technical characteristics.
      </p>
      <p>
        Hosted Server Services are purchased separately from Commercial Licenses. Purchasing a Hosted Server does not
        grant a Commercial License, and purchasing a Commercial License does not include a Hosted Server.
      </p>
      <p>
        Hosted Server subscriptions are available with monthly or annual billing periods. Current pricing, available
        plans, and their technical specifications are presented on the <Link to="/pricing">{PRICING_LABEL}</Link> page.
      </p>

      <h2>Pricing and Plan Selection</h2>
      <p>
        Users may select a Hosted Server plan and a Commercial License plan independently, according to their intended
        use and applicable licensing requirements.
      </p>
      <p>
        Discounts may be available for annual billing or for purchasing Hosted Server Services together with Commercial
        Licenses. The applicable discounts and final charges are presented before completing the purchase.
      </p>
      <p>All payments for Commercial Licenses and Hosted Server subscriptions are processed through Stripe.</p>
      <p>
        The renewal, cancellation, and termination of Commercial Licenses are governed by the Commercial License
        Agreement. The corresponding conditions for Hosted Server subscriptions are governed by the relevant provisions
        of these Terms.
      </p>

      <h2>Conclusion and Duration of the Agreement</h2>
      <p>
        An agreement for the use of the OpenBot Platform is concluded when the User completes the registration process
        and accepts these Terms.
      </p>
      <p>
        The use of OpenBot software is subject to the licence applicable to the relevant software version. Commercial
        Use is governed by the separate OpenBot Commercial License Agreement, which sets out the conditions for
        obtaining, renewing, and terminating Commercial Licenses.
      </p>
      <p>
        An agreement for paid Hosted Server Services is concluded upon completion of the applicable purchasing process.
        The provision of Hosted Server Services begins following successful payment confirmation and activation of the
        relevant server. Hosted Server subscriptions are separate from Commercial Licenses.
      </p>
      <p>
        The agreement for access to the Platform remains in effect until terminated in accordance with these Terms. The
        duration, renewal, and termination of Commercial Licenses and Hosted Server subscriptions are governed by their
        respective contractual conditions.
      </p>

      <h2>Technical Requirements</h2>
      <p>
        Access to and use of OpenBot requires a compatible device, an operating system supported by the relevant
        software version, and any additional technical components necessary for the selected functionalities.
      </p>
      <p>
        An internet connection is required for account registration, authentication, and certain online functionalities,
        including Hosted Server Services, remote access, and third-party integrations. Depending on the selected
        configuration, certain functionalities may require additional software, compatible AI models, or access to
        external services.
      </p>
      <p>
        Users operating OpenBot on their own devices or independently managed infrastructure are responsible for
        ensuring that their operating environment meets the applicable technical requirements and is appropriately
        configured and maintained.
      </p>
      <p>
        Information about supported operating systems, compatibility, installation procedures, and other technical
        requirements is available through the official OpenBot website and documentation.
      </p>

      <h2>Acceptable Use and Prohibited Activities</h2>
      <p>
        You agree to use the Platform and the Services in accordance with applicable laws, these Terms, and the rights
        of other users and third parties.
      </p>
      <p>You must not use the Platform, AI Agents, integrations, or other functionalities to:</p>
      <ul>
        <li>engage in unlawful, fraudulent, deceptive, or otherwise prohibited activities;</li>
        <li>
          infringe intellectual property rights, confidentiality obligations, privacy rights, or other legally protected
          interests;
        </li>
        <li>
          access or attempt to access accounts, systems, networks, files, or information without appropriate
          authorisation;
        </li>
        <li>introduce, distribute, or execute malware, malicious code, or other harmful software;</li>
        <li>
          interfere with the security, integrity, availability, or proper functioning of the Platform or connected
          systems;
        </li>
        <li>
          circumvent authentication mechanisms, access controls, or other technical restrictions without authorisation;
        </li>
        <li>impersonate another person or organisation or misrepresent your authority to act on their behalf;</li>
        <li>publish, transmit, or otherwise make available unlawful content; or</li>
        <li>
          instruct or authorise AI Agents to perform activities that would be unlawful if carried out directly by the
          user.
        </li>
      </ul>
      <p>
        You are responsible for ensuring that activities performed through the Platform, including automated tasks and
        interactions with external systems, remain within the scope of your legal rights and authorisations.
      </p>
      <p>
        OpenBot may take appropriate and proportionate measures in response to violations of these Terms, subject to
        applicable law.
      </p>

      <h2>Software Licence and Intellectual Property</h2>
      <p>
        The Software is made available under the licence applicable to the relevant version. The applicable software
        licences are available through the official OpenBot source code repository.
      </p>
      <p>
        Commercial Use of OpenBot requires a valid Commercial License, unless otherwise permitted under the applicable
        software licence. The relevant rights and conditions are governed by the separate OpenBot Commercial License
        Agreement.
      </p>
      <p>
        OpenBot and its associated intellectual property rights belong to Synthetify Labs sp. z o.o., except for
        third-party components, which remain subject to their respective licences.
      </p>
      <p>
        The OpenBot name, logos, trademarks, and other branding elements are protected by applicable intellectual
        property laws. Users may not use these materials without authorisation, except as permitted under applicable law
        or the relevant licence.
      </p>

      <h2>User Content and Intellectual Property Rights</h2>
      <p>
        Users may create, upload, import, submit, or otherwise make available documents, files, instructions, source
        code, agent configurations, and other materials through the Platform.
      </p>
      <p>Users retain their rights to User Content to the extent that such rights exist under applicable law.</p>
      <p>
        By providing User Content, you represent that you hold the necessary rights or authorisations to use that
        content and to make it available through the functionalities you choose to enable.
      </p>
      <p>
        You are responsible for ensuring that User Content does not infringe the rights of third parties or violate
        applicable laws.
      </p>
      <p>
        Where you choose to publish or share User Content through OpenBot's public sharing functionalities, you grant
        OpenBot a non-exclusive, worldwide, royalty-free licence to host, reproduce, display, distribute, and
        technically adapt that content solely to the extent necessary to provide the relevant publication or sharing
        functionality.
      </p>
      <p>
        This licence does not transfer ownership of User Content to OpenBot. It applies for the period during which the
        relevant content is made available through the Services, together with any additional period reasonably
        necessary to complete its removal, subject to applicable law.
      </p>
      <p>
        OpenBot does not acquire ownership of User Content solely because it is created, stored, or processed using the
        Platform.
      </p>

      <h2>AI-Generated Outputs</h2>
      <p>
        AI Agents may generate text, documents, source code, recommendations, analyses, images, or other outputs using
        the AI providers and configurations selected by users.
      </p>
      <p>
        The availability and scope of rights in AI Outputs depend on applicable intellectual property laws and, where
        relevant, the terms of the selected AI provider.
      </p>
      <p>
        OpenBot does not independently guarantee that AI Outputs qualify for intellectual property protection, are
        original, or do not resemble content generated for other users.
      </p>
      <p>
        Users are responsible for reviewing AI Outputs and ensuring that their intended use complies with applicable
        laws and third-party rights.
      </p>

      <h2>AI Agents and Automated Activities</h2>
      <p>
        OpenBot enables users to create and configure AI Agents capable of carrying out tasks, executing instructions,
        interacting with applications, and performing automated activities.
      </p>
      <p>
        Depending on the enabled functionalities, operating environment, and permissions available to the application,
        AI Agents may access and modify files, execute commands, interact with websites and external applications, use
        connected services, and communicate with other AI Agents.
      </p>
      <p>
        In the current development preview, AI Agents may operate with full system access after the User's initial
        consent, without requiring separate approval for each individual action. Their access may extend beyond
        designated agent workspaces, depending on the operating environment and applicable permissions.
      </p>
      <p>
        Certain functionalities, including Computer Use, may enable AI Agents to interact with applications and the
        graphical interface of the User's device. Such functionalities may require additional operating system
        permissions.
      </p>
      <p>
        You acknowledge that actions performed by AI Agents may affect your files, applications, connected accounts,
        systems, and other resources accessible to the relevant agent.
      </p>
      <p>You are responsible for:</p>
      <ul>
        <li>selecting and configuring AI Agents according to their intended purpose;</li>
        <li>defining appropriate instructions, permissions, and access restrictions;</li>
        <li>ensuring that AI Agents operate only within the scope of your authority;</li>
        <li>reviewing automated activities and their results where appropriate; and</li>
        <li>
          implementing suitable precautions, including backups and restrictions on access to sensitive or important
          resources.
        </li>
      </ul>
      <p>
        Users should exercise particular care when enabling functionalities that allow AI Agents to modify or delete
        information, execute commands, interact with external systems, or perform actions with legal, financial, or
        operational consequences.
      </p>
      <p>
        AI Agents operate using artificial intelligence technologies and may produce inaccurate, incomplete, unexpected,
        or otherwise unsuitable results.
      </p>
      <p>
        OpenBot does not guarantee that AI Agents will correctly interpret every instruction, successfully complete
        every task, or produce results suitable for a particular purpose.
      </p>
      <p>You should independently verify important AI Outputs and decisions before relying on them.</p>
      <p>
        AI-generated information does not constitute professional advice merely because it is produced through the
        Platform. Where appropriate, users should obtain advice from a qualified professional.
      </p>
      <p>
        Nothing in this section excludes any responsibility that OpenBot is required to assume under applicable law.
      </p>

      <h2>Third-Party AI Providers and Integrations</h2>
      <p>
        OpenBot allows users to connect AI providers, external applications, APIs, tools, and other services of their
        choice.
      </p>
      <p>Certain integrations may require separate accounts, subscriptions, API keys, credentials, or permissions.</p>
      <p>
        Users are responsible for obtaining and maintaining the authorisations necessary to use their selected
        third-party services.
      </p>
      <p>
        When connecting an external service, you agree to comply with its applicable terms and conditions, licensing
        requirements, and acceptable use rules.
      </p>
      <p>
        The availability, pricing, functionality, and technical requirements of third-party services are determined by
        their respective providers.
      </p>
      <p>
        Fees charged by external AI providers or connected services are separate from fees payable to OpenBot, unless
        expressly stated otherwise.
      </p>
      <p>
        OpenBot does not control the independent operation, commercial conditions, or availability of third-party
        services.
      </p>
      <p>
        OpenBot shall not be responsible for failures, interruptions, restrictions, or changes attributable exclusively
        to independently selected third-party services, except to the extent that such responsibility arises under
        applicable law.
      </p>

      <h2>Teams and Shared Environments</h2>
      <p>OpenBot enables users to collaborate within shared environments and to organise AI Agents into teams.</p>
      <p>
        Depending on the relevant configuration, authorised users may be able to access shared workspaces, manage
        agents, assign tasks, exchange information, and interact with resources made available to the team.
      </p>
      <p>
        Team owners and administrators are responsible for managing invitations, memberships, permissions, and access to
        their shared environments.
      </p>
      <p>
        Users must ensure that they have the necessary authority to invite other individuals, share resources, and grant
        access to information or connected services.
      </p>
      <p>
        Each user is responsible for activities performed using their own account and for complying with the permissions
        applicable to the relevant shared environment.
      </p>
      <p>
        Users must not attempt to access shared environments, information, or resources beyond the permissions granted
        to them.
      </p>

      <h2>Marketplace and Shared Materials</h2>
      <p>
        The OpenBot Marketplace allows users to discover, install, and, where supported, publish or share AI Agents,
        plugins, skills, and related configurations.
      </p>
      <p>Marketplace materials may be provided by OpenBot or by independent contributors.</p>
      <p>
        Users are responsible for reviewing the description, instructions, included functionalities, and relevant
        permissions of Marketplace materials before installing or enabling them.
      </p>
      <p>
        Certain Marketplace items may contain instructions, routines, or integrations that enable AI Agents to perform
        automated activities.
      </p>
      <p>
        The installation of a Marketplace item does not guarantee that it will be suitable, compatible, secure, or
        reliable for a particular purpose.
      </p>

      <h3>Publishing Materials</h3>
      <p>
        Users who submit or publish Marketplace materials represent that they hold the necessary rights to make those
        materials available and that their publication does not infringe applicable laws or third-party rights.
      </p>
      <p>
        Before submitting materials, users are responsible for ensuring that the submission does not contain
        confidential information, credentials, or other content that they are not authorised to publish.
      </p>
      <p>
        Materials submitted for publication may be subject to review. Submission does not guarantee approval or
        publication.
      </p>
      <p>
        OpenBot may reject, restrict, or remove materials that violate these Terms, infringe third-party rights, or are
        unlawful, subject to applicable legal requirements.
      </p>
      <p>
        Where required by applicable law, affected users will be informed of the reasons for restrictions imposed on
        their content and of the available means of redress.
      </p>

      <h3>Reporting Unlawful Content</h3>
      <p>
        Users and third parties may report publicly available materials in the OpenBot Marketplace that they consider
        unlawful, including materials that allegedly infringe intellectual property rights or other legally protected
        rights.
      </p>
      <p>Reports may be submitted through the electronic reporting mechanism designated by OpenBot.</p>
      <p>
        A report should contain sufficient information to identify and assess the allegedly unlawful material,
        including:
      </p>
      <ul>
        <li>an explanation of why the material is considered unlawful;</li>
        <li>the exact location of the material, such as a URL or another relevant identifier;</li>
        <li>
          the name and email address of the reporting person or entity, except where applicable law provides otherwise;
          and
        </li>
        <li>
          a statement confirming the reporting person's good-faith belief that the information provided is accurate and
          complete.
        </li>
      </ul>
      <p>
        OpenBot will assess reports in a timely, diligent, objective, and non-arbitrary manner, taking into account the
        information provided and the applicable legal requirements.
      </p>
      <p>Submission of a report does not automatically result in the removal of the reported material.</p>
      <p>
        Where appropriate, OpenBot may remove or restrict access to unlawful materials or materials that violate these
        Terms.
      </p>
      <p>
        Where electronic contact details have been provided, OpenBot will acknowledge receipt of the report and inform
        the reporting person or entity of the decision without undue delay, including information about available means
        of redress, as required by applicable law.
      </p>
      <p>
        Where OpenBot removes or restricts materials, affected Users will receive information about the reasons for the
        decision and available means of challenging it, where required by applicable law.
      </p>
      <p>
        OpenBot will comply with the applicable requirements of Regulation (EU) 2022/2065 (Digital Services Act),
        including those concerning notice-and-action mechanisms, content moderation, statements of reasons, and
        available remedies.
      </p>

      <h2>Local Use, Self-Hosting and Hosted Servers</h2>
      <p>
        OpenBot can operate on users' own devices, independently managed servers, or optional server environments
        provided by OpenBot.
      </p>

      <h3>Local and Self-Hosted Environments</h3>
      <p>
        Where users operate OpenBot on their own devices or infrastructure, they are responsible for ensuring that the
        relevant environment is appropriately configured and maintained.
      </p>
      <p>
        This includes maintaining compatible hardware, software, network connectivity, access permissions, and other
        technical resources necessary for the intended use.
      </p>
      <p>
        The availability and performance of independently managed environments depend on the user's infrastructure and
        configuration.
      </p>

      <h3>OpenBot Hosted Servers</h3>
      <p>
        OpenBot offers optional hosted server services that provide an environment in which users may operate AI Agents
        and collaborate with authorised team members.
      </p>
      <p>
        Hosted Server Services are intended exclusively for hosting and operating the OpenBot application and do not
        provide general-purpose server hosting.
      </p>
      <p>
        Hosted server plans may differ in processing resources, storage capacity, permitted team size, and other
        technical characteristics.
      </p>
      <p>
        The features and limits applicable to a particular plan are described in the relevant service information and
        purchasing interface.
      </p>
      <p>
        Hosted server subscriptions cover the provision of the server environment. They do not include access to
        third-party AI models or subscriptions unless expressly stated otherwise.
      </p>
      <p>
        Hosted servers may automatically stop after a period of inactivity and restart when activated through supported
        functionality. This may result in a delay before the relevant environment becomes available again.
      </p>
      <p>
        Users are responsible for managing the content and activities within their hosted environments and for
        maintaining appropriate copies of important information.
      </p>
      <p>
        Deleting a hosted server removes the associated server environment and its contents, subject to any technical or
        legal limitations described in the <Link to="/privacy-policy">Privacy Policy</Link>.
      </p>
      <p>
        Where OpenBot provides individually agreed hosting arrangements or other business services, additional
        contractual terms may apply.
      </p>

      <h2>Fees, Subscriptions and Payments</h2>
      <p>
        Certain OpenBot Services, including Commercial Licenses and Hosted Server Services, are available on a paid
        subscription basis.
      </p>
      <p>
        The applicable fees, billing periods, plan characteristics, and any additional charges are presented on the{" "}
        <Link to="/pricing">OpenBot Pricing</Link> page and during the purchasing process.
      </p>
      <p>
        Commercial Licenses are billed according to the number of Seats purchased and the applicable billing period, in
        accordance with the OpenBot Commercial License Agreement. Hosted Server Services are billed separately according
        to the selected hosting plan.
      </p>
      <p>
        Subscriptions may be purchased on a monthly or annual basis. Unless cancelled in accordance with the applicable
        contractual conditions, subscriptions automatically renew for successive billing periods.
      </p>
      <p>
        All payments for Commercial Licenses and Hosted Server Services are processed through Stripe. The applicable
        payment amount, currency, billing period, and taxes are presented before the purchase is completed.
      </p>
      <p>
        Fees for Commercial Licenses are payable in accordance with the Commercial License Agreement. Fees for Hosted
        Server Services are payable under the subscription conditions accepted by the User during purchase.
      </p>
      <p>
        Failure to complete a required payment may result in the restriction or termination of the corresponding paid
        Service or Commercial License, subject to the applicable contractual conditions and law.
      </p>
      <p>
        Changes to Commercial License fees are governed by the Commercial License Agreement. Changes to Hosted Server
        subscription fees are governed by the relevant provisions of these Terms.
      </p>
      <p>
        Cancellation of a Commercial License does not automatically cancel a separately purchased Hosted Server
        subscription, and cancellation of a Hosted Server subscription does not automatically terminate a Commercial
        License.
      </p>

      <h3>Hosted Server Subscription Cancellation</h3>
      <p>
        Hosted Server subscriptions automatically renew for successive billing periods, either monthly or annually,
        until cancelled by the User. The fee for each subsequent period is charged at the beginning of that period, in
        accordance with the selected subscription plan.
      </p>
      <p>
        Users may cancel their subscriptions at any time through the subscription management settings. Cancellation
        disables automatic renewal, and the User retains access to the Hosted Server until the end of the paid billing
        period. Once the subscription has been successfully cancelled, no further charges will be made for subsequent
        billing periods.
      </p>
      <p>
        If a payment for subscription renewal fails, access to the Hosted Server may be restricted after the end of the
        paid billing period. The User will be informed of the payment issue and the available options for resolving it.
      </p>
      <p>
        In the event of a change to subscription prices, OpenBot will inform the User sufficiently in advance of the
        next billing period, allowing the User to accept the new pricing terms or cancel the subscription. Any price
        change will not affect a subscription period that has already been paid for. If the User does not accept the new
        price, the subscription will terminate at the end of the paid billing period.
      </p>
      <p>
        In the event of an incorrectly charged fee, the User may submit a refund request using the contact details
        provided in these Terms, including the email address associated with their account, the payment date, and a
        brief description of the issue. OpenBot will respond to the request within 14 days of receipt.
      </p>

      <h3>Hosted Server Subscription Termination</h3>
      <p>
        Cancellation of automatic renewal does not, by itself, constitute a request to delete the Hosted Server or its
        stored content.
      </p>
      <p>
        Users may manage their Hosted Servers through the available billing functionality, including options to cancel
        renewal, retain server data, delete a server immediately, or schedule its deletion at the end of the paid
        billing period.
      </p>
      <p>
        When a paid subscription expires, the Hosted Server ceases to operate under that subscription. Where the User
        has not requested deletion, the expiry of the subscription does not itself constitute an instruction to delete
        the associated workspace data.
      </p>
      <p>
        If the subscription is not renewed, the associated Hosted Server data will be retained for 30 days following the
        expiry of the paid billing period. If the subscription is not renewed or reactivated within this period, the
        associated Hosted Server data will be deleted.
      </p>
      <p>Users may renew or reactivate an eligible subscription through the available billing functionality.</p>
      <p>
        Where a User chooses to delete a Hosted Server, the associated server environment and its contents, including
        agent workspaces, conversations, files, and related materials, are removed in accordance with the applicable
        functionality.
      </p>
      <p>
        Users are responsible for saving or exporting any content they wish to retain before deleting a Hosted Server.
      </p>
      <p>
        The termination of a Hosted Server subscription does not automatically terminate the User's OpenBot account or
        any separate agreements with third-party service providers.
      </p>

      <h2>Consumer Right of Withdrawal</h2>
      <p>Nothing in these Terms limits or excludes any mandatory rights concerning withdrawal from a contract.</p>
      <p>
        If you submit a refund request by email to <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a> within 2
        hours of completing your purchase, OpenBot offers a refund of 90% of the amount paid, retaining the remaining
        10% as an administrative handling fee, provided that this does not limit your mandatory statutory rights.
      </p>
      <p>
        If you are a consumer residing in the European Union, the United Kingdom, or Turkey and exercise your statutory
        right of withdrawal within 14 days of entering into a subscription agreement, you are entitled to a refund in
        accordance with applicable law. Where the provision of Services has begun at your express request during the
        withdrawal period, OpenBot may deduct an amount proportionate to the Services already provided, subject to
        applicable legal requirements.
      </p>
      <p>
        To exercise the right of withdrawal, the eligible User must inform OpenBot of their decision by an unequivocal
        statement sent to <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
      </p>
      <p>
        The statement should identify the agreement concerned and include sufficient information to identify the User
        and the relevant purchase.
      </p>
      <p>
        Where a valid withdrawal is exercised, OpenBot will reimburse the payments due under applicable law without
        undue delay and, where the 14-day statutory reimbursement deadline applies, no later than 14 days after
        receiving the withdrawal statement.
      </p>
      <p>Reimbursement will be made using the original payment method unless the User expressly agrees otherwise.</p>

      <h2>Complaints and Consumer Rights</h2>
      <p>
        Users may submit complaints concerning the operation of the Platform, the provision of Services, or the
        performance of contractual obligations using the contact details provided in these Terms.
      </p>
      <p>
        A complaint should, where possible, include information sufficient to identify the relevant Service or account,
        a description of the issue, and the remedy requested.
      </p>
      <p>OpenBot will review complaints and provide a response in accordance with applicable law.</p>
      <p>
        Complaints submitted by consumers will be answered within 14 days of receipt, unless a different period is
        prescribed by applicable law.
      </p>
      <p>The response to the complaint will be sent to the user by email.</p>
      <p>Nothing in these Terms excludes or restricts mandatory consumer rights.</p>

      <h2>Suspension and Termination of Access</h2>
      <p>
        OpenBot may suspend, restrict, or terminate access to the Platform or particular Services where reasonably
        necessary in connection with:
      </p>
      <ul>
        <li>serious or repeated violations of these Terms;</li>
        <li>unlawful activities or unauthorised use of the Services;</li>
        <li>threats to the security or integrity of the Platform or connected infrastructure;</li>
        <li>
          failure to fulfil payment obligations relating to paid Services, in accordance with the applicable contractual
          conditions; or
        </li>
        <li>compliance with applicable legal obligations or binding decisions of competent authorities.</li>
        <li>
          activities that may harm the Platform, compromise its security or integrity, or disrupt its proper operation.
        </li>
      </ul>
      <p>Any measures taken will be appropriate and proportionate to the circumstances, subject to applicable law.</p>
      <p>
        Where required by law, OpenBot will provide the affected user with information about the reasons for the
        restriction and any available remedies.
      </p>
      <p>
        Users may discontinue use of the Platform at any time and may request account deletion in accordance with the
        applicable procedures.
      </p>
      <p>
        Termination of access to the Platform does not automatically terminate separate agreements entered into with
        third-party AI providers or external services.
      </p>
      <p>
        Termination does not affect rights and obligations accrued before its effective date, including outstanding
        payment obligations, intellectual property rights, and provisions that by their nature remain applicable after
        termination.
      </p>

      <h2>Service Availability and Limitations of Liability</h2>
      <p>
        OpenBot aims to provide functional and reliable Services. However, the availability and performance of the
        Platform may depend on technical conditions, software configurations, network connectivity, third-party
        services, and other factors.
      </p>
      <p>
        OpenBot does not guarantee that every functionality will operate without interruption or that AI Agents will
        successfully complete every requested task.
      </p>
      <p>
        AI-generated outputs and automated activities may contain errors or produce unintended results. Users should
        exercise appropriate care when relying on such outputs or authorising actions that may affect important
        information or resources.
      </p>
      <p>
        Where the Platform relies on independently selected third-party AI providers or external services, their
        performance and availability remain subject to the conditions governing those services.
      </p>
      <p>
        OpenBot's liability for the performance of its own contractual obligations is determined in accordance with
        applicable law.
      </p>
      <p>
        To the extent permitted by applicable law, OpenBot is not responsible for losses resulting exclusively from
        unlawful or unauthorised user instructions, independently managed infrastructure, or circumstances attributable
        solely to external services outside OpenBot's reasonable control.
      </p>
      <p>Nothing in these Terms excludes or limits liability that cannot lawfully be excluded or restricted.</p>
      <p>
        In particular, these Terms do not affect mandatory consumer rights, statutory remedies, or liability arising
        from intentional misconduct.
      </p>

      <h2>Privacy and Data Protection</h2>
      <p>
        Personal data processed in connection with the Services is handled in accordance with the{" "}
        <Link to="/privacy-policy">OpenBot Privacy Policy</Link>, available through the official OpenBot website.
      </p>
      <p>
        Where required, the processing of personal data on behalf of a customer is additionally governed by a separate{" "}
        <Link to="/dpa">Data Processing Agreement</Link>.
      </p>
      <p>
        These Terms regulate the contractual use of the Platform, while the Privacy Policy provides information about
        the processing of personal data.
      </p>

      <h2>Export and Sanctions</h2>
      <p>
        Users must comply with all applicable export control, trade, customs, anti-boycott, and economic sanctions laws
        and regulations when accessing or using the Platform and the Services.
      </p>
      <p>
        Users represent that they are not located in, ordinarily resident in, organized under the laws of, or acting on
        behalf of any country, territory, entity, or person subject to sanctions, embargoes, or trade restrictions
        imposed under applicable laws, including the European Union, the United Nations, the United Kingdom, and, where
        applicable, the United States, if such sanctions or restrictions prohibit or restrict access to or use of the
        Platform or the Services.
      </p>
      <p>
        Users must not access, use, export, re-export, transfer, make available, or otherwise deal with the Platform,
        the Services, or any related technology in violation of any applicable export control, sanctions, or trade
        compliance laws.
      </p>
      <p>
        OpenBot may suspend, restrict, or terminate access to the Platform or the Services where it reasonably believes
        that continued access or use may violate applicable export control, sanctions, or trade compliance laws.
      </p>

      <h2>Governing Law</h2>
      <p>
        These Terms shall be governed by and construed in accordance with the laws of Poland, excluding its conflict of
        laws rules.
      </p>
      <p>
        If you are acting in the course of a business or professional activity, any dispute arising out of or in
        connection with these Terms, the Platform, or the Services shall be subject to the exclusive jurisdiction of the
        competent courts of Poland.
      </p>
      <p>
        If you are a consumer, nothing in these Terms limits or excludes any mandatory rights or protections available
        to you under applicable consumer protection laws. Any dispute involving a consumer shall be resolved by the
        courts having jurisdiction under applicable law.
      </p>

      <h2>Changes to the Terms</h2>
      <p>OpenBot may introduce improvements, updates, and new functionalities to the Platform and Services.</p>
      <p>
        OpenBot may amend these Terms to reflect changes in applicable laws, security requirements, operational
        practices, or the introduction and development of functionalities.
      </p>
      <p>
        You will always be informed of any amendments to these Terms with reasonable advance notice before the
        amendments take effect. Such notice will be provided by email and will specify the changes and their effective
        date.
      </p>
      <p>
        If you do not agree with the amended Terms, you may discontinue using the Platform and Services. If you hold a
        Commercial License, you may terminate your licence agreement in accordance with the OpenBot Commercial License
        Agreement and applicable law.
      </p>
      <p>
        Changes to Commercial Licenses, including licence fees, billing arrangements, and licensing conditions, are
        governed by the separate OpenBot Commercial License Agreement.
      </p>

      <h2>Miscellaneous</h2>
      <p>These Terms govern access to and use of the OpenBot Platform and the Services provided under them.</p>
      <p>
        The rights to use, modify, or distribute the Software are governed by the software licence applicable to the
        relevant version and, where applicable, the separate OpenBot Commercial License Agreement.
      </p>
      <p>
        Commercial Licenses are governed by the OpenBot Commercial License Agreement and the relevant Order. Hosted
        Server Services are governed by the applicable provisions of these Terms, unless separately agreed terms apply.
      </p>
      <p>
        Where an individual Enterprise agreement or other separate written agreement has been concluded, its provisions
        prevail over these Terms solely in relation to the subject matter expressly governed by that agreement.
      </p>
      <p>
        In the event of a conflict between these Terms and the applicable Commercial License Agreement concerning
        commercial licensing rights, Seat assignments, licence fees, or licence termination, the Commercial License
        Agreement shall prevail.
      </p>
      <p>
        These Terms do not replace or override any applicable software licence, Commercial License Agreement,{" "}
        <Link to="/dpa">Data Processing Agreement</Link>, or individually negotiated agreement.
      </p>
      <p>
        If any provision of these Terms is found to be invalid or unenforceable, the remaining provisions shall remain
        in effect to the extent permitted by applicable law.
      </p>

      <h2>Your Comments and Concerns</h2>
      <p>The Platform is operated by OpenBot:</p>
      <p>
        Synthetify Labs sp. z o.o.
        <br />
        KRS 0000895882
        <br />
        NIP 6812085952.
        <br />
        Trzebunia 513, 32-438 Trzebunia, Poland
        <br />
        +48 515901078
      </p>
      <p>
        All inquiries, feedback, comments, requests for technical support, and other communications concerning the
        Platform should be addressed to: <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
      </p>
    </>
  );
}
