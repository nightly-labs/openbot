// The text of the privacy policy. Legal wording: change it only from the approved source text,
// and move `PRIVACY_POLICY_UPDATED_AT` with it.

import { Link } from "@tanstack/solid-router";

const PRIVACY_EMAIL = "privacy@openbot.run";

function PrivacyEmail() {
  return <a href={`mailto:${PRIVACY_EMAIL}`}>{PRIVACY_EMAIL}</a>;
}

export function PrivacyPolicy() {
  return (
    <>
      <p>
        This Privacy Policy describes how Synthetify Labs sp. z o.o., a limited liability company incorporated under the
        laws of Poland, with its registered office at Trzebunia 513, 32-438 Trzebunia, Poland, registered in the Polish
        National Court Register (KRS) under number 0000895882, Tax Identification Number (NIP) 6812085952 ("OpenBot,"
        "we," "us," or "our"), processes personal data in connection with the Services.
      </p>
      <p>
        OpenBot is operated from Poland and is available to users worldwide. It provides a platform that allows users to
        create and manage AI agents, assign them tasks, and collaborate with them on a wide range of activities,
        including research, content creation, software development, project management, and workflow automation. Users
        can organise agents into teams, enabling them to communicate, share information, and work together on complex
        tasks.
      </p>
      <p>
        This Privacy Policy applies to the OpenBot website at <a href="https://openbot.run">https://openbot.run</a>, its
        applications, and related services (collectively, the "Services").
      </p>
      <p>
        By accessing or using the Services, you acknowledge that you have read and understood this Privacy Policy. If
        you do not agree with its terms, you should discontinue use of the Services.
      </p>
      <p>
        Contact: <PrivacyEmail />
        <br />
        Website: <a href="https://openbot.run">https://openbot.run</a>
      </p>

      <h2>About Our Services</h2>
      <p>
        OpenBot provides a source-available platform that enables users to create, customize, and manage AI agents to
        assist with various tasks, including research, content creation, software development, project management, and
        workflow automation. Users can assign specific roles to agents, organise them into collaborative teams, and
        automate recurring activities.
      </p>
      <p>
        The platform supports integrations with third-party AI providers and external applications, as well as a
        marketplace where users can discover, install, and share agents, plugins, and skills. Users can access their
        agents through supported devices, collaborate with other users, and choose between running OpenBot on their own
        computers or using optional hosted servers.
      </p>
      <p>
        OpenBot follows a local-first approach, under which conversations, files, agent workspaces, and related content
        are stored on the computer or server running the application. Certain features require the processing of
        personal data through OpenBot's infrastructure or third-party services, as described in this Privacy Policy.
      </p>

      <h2>Roles and Responsibilities</h2>
      <p>
        Depending on the nature of the personal data processed through the Services, OpenBot may act either as a data
        controller or a data processor, as defined under the General Data Protection Regulation (GDPR).
      </p>
      <ul>
        <li>
          <strong>OpenBot as a Data Processor</strong> – OpenBot acts as a Data Processor when it processes personal
          data on behalf of customers who act as Data Controllers, particularly in connection with hosted server
          services. In such cases, OpenBot processes personal data in accordance with the customer's documented
          instructions and applicable data protection laws.
        </li>
        <li>
          <strong>OpenBot as Data Controller</strong> – OpenBot acts as a Data Controller when it determines the
          purposes and means of processing personal data in connection with the operation and provision of the Services.
          This includes managing user accounts, authentication, subscriptions, payments, customer support, platform
          security, and service analytics.
        </li>
      </ul>
      <p>
        When users operate OpenBot on their own devices or independently managed servers, their conversations, files,
        and workspace data remain within their chosen environment. OpenBot does not act as a Data Processor solely by
        providing the software used to process such data.
      </p>
      <p>
        Where required under Article 28 GDPR, OpenBot enters into a{" "}
        <Link to="/dpa">Data Processing Agreement (DPA)</Link> with customers governing the processing of personal data
        on their behalf. Any international transfers carried out in this capacity are subject to applicable contractual
        requirements and appropriate data protection safeguards.
      </p>

      <h2>Data We Collect</h2>
      <p>
        OpenBot processes different categories of personal data depending on how users access and interact with the
        Services. Certain information is provided directly by users, while other information is generated automatically
        through account management, platform operation, analytics, and connected services.
      </p>

      <h3>Information we collect automatically</h3>
      <p>When users access or interact with the Services, OpenBot may process the following information:</p>
      <ul>
        <li>
          <strong>Technical and device information</strong> – application version, operating system, device type,
          browser information, connection status, and other technical information necessary for the operation and
          security of the Services.
        </li>
        <li>
          <strong>Usage and performance information</strong> – information about application activity, feature usage,
          agent operations, task execution, system performance, error categories, response times, and other operational
          events.
        </li>
        <li>
          <strong>Account and session information</strong> – account identifiers, session identifiers, authentication
          status, login timestamps, security events, and information required to maintain secure access to the Services.
        </li>
        <li>
          <strong>Website analytics and attribution information</strong> – visited public pages, selected interactions,
          download events, campaign parameters, referring domains, and information about how users discover and interact
          with the OpenBot website.
        </li>
        <li>
          <strong>Security information</strong> – IP addresses and other network information processed where necessary
          for authentication, protection against unauthorised access, abuse prevention, and service security.
        </li>
      </ul>
      <p>
        OpenBot uses analytics services to collect product usage data from production versions of its website and
        applications.
      </p>
      <p>
        Analytics events contain operational metadata, including feature usage, event types, provider and model
        identifiers, timing information, performance metrics, and application versions. When a user signs in, their
        OpenBot account ID and email address are processed for analytics purposes, allowing certain activities to be
        associated with their account. Additional information about their device, browser, operating system, network,
        and approximate geographic location may also be derived.
      </p>
      <p>
        Product analytics events do not contain conversation content, prompts, AI-generated responses, file contents,
        search queries, credentials, or raw application commands.
      </p>
      <p>
        Users can manage analytics preferences separately within the desktop, mobile, and web applications. However,
        certain events generated by the central account service, including subscription, payment, and hosted server
        lifecycle events, are collected independently of these preferences.
      </p>
      <p>
        These account-level events may include account identifiers, subscription details, payment status, amounts,
        currencies, and related operational information, but do not include payment card details.
      </p>

      <h3>Information You Provide</h3>
      <p>OpenBot may collect and process personal data provided directly by users, including:</p>
      <ul>
        <li>
          <strong>Account information</strong> – email address, display name, optional profile picture, and other
          information required to create and manage an OpenBot account.
        </li>
        <li>
          <strong>Authentication information</strong> – information necessary to verify identity, including email
          verification requests, authentication codes, session records, and related security information.
        </li>
        <li>
          <strong>Team and collaboration information</strong> – team memberships, assigned roles, invitations, server
          associations, and information necessary to manage access to shared environments.
        </li>
        <li>
          <strong>Subscription and billing information</strong> – subscription plans, billing periods, payment status,
          transaction references, and information required to administer paid Services.
        </li>
        <li>
          <strong>Support and communication information</strong> – information voluntarily provided when contacting
          OpenBot, requesting assistance, reporting a problem, or communicating with us.
        </li>
        <li>
          <strong>Marketplace and publicly shared information</strong> – agent templates, descriptions, instructions,
          skills, publication details, profile information, and other content users choose to publish or share through
          supported features.
        </li>
      </ul>
      <p>
        Payment transactions are handled through Stripe. OpenBot does not collect or store complete payment card numbers
        entered through Stripe's payment pages.
      </p>
      <p>
        Where users choose to publish content through the Marketplace or share public agent templates, certain
        information may become accessible to other users or anyone possessing the relevant public link.
      </p>

      <h3>Customer Data</h3>
      <p>
        "Customer Data" refers to information, content, materials, and files that users submit, create, upload, import,
        connect, or otherwise make available through the Services.
      </p>
      <p>Customer Data may include:</p>
      <ul>
        <li>conversations, messages, prompts, and instructions;</li>
        <li>documents, attachments, images, and other files;</li>
        <li>source code, databases, and project materials;</li>
        <li>AI agent configurations, memories, routines, and task histories;</li>
        <li>information obtained through connected applications and external services;</li>
        <li>browser content and information accessed during automated activities;</li>
        <li>personal data relating to users or third parties; and</li>
        <li>any other content processed by AI agents or related functionalities.</li>
      </ul>
      <p>
        Customer Data is stored on the computer or server running OpenBot and is not stored in OpenBot's central account
        database.
      </p>
      <p>
        Where users operate their own computers or servers, they retain control over the storage environment. Where they
        use hosted server services, Customer Data is stored within the infrastructure allocated to the relevant server.
      </p>
      <p>
        Depending on the selected functionality, Customer Data may be transmitted to third-party AI providers, connected
        applications, or other external services to perform tasks requested by users.
      </p>
      <p>
        OpenBot does not require Customer Data to contain any particular type of information, and users are solely
        responsible for the content they choose to make available through the Services and for ensuring that they have
        the necessary rights and legal basis to do so.
      </p>

      <h3>Information Obtained from Third Parties</h3>
      <p>
        OpenBot may process personal data obtained from third-party services when users enable integrations or authorise
        AI agents to access external applications and platforms.
      </p>
      <p>
        Depending on the connected service and the functionality used, such information may include account identifiers,
        names, messages, files, workspace details, repository information, and other content made available through the
        relevant integration.
      </p>
      <p>
        For example, integrations with communication platforms such as Slack, Discord, and Telegram may involve
        processing messages, attachments, and information relating to individuals participating in connected
        conversations or workspaces. These individuals are not necessarily registered OpenBot users.
      </p>
      <p>
        Information obtained through external integrations is processed to provide the functionalities requested by
        users and is generally stored within the computer or server operating the relevant OpenBot environment.
      </p>
      <p>
        Where OpenBot processes such information on behalf of a customer acting as a Data Controller, the customer is
        responsible for ensuring that the processing has an appropriate legal basis and that applicable information
        obligations towards the individuals concerned are fulfilled. OpenBot assists customers in meeting their
        obligations where required by law or contractual arrangements.
      </p>

      <h2>How We Use Information</h2>
      <p>OpenBot processes personal data for the following purposes:</p>
      <ul>
        <li>to provide, operate, maintain, and secure the Services;</li>
        <li>to create, authenticate, and manage user accounts;</li>
        <li>to enable AI agents to perform tasks and collaborate within user-defined environments;</li>
        <li>to support team management, invitations, permissions, and remote access;</li>
        <li>to provide optional hosted server services and manage server configurations;</li>
        <li>to administer subscriptions, payments, billing records, and related transactions;</li>
        <li>to enable integrations with third-party AI providers and external applications;</li>
        <li>
          to provide Marketplace functionality and facilitate the publication and sharing of agent templates, plugins,
          and skills;
        </li>
        <li>to communicate with users regarding accounts, service updates, security matters, and support requests;</li>
        <li>
          to monitor platform functionality, diagnose technical issues, prevent abuse, and maintain service security;
        </li>
        <li>
          to analyse service usage, performance, and operational trends in order to improve and develop the Services;
        </li>
        <li>
          to comply with applicable legal obligations, resolve disputes, enforce agreements, and protect the rights and
          legitimate interests of OpenBot, its users, and third parties.
        </li>
      </ul>
      <p>
        Where OpenBot processes Customer Data on behalf of a customer acting as a Data Controller, such processing is
        limited to the purposes specified in the applicable contractual arrangements and documented instructions.
      </p>

      <h2>Legal Basis for Processing</h2>
      <p>
        Where the General Data Protection Regulation (GDPR) or other applicable data protection laws apply, OpenBot
        processes personal data on the basis of a valid legal ground. Depending on the purpose and circumstances of
        processing, we rely on one or more of the following legal bases:
      </p>
      <ul>
        <li>
          <strong>Performance of a Contract – Article 6(1)(b) GDPR</strong> – where processing is necessary to provide
          the Services, manage user accounts, enable authentication and access to platform functionalities, administer
          subscriptions and payments, or fulfil our contractual obligations.
        </li>
        <li>
          <strong>Legitimate Interests – Article 6(1)(f) GDPR</strong> – where processing is necessary to operate,
          maintain, secure, improve, and develop the Services, prevent fraud and unauthorised access, monitor technical
          performance, respond to inquiries, protect our legal interests, or generate anonymised operational statistics,
          provided that such interests are not overridden by your rights and freedoms.
        </li>
        <li>
          <strong>Consent – Article 6(1)(a) GDPR</strong> – where processing requires your prior consent, including
          non-essential analytics technologies, marketing communications, or other optional processing activities. You
          may withdraw your consent at any time without affecting the lawfulness of processing carried out before
          withdrawal.
        </li>
        <li>
          <strong>Legal Obligations – Article 6(1)(c) GDPR</strong> – where processing is necessary to comply with
          applicable legal, regulatory, tax, or accounting requirements.
        </li>
      </ul>
      <p>
        Where OpenBot acts as a Data Processor, the relevant customer acting as Data Controller is responsible for
        determining the applicable legal basis for processing Customer Data. OpenBot processes such data in accordance
        with the customer's documented instructions and applicable data protection laws.
      </p>

      <h2>Provision of Personal Data</h2>
      <p>
        Providing certain personal data is necessary to create and manage an OpenBot account, access account-related
        functionalities, and use paid Services. This includes information required for authentication, account
        administration, and subscription management.
      </p>
      <p>
        Failure to provide the information necessary for these purposes may prevent users from creating an account,
        accessing particular functionalities, or purchasing paid Services.
      </p>
      <p>
        Other information, including optional profile details, content submitted to AI agents, and information shared
        through external integrations, is provided at the user's discretion and depends on the functionalities they
        choose to use.
      </p>
      <p>
        Users are not required to provide personal data that is unrelated to the Services or functionalities they wish
        to access, unless such processing is required by applicable law.
      </p>

      <h2>Use of Artificial Intelligence</h2>
      <p>
        OpenBot enables users to access and operate artificial intelligence technologies supplied by different
        providers, including OpenAI, Anthropic, Google, xAI, and other supported services or locally configured models.
      </p>
      <p>
        Users can select and configure AI providers according to their preferences, available subscriptions, and the
        requirements of their tasks.
      </p>
      <p>
        When an agent performs a task using an external AI provider, the information necessary to complete that task is
        transmitted to the selected provider. Depending on the activity, this may include prompts, conversation context,
        instructions, documents, file contents, tool results, and other information made available to the agent.
      </p>
      <p>
        When an agent uses the Computer Use functionality with an external AI provider, information retrieved from the
        user's screen and application interfaces is transmitted to that provider to perform the requested task.
      </p>
      <p>
        When users use voice dictation, audio is processed to convert speech into text. Depending on the selected
        functionality and device capabilities, this processing may take place locally or through external speech
        recognition services. Where external services are used, audio data is transmitted to the relevant provider and
        processed in accordance with its applicable privacy policy and terms.
      </p>
      <p>
        AI agents may also retrieve previously stored conversation context, memories, or relevant task information when
        required to complete a request. When users change an agent's AI provider, relevant conversation history and
        saved work context may be transmitted to the newly selected provider.
      </p>
      <p>
        OpenBot does not automatically transmit all locally stored Customer Data to every available AI provider. The
        information transferred depends on the provider, agent configuration, requested functionality, and user
        activity.
      </p>
      <p>
        Users may also connect locally hosted AI models or independently configured endpoints, in which case the
        applicable processing depends on the infrastructure and configuration selected by the user.
      </p>
      <p>
        Third-party AI providers process information in accordance with their applicable terms, privacy policies, and
        contractual arrangements. Their data retention, security practices, and possible use of information for model
        improvement or training may differ.
      </p>
      <p>
        OpenBot does not determine the data processing policies of independently selected AI providers. Users should
        review the relevant provider's terms before transmitting personal, confidential, or otherwise sensitive
        information.
      </p>

      <h2>Automated Decision-Making</h2>
      <p>
        OpenBot enables users to create and configure AI agents that can perform tasks, analyse information, and carry
        out automated activities based on their instructions.
      </p>
      <p>
        Depending on how the Services are used, these activities may involve the processing of personal data and
        automated decisions affecting individuals. Whether such processing falls within the scope of Article 22 GDPR
        depends on the nature, purpose, and consequences of the decisions involved.
      </p>
      <p>
        Where customers use the Services to process personal data as Data Controllers, they are responsible for ensuring
        that their use of automated decision-making complies with applicable data protection laws, including
        requirements relating to transparency, human oversight, and the protection of individuals' rights.
      </p>
      <p>
        OpenBot remains responsible for compliance with its own obligations under applicable data protection laws,
        including where it acts as a Data Controller or Data Processor.
      </p>

      <h2>Data Sharing</h2>
      <p>
        We may share personal data, including Customer Data where applicable, only where necessary to provide the
        Services, enable requested functionalities, comply with legal obligations, or protect our legitimate interests.
        Depending on how you use the Services, your personal data may be shared with the following categories of
        recipients:
      </p>
      <ul>
        <li>
          <strong>Service Providers</strong> – third-party providers that support the operation, maintenance, and
          security of the Services, including cloud infrastructure, hosted servers, authentication, payment processing,
          email delivery, technical support, and communication services. These providers include Cloudflare, Dedale AI,
          Corp. (operating as boat), and Stripe.
        </li>
        <li>
          <strong>Third-Party AI Providers</strong> – external AI providers, including OpenAI, Anthropic, Google, xAI,
          and other supported providers selected or configured by users. Customer Data necessary to perform requested
          tasks may be transmitted to these providers, including prompts, conversation context, documents, and other
          relevant information. Such information is processed in accordance with the applicable contractual arrangements
          and privacy policies of the respective providers.
        </li>
        <li>
          <strong>Third-Party Integrations</strong> – external applications, platforms, or services that users choose to
          connect to OpenBot, including Slack, Discord, Telegram, GitHub, and other supported integrations. Information
          shared with these services depends on the functionalities enabled by users and is subject to the applicable
          terms and privacy policies of the relevant providers.
        </li>
        <li>
          <strong>Authorised Users and Team Members</strong> – where users enable collaboration or shared access,
          certain information, including conversations, files, agent activities, and workspace content, may be
          accessible to other authorised users in accordance with their assigned roles and permissions.
        </li>
        <li>
          <strong>Professional Advisors</strong> – legal, tax, accounting, auditing, and other professional advisors who
          are bound by applicable confidentiality obligations.
        </li>
        <li>
          <strong>Competent Authorities</strong> – courts, regulatory authorities, law enforcement agencies, or other
          public bodies where disclosure is required by applicable law or is necessary to establish, exercise, or defend
          legal claims.
        </li>
        <li>
          <strong>Corporate Transactions</strong> – prospective or actual purchasers, investors, lenders, or other
          parties involved in a merger, acquisition, financing, restructuring, or sale of all or part of our business,
          subject to appropriate confidentiality and data protection safeguards.
        </li>
      </ul>
      <p>
        We do not sell or rent personal data to third parties. Where we engage third-party service providers to process
        personal data on our behalf, they are required to process such data in accordance with our documented
        instructions, applicable contractual arrangements, and data protection laws, including the implementation of
        appropriate technical and organisational security measures.
      </p>
      <p>
        Where users independently select or connect third-party AI providers or external services, those providers may
        process personal data under their own terms and privacy policies. OpenBot does not determine the purposes and
        means of processing carried out independently by such providers.
      </p>

      <h2>Third-Party Service Providers</h2>
      <p>
        OpenBot uses the following third-party service providers in connection with the operation and provision of the
        Services:
      </p>
      <ul>
        <li>
          <strong>Cloudflare</strong> – provides infrastructure and security services supporting the operation of the
          OpenBot website and related online functionalities.
        </li>
        <li>
          <strong>Dedale AI, Corp. (operating as boat)</strong> – provides cloud-based virtual server infrastructure
          used to host OpenBot Hosted Server environments.
        </li>
        <li>
          <strong>Stripe</strong> – processes payments and manages subscriptions for paid Services.
        </li>
      </ul>
      <p>
        These providers process personal data in accordance with their respective privacy policies, contractual
        arrangements, and applicable Data Protection Laws.
      </p>
      <p>
        Payment card and billing details are provided directly to Stripe through its payment pages. OpenBot receives
        only the information necessary to administer subscriptions and related transactions, including subscription
        plans, billing periods, payment statuses, amounts, and transaction references. OpenBot does not collect or store
        complete payment card numbers.
      </p>

      <h2>AI Providers and Optional Integrations</h2>
      <p>
        OpenBot allows users to select and configure third-party AI providers and connect external applications,
        platforms, tools, and services according to their individual needs and preferences. The range of available
        integrations depends on the services and configurations selected by users and is not limited to a predefined
        list of providers.
      </p>
      <p>
        When users enable external AI providers or integrations, personal data may be transmitted to the relevant
        services to perform the requested functionalities. Depending on the integration and the tasks performed, this
        may include prompts, conversation context, documents, files, and other information made available through
        connected services.
      </p>
      <p>
        Third-party providers process personal data in accordance with their applicable terms, privacy policies, and
        contractual arrangements. Depending on the nature of the service and the processing activities involved, these
        providers may act as independent Data Controllers or Data Processors. Where a third-party provider processes
        personal data on behalf of OpenBot, appropriate contractual arrangements and data protection safeguards apply.
      </p>
      <p>OpenBot does not sell or rent personal data to third parties.</p>

      <h2>Data Storage and Local Processing</h2>
      <p>
        OpenBot allows users to store and manage their conversations, files, and other content either on their own
        devices or on hosted servers, depending on how they choose to use the Services. Account information and other
        data necessary for the operation of the Services may be processed through OpenBot's central infrastructure, as
        described in this Privacy Policy.
      </p>

      <h2>Product Analytics and Anonymisation</h2>
      <p>
        OpenBot uses a self-hosted analytics service to monitor the performance, functionality, and use of the Services.
        The information collected includes feature usage, application activity, technical performance, error categories,
        and other operational statistics necessary to maintain and improve the Services.
      </p>
      <p>
        Product analytics data is anonymised and separated from individual user accounts, except for information
        relating to authentication and login, approximate geographic location, and payment or subscription management.
      </p>
      <p>
        Anonymised analytics data includes information about feature usage, application activity, technical performance,
        error categories, and other operational statistics. This information is processed without identifying individual
        users.
      </p>
      <p>
        Certain information remains identifiable where necessary for account authentication, security, and payment or
        subscription management. Payment card details are processed by Stripe and are not stored by OpenBot.
      </p>
      <p>
        OpenBot does not include conversation content, prompts, AI-generated responses, file contents, credentials, or
        other Customer Data in product analytics events.
      </p>
      <p>
        Users can manage available product analytics preferences through the relevant application settings. Certain
        account-related and payment or subscription events are processed independently of these preferences.
      </p>

      <h2>Data Security</h2>
      <p>
        OpenBot implements appropriate technical and organisational measures to ensure a level of security appropriate
        to the risks associated with the processing of personal data. These measures are designed to protect personal
        data against accidental or unlawful destruction, loss, alteration, unauthorised disclosure, or access.
      </p>
      <p>Our security measures include, where applicable:</p>
      <ul>
        <li>authentication and access controls;</li>
        <li>encrypted connections for remote communication;</li>
        <li>
          secure storage and protection of authentication credentials, access tokens, and other sensitive information;
        </li>
        <li>separation of centrally stored account information from locally stored Customer Data;</li>
        <li>data minimisation and restrictions on information included in analytics and diagnostic reports;</li>
        <li>technical monitoring and measures to prevent unauthorised access and misuse; and</li>
        <li>regular assessment and improvement of security practices.</li>
      </ul>
      <p>
        OpenBot allows users to store and manage Customer Data on their own devices or hosted servers. The security of
        data stored in user-managed environments also depends on the operating system, device configuration, access
        permissions, and security measures implemented by the relevant user or organisation.
      </p>
      <p>
        AI agents operating through OpenBot may access and modify local files, execute commands, interact with external
        applications, and perform other activities using the permissions available to the application. Users are
        informed of these capabilities and should carefully consider the information and resources made accessible to
        agents.
      </p>
      <p>
        Users are encouraged to configure integrations responsibly, restrict access to sensitive information where
        possible, and maintain appropriate backups and security measures.
      </p>
      <p>
        While OpenBot takes appropriate measures to protect personal data, no method of electronic transmission or
        storage can guarantee absolute security.
      </p>

      <h2>International Data Transfers</h2>
      <p>
        OpenBot is established in Poland and processes personal data primarily within the European Economic Area (EEA),
        including data stored on hosted servers located in the European Union.
      </p>
      <p>
        However, the provision of the Services may involve transfers of personal data outside the EEA, particularly
        where third-party infrastructure providers, payment services, AI providers, or external integrations process
        information in other jurisdictions.
      </p>
      <p>
        Where OpenBot transfers personal data outside the EEA, we ensure that such transfers comply with applicable data
        protection laws, including Chapter V of the GDPR.
      </p>
      <p>
        Where required, we implement appropriate safeguards, including adequacy decisions issued by the European
        Commission, Standard Contractual Clauses (SCCs), or other lawful transfer mechanisms recognised under the GDPR.
        Where necessary, supplementary technical and organisational measures are implemented to ensure an adequate level
        of protection.
      </p>
      <p>
        Users may contact us using the contact details provided in this Privacy Policy to obtain further information
        about applicable transfer safeguards and how to access them.
      </p>
      <p>
        Where users independently connect third-party AI providers or external services, the processing and
        international transfer of personal data by those providers are subject to their applicable contractual
        arrangements, privacy policies, and data protection obligations.
      </p>

      <h2>Data Retention</h2>
      <p>
        OpenBot retains personal data only for as long as necessary to fulfil the purposes for which it was collected,
        including providing the Services, maintaining account security, managing subscriptions, complying with
        applicable legal obligations, resolving disputes, and protecting our legitimate interests.
      </p>
      <p>Retention periods depend on the nature of the data, the purpose of processing, and the Services used:</p>
      <ul>
        <li>
          <strong>Account and Profile Data</strong> – retained for as long as the user maintains an active account. Upon
          account deletion, personal data associated with the account is deleted, unless further retention is necessary
          to comply with legal obligations or protect legitimate interests.
        </li>
        <li>
          <strong>Authentication and Security Data</strong> – retained for as long as necessary to maintain secure
          access to the Services. Expired or consumed authentication records are generally deleted within 24 hours after
          becoming inactive. Active sessions remain valid until they are terminated or revoked.
        </li>
        <li>
          <strong>Subscription and Payment Data</strong> – retained for as long as necessary to manage subscriptions,
          maintain billing records, comply with accounting and tax obligations, and resolve payment-related disputes.
          Payment information processed independently by Stripe is subject to Stripe's applicable retention policies.
        </li>
        <li>
          <strong>Analytics and Technical Data</strong> – personal data collected for analytics and technical purposes
          is retained only for as long as necessary for the relevant processing activities. Product analytics data is
          anonymised and separated from individual user identities, except for information necessary for authentication,
          approximate location data, and payment or subscription management. Once effectively anonymised, such
          information no longer constitutes personal data under the GDPR.
        </li>
        <li>
          <strong>Publicly Shared Content</strong> – agent templates and other content published through the Services
          remain available until removed or unpublished by the user. Limited technical records may be retained where
          necessary to maintain the integrity and security of the Services.
        </li>
        <li>
          <strong>Support and Communication Data</strong> – retained for as long as necessary to respond to inquiries,
          resolve reported issues, and fulfil any applicable legal obligations.
        </li>
      </ul>
      <p>
        Where OpenBot processes personal data on behalf of customers acting as Data Controllers, the retention and
        deletion of such data are governed by their documented instructions, applicable contractual arrangements, and
        legal requirements.
      </p>
      <p>
        Upon expiration of the applicable retention period, personal data is deleted or anonymised, unless further
        retention is required or permitted by applicable law.
      </p>

      <h2>Account Deletion and Data Removal</h2>
      <p>
        Users may request the deletion of their OpenBot account and associated personal data in accordance with
        applicable data protection laws.
      </p>
      <p>
        Upon account deletion, OpenBot removes personal data associated with the account from its central account
        services, except where continued retention is necessary to comply with legal obligations, protect legitimate
        interests, or maintain essential security and operational records.
      </p>
      <p>
        Because OpenBot allows users to store Customer Data on their own devices or independently managed servers,
        deleting an account does not automatically remove conversations, files, agent workspaces, or other information
        stored in those environments. Users are responsible for managing and deleting such locally stored data.
      </p>
      <p>
        Users who operate hosted servers can remove the relevant server environments through the available service
        functionality. Deleting a hosted server removes its associated storage environment, including conversations,
        attachments, and workspace data. Limited administrative records may remain where necessary to maintain the
        integrity and security of the Services.
      </p>
      <p>
        Content published through OpenBot's sharing functionalities, including publicly available agent templates, can
        be unpublished or removed. Certain identifiers and technical records may be retained to prevent previously used
        public links from being reassigned.
      </p>
      <p>
        Information processed independently by third-party providers, including payment services and external AI
        providers, is subject to their applicable retention and deletion policies.
      </p>
      <p>
        Users may contact OpenBot using the contact details provided in this Privacy Policy to request information about
        the deletion of their personal data or exercise their applicable privacy rights.
      </p>

      <h2>Your Privacy Rights</h2>
      <p>
        Depending on the applicable data protection laws, including the General Data Protection Regulation (GDPR), you
        may have the right to:
      </p>
      <ul>
        <li>access the personal data we hold about you;</li>
        <li>request the correction of inaccurate or incomplete personal data;</li>
        <li>request the deletion of your personal data where permitted by law;</li>
        <li>request the restriction of the processing of your personal data;</li>
        <li>object to the processing of your personal data where processing is based on our legitimate interests;</li>
        <li>
          receive your personal data in a structured, commonly used, and machine-readable format and request its
          transfer to another data controller where the applicable legal conditions are met;
        </li>
        <li>
          withdraw your consent at any time where processing is based on consent, without affecting the lawfulness of
          processing carried out before such withdrawal;
        </li>
        <li>
          not be subject to decisions based solely on automated processing, including profiling, that produce legal or
          similarly significant effects, except where permitted by applicable law.
        </li>
      </ul>
      <p>
        To exercise any of these rights, please contact us using the contact details provided in this Privacy Policy. We
        may request additional information where necessary to verify your identity before processing your request. We
        will respond without undue delay and generally within one month, subject to any extensions permitted by
        applicable law.
      </p>
      <p>
        Where OpenBot processes personal data solely on behalf of a customer as a Data Processor, requests relating to
        such personal data should generally be directed to the relevant customer acting as the Data Controller. OpenBot
        will assist its customers in responding to such requests where required by applicable law or contractual
        arrangements.
      </p>
      <p>
        If you believe that your personal data has been processed in violation of applicable data protection laws, you
        have the right to lodge a complaint with the competent supervisory authority.
      </p>
      <p>
        Depending on your country of residence, you may also have additional privacy rights under applicable local laws.
        OpenBot will honor such rights where required and will process related requests in accordance with the legal
        requirements applicable in your jurisdiction.
      </p>

      <h2>Use of cookies</h2>
      <p>
        OpenBot does not use cookies or similar technologies for advertising, marketing, behavioural profiling,
        analytics, or cross-site tracking.
      </p>
      <p>
        The Platform uses only strictly necessary cookies required to authenticate users, maintain secure user sessions,
        and ensure the proper operation and security of the Services. These cookies are essential for the functioning of
        the Platform and cannot be disabled without affecting its core functionality.
      </p>

      <h2>Children's Privacy</h2>
      <p>
        Our Services are not intended for individuals under the age of 16, or any higher minimum age required under
        applicable law. We do not knowingly collect or process Customer data from children. If we become aware that
        Customer information has been collected from a child in violation of this Policy, we will take appropriate steps
        to delete such information without undue delay.
      </p>

      <h2>External services</h2>
      <p>
        The Platform may integrate with or provide access to external services. The collection and processing of
        information by such services are governed by their own privacy policies and terms. OpenBot is not responsible
        for the privacy practices or content of any external services.
      </p>

      <h2>Changes and Updates</h2>
      <p>
        We reserve the right to modify or update this Privacy Policy at any time to reflect changes in our Services,
        legal requirements, or business practices. Any updates will be published on this page together with a revised
        "Last Updated" date. Where required by applicable law, we will provide additional notice of significant changes.
        Your continued use of the Services after the revised Privacy Policy becomes effective constitutes your
        acknowledgment of and agreement to the updated terms.
      </p>

      <h2>Contact</h2>
      <p>
        For any questions regarding this Privacy Policy, the processing of personal data, or the exercise of your data
        protection rights, please contact OpenBot using the following contact details:
      </p>
      <p>
        Email: <PrivacyEmail />
      </p>
    </>
  );
}
