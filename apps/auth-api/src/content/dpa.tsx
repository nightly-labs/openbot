// The text of the data processing addendum. Legal wording: change it only from the approved source text,
// and move `DPA_UPDATED_AT` with it.

import { Link } from "@tanstack/solid-router";

export function Dpa() {
  return (
    <>
      <p>
        This Data Processing Addendum ("DPA") forms an integral part of the{" "}
        <Link to="/terms">OpenBot Terms &amp; Conditions</Link> or any other applicable agreement (the "Agreement")
        between Synthetify Labs sp. z o.o., operating as OpenBot (the "Processor"), and the customer accepting the
        Agreement (the "Controller").
      </p>
      <p>
        This DPA applies where OpenBot Processes Personal Data on behalf of the Controller in connection with the
        provision of the Services, particularly OpenBot Hosted Server Services.
      </p>
      <p>
        This DPA does not govern Personal Data processed by OpenBot as an independent Data Controller, including
        Personal Data processed for account administration, authentication, subscriptions, payments, billing, and other
        independent purposes described in the <Link to="/privacy-policy">OpenBot Privacy Policy</Link>.
      </p>
      <p>
        Where the Controller uses OpenBot exclusively on its own devices or independently managed infrastructure, and
        OpenBot does not Process Personal Data on the Controller's behalf, this DPA does not apply to such independently
        managed Processing.
      </p>
      <p>This DPA becomes effective upon acceptance of the OpenBot Terms &amp; Conditions by the Controller.</p>

      <h2>§ 1</h2>
      <p>
        For the purposes of this Data Processing Addendum ("DPA"), the following terms shall have the meanings set out
        below:
      </p>
      <ul>
        <li>
          <strong>"Agreement"</strong> means the OpenBot Terms &amp; Conditions or any other agreement concluded between
          the Parties governing the provision and use of the Services to which this DPA relates.
        </li>
        <li>
          <strong>"Controller"</strong> means the Customer entering into this DPA with the Processor, who determines the
          purposes and essential means of the Processing of Personal Data and entrusts such Processing to the Processor
          under this DPA.
        </li>
        <li>
          <strong>"Processor"</strong> means Synthetify Labs sp. z o.o., operating under the name OpenBot, insofar as it
          Processes Personal Data on behalf of the Controller pursuant to this DPA.
        </li>
        <li>
          <strong>"Personal Data"</strong> means any information relating to an identified or identifiable natural
          person, as defined in Article 4(1) GDPR.
        </li>
        <li>
          <strong>"Processing"</strong> means any operation or set of operations performed on Personal Data, whether or
          not by automated means, as defined in Article 4(2) GDPR.
        </li>
        <li>
          <strong>"Data Subject"</strong> means an identified or identifiable natural person whose Personal Data is
          Processed under this DPA.
        </li>
        <li>
          <strong>"GDPR"</strong> means Regulation (EU) 2016/679 of the European Parliament and of the Council of 27
          April 2016 (General Data Protection Regulation), as amended or replaced from time to time.
        </li>
        <li>
          <strong>"Data Protection Laws"</strong> means all applicable laws and regulations governing the Processing and
          protection of Personal Data, including the GDPR and applicable national data protection legislation.
        </li>
        <li>
          <strong>"Customer Data"</strong> means information, content, files, and other materials submitted, created,
          uploaded, imported, connected, or otherwise made available by or on behalf of the Controller through the
          Services, to the extent Processed by OpenBot on the Controller's behalf.
        </li>
        <li>
          <strong>"Services"</strong> means the services provided by OpenBot under the Agreement, particularly Hosted
          Server Services, insofar as they involve the Processing of Personal Data on behalf of the Controller.
        </li>
        <li>
          <strong>"Hosted Server Services"</strong> means the optional hosting services provided by OpenBot that enable
          the Controller to operate the OpenBot application and store and Process Customer Data within hosted server
          environments.
        </li>
        <li>
          <strong>"Personal Data Breach"</strong> means a breach of security leading to the accidental or unlawful
          destruction, loss, alteration, unauthorised disclosure of, or access to Personal Data transmitted, stored, or
          otherwise Processed, as defined in Article 4(12) GDPR.
        </li>
        <li>
          <strong>"Sub-processor"</strong> means any third-party Processor engaged by OpenBot to Process Personal Data
          on behalf of the Controller in connection with the provision of the Services.
        </li>
      </ul>

      <h2>§ 2</h2>
      <ol>
        <li>
          Where OpenBot Processes Personal Data on behalf of the Controller, the Controller acts as the Controller and
          OpenBot acts as the Processor.
        </li>
        <li>
          The Controller determines the purposes and essential means of the Processing, while OpenBot carries out
          Processing in accordance with documented instructions and applicable Data Protection Laws.
        </li>
        <li>Each Party shall comply with its respective obligations under applicable Data Protection Laws.</li>
      </ol>

      <h2>§ 3</h2>
      <ol>
        <li>
          The Parties agree that this DPA, together with the Agreement, sets out the Controller's documented
          instructions concerning the Processing of Personal Data by the Processor, including the nature, purposes, and
          scope of such Processing and any international transfers carried out on the Controller's behalf.
        </li>
        <li>
          The Processor shall Process Personal Data only in accordance with these documented instructions, unless
          otherwise required by applicable European Union or Member State law. In such cases, the Processor shall inform
          the Controller of the relevant legal requirement before Processing, unless prohibited by law on important
          grounds of public interest.
        </li>
        <li>
          The Processor shall immediately inform the Controller if, in its opinion, any instruction concerning the
          Processing of Personal Data infringes the GDPR or other applicable European Union or Member State data
          protection provisions.
        </li>
      </ol>

      <h2>§ 4</h2>
      <ol>
        <li>
          The categories of Personal Data Processed by OpenBot on behalf of the Controller depend on the Controller's
          use of the Services, particularly Hosted Server Services, and the information submitted, created, uploaded,
          imported, connected, or otherwise made available by the Controller or its authorised users.
        </li>
        <li>
          Personal Data may be contained in Customer Data, including:
          <ul>
            <li>
              Conversations and Communications – messages, prompts, instructions, conversation histories, and other
              communications processed through AI Agents or related functionalities.
            </li>
            <li>
              Documents and Files – documents, attachments, images, source code, databases, project materials, and other
              files containing Personal Data.
            </li>
            <li>
              AI Agent and Workspace Data – agent configurations, memories, routines, task histories, and information
              generated or processed during automated activities.
            </li>
            <li>
              Third-Party Integration Data – Personal Data obtained from external applications, connected services, and
              other sources authorised by the Controller.
            </li>
            <li>
              Browser and Application Content – information accessed through browser interfaces, connected applications,
              and other environments during the execution of tasks by AI Agents.
            </li>
            <li>
              Personal and Professional Information – names, contact details, professional information, communications,
              and other information relating to individuals contained in Customer Data.
            </li>
            <li>
              Other Customer Data – any other Personal Data submitted, accessed, generated, or otherwise Processed
              through the Services in accordance with the Controller's instructions.
            </li>
          </ul>
        </li>
        <li>
          The scope and categories of Personal Data depend on the Controller's configuration of the Services and the
          tasks performed by its AI Agents.
        </li>
        <li>
          OpenBot does not require Customer Data to contain any particular category of Personal Data. The Controller
          remains responsible for determining which Personal Data is made available through the Services, exercising
          appropriate caution when disclosing sensitive Personal Data, and ensuring that such Processing complies with
          applicable Data Protection Laws.
        </li>
      </ol>

      <h2>§ 5</h2>
      <p>
        The categories of Data Subjects whose Personal Data may be Processed by the Processor on behalf of the
        Controller depend on the nature of the Controller's activities, the configuration of the Services, and the
        Customer Data made available through the Services.
      </p>
      <ol>
        <li>
          Such Data Subjects may include, in particular:
          <ul>
            <li>employees, contractors, and other personnel of the Controller;</li>
            <li>clients, customers, and prospective customers of the Controller;</li>
            <li>business partners, suppliers, and their representatives;</li>
            <li>authorised users and individuals participating in shared workspaces or communications;</li>
            <li>
              individuals whose Personal Data is contained in documents, messages, files, or information obtained
              through connected applications and external services; and
            </li>
            <li>
              other individuals whose Personal Data is lawfully made available or Processed through the Services on
              behalf of the Controller.
            </li>
          </ul>
        </li>
        <li>
          The Controller remains responsible for determining the categories of Data Subjects whose Personal Data is
          Processed through the Services and ensuring that such Processing complies with applicable Data Protection
          Laws.
        </li>
      </ol>

      <h2>§ 6</h2>
      <ol>
        <li>
          OpenBot Processes Personal Data on behalf of the Controller solely for the purpose of providing the Services
          covered by this DPA.
        </li>
        <li>
          Depending on the Services used and the Controller's configuration, the nature of Processing may include the
          collection, receipt, recording, organisation, storage, retrieval, consultation, use, modification,
          transmission, disclosure by authorised means, restriction, and deletion of Personal Data.
        </li>
        <li>
          Such Processing may be carried out for the following purposes:
          <ul>
            <li>
              Hosted Server Services – providing and operating hosted environments in which the Controller may store and
              process conversations, files, AI Agent workspaces, and other Customer Data.
            </li>
            <li>
              AI Agent Operations – enabling AI Agents to access, analyse, generate, modify, and otherwise process
              information for tasks assigned by the Controller or its authorised users.
            </li>
            <li>
              Workspace and Task Management – supporting the organisation of agent configurations, memories, routines,
              task histories, and related workspace information.
            </li>
            <li>
              Team Collaboration – enabling authorised users and team members to access and collaborate within shared
              environments according to the permissions and configurations established by the Controller.
            </li>
            <li>
              Third-Party Integrations – enabling the processing and transmission of Customer Data through external
              applications, AI providers, or other services connected or configured by the Controller, in accordance
              with the applicable Processing arrangements.
            </li>
            <li>
              Automated Activities – enabling AI Agents to process information obtained from files, applications,
              browser content, and other resources made available through the Controller's environment.
            </li>
            <li>
              Service Maintenance and Security – maintaining, securing, and supporting the hosted environment and the
              Processing of Customer Data necessary for the provision of the contracted Services.
            </li>
          </ul>
        </li>
        <li>
          OpenBot shall not Process Personal Data entrusted by the Controller for purposes unrelated to the provision of
          the Services or outside the scope of the Controller's documented instructions, except where required by
          applicable law.
        </li>
        <li>
          The Controller determines the purposes of its use of the Services and remains responsible for the lawfulness
          of the Processing activities performed through its AI Agents, connected applications, and other configured
          functionalities.
        </li>
      </ol>

      <h2>§ 7</h2>
      <ol>
        <li>
          The Processor shall implement appropriate technical and organisational measures to ensure a level of security
          appropriate to the risks associated with the Processing of Personal Data, in accordance with Article 32 GDPR.
        </li>
        <li>
          In determining the appropriate security measures, the Processor shall take into account the nature, scope,
          context and purposes of Processing, as well as the risks to the rights and freedoms of Data Subjects.
        </li>
        <li>
          The Processor shall implement appropriate technical and organisational measures, including, where applicable:
          <ul>
            <li>authentication and access controls;</li>
            <li>encrypted connections for remote communication;</li>
            <li>
              secure storage and protection of authentication credentials, access tokens, and other sensitive
              information;
            </li>
            <li>separation of centrally stored account information from Customer Data;</li>
            <li>data minimisation and restrictions on information included in diagnostic reports;</li>
            <li>technical monitoring and measures to prevent unauthorised access and misuse; and</li>
            <li>regular assessment and improvement of security practices.</li>
          </ul>
        </li>
        <li>
          The Processor shall comply with the applicable information security policies and procedures established for
          the protection of Personal Data and shall review and update relevant security measures as appropriate.
        </li>
        <li>
          The Processor shall maintain a record of all categories of Processing activities carried out on behalf of the
          Controller, to the extent required under Article 30(2) GDPR, and shall make such records available to the
          competent supervisory authority upon request, in accordance with applicable Data Protection Laws.
        </li>
      </ol>

      <h2>§ 8</h2>
      <p>
        The Processor shall notify the Controller of any suspected Personal Data Breach without undue delay and, in any
        event, no later than 72 hours after becoming aware of an incident indicating a potential Personal Data Breach.
        Such notification shall be accompanied by relevant documentation concerning the incident, to the extent
        available at the time of notification.
      </p>

      <h2>§ 9</h2>
      <ol>
        <li>
          The Processor may disclose Personal Data entrusted by the Controller to entities authorised to receive such
          data under applicable law, including competent public authorities and law enforcement agencies.
        </li>
        <li>
          The Processor shall not disclose entrusted Personal Data to third parties except where authorised by the
          Controller, permitted under this DPA, or required by applicable law.
        </li>
        <li>
          Personal Data shall be Processed exclusively by the Processor or persons duly authorised to Process such data
          under its authority, subject to appropriate confidentiality obligations.
        </li>
        <li>
          By accepting this DPA, the Controller grants the Processor general written authorisation to engage
          Sub-processors. The Processor shall notify the Controller of any intended additions or replacements within a
          reasonable period before the changes take effect, allowing the Controller to object on reasonable data
          protection grounds. If an objection cannot be resolved, the Controller may discontinue using the affected
          Services in accordance with the applicable Agreement.
        </li>
        <li>
          The Processor shall ensure that each Sub-processor is bound by a written agreement imposing equivalent data
          protection obligations and shall remain responsible for its Sub-processors in accordance with Article 28(4)
          GDPR.
        </li>
        <li>
          The Controller acknowledges and authorises the engagement of Dedale AI, Corp. (operating as Boat) as a
          Sub-processor for the provision of Hosted Server Services. Boat provides the cloud infrastructure used to host
          OpenBot server environments and store and Process associated Customer Data. Any additions or replacements of
          Sub-processors shall be subject to the requirements set out in paragraph 4 above.
        </li>
      </ol>

      <h2>§ 10</h2>
      <p>
        The Controller shall be responsible for compliance with applicable laws and regulations governing the processing
        and protection of Personal Data, including Regulation (EU) 2016/679 of the European Parliament and of the
        Council of 27 April 2016 (General Data Protection Regulation – GDPR).
      </p>
      <ol>
        <li>
          The foregoing shall not exclude or limit the Processor's liability for processing entrusted Personal Data in
          breach of this DPA.
        </li>
        <li>
          The Processor shall be liable for damage arising from the Processing of Personal Data where it has failed to
          comply with its obligations under this DPA or has acted outside or contrary to the Controller's lawful
          instructions.
        </li>
      </ol>

      <h2>§ 11</h2>
      <ol>
        <li>
          Upon termination of the Agreement or completion of the relevant Processing activities, the Processor shall, at
          the Controller's choice, return or delete all Personal Data Processed on behalf of the Controller and delete
          any existing copies, unless applicable European Union or Member State law requires continued storage. Where a
          Hosted Server subscription expires without renewal, the associated Customer Data shall be retained for 30
          days, unless the Controller requests its earlier deletion. If the subscription is not renewed or reactivated
          within this period, the associated Customer Data shall be deleted.
        </li>
        <li>
          In connection with Hosted Server Services, the Controller may delete the relevant hosted server environment
          through the available service functionality. Deletion of a Hosted Server results in the removal of its
          associated storage environment, including conversations, attachments, files, and workspace data. Limited
          administrative records may be retained where necessary to maintain the integrity and security of the Services,
          subject to applicable Data Protection Laws.
        </li>
        <li>
          Personal Data stored on the Controller's own devices or independently managed infrastructure remains under the
          Controller's control and is not automatically deleted upon termination of the Agreement or deletion of an
          OpenBot account.
        </li>
        <li>
          The Processor shall make available to the Controller all information necessary to demonstrate compliance with
          its obligations under Article 28 GDPR.
        </li>
        <li>
          The Processor shall allow for and contribute to audits, including inspections, conducted by the Controller or
          an auditor mandated by the Controller.
        </li>
        <li>
          Audits shall, where practicable, be arranged upon reasonable prior notice and conducted in a manner that
          minimises disruption to the Processor's operations while protecting the confidentiality and security of
          information relating to other users and third parties. Such arrangements shall not restrict the Controller's
          mandatory audit rights under applicable Data Protection Laws.
        </li>
        <li>
          Where an audit identifies deficiencies in the Processor's compliance with this DPA or applicable Data
          Protection Laws, the Processor shall take appropriate corrective measures within 30 days of receiving the
          audit findings, unless a different timeframe is agreed upon by the Parties. Deficiencies requiring immediate
          action to prevent or mitigate risks to Personal Data shall be addressed without undue delay.
        </li>
      </ol>

      <h2>§ 12</h2>
      <ol>
        <li>
          The Processor shall assist the Controller, taking into account the nature of the Processing, through
          appropriate technical and organisational measures, insofar as possible, in responding to requests from Data
          Subjects exercising their rights under applicable Data Protection Laws.
        </li>
        <li>
          The Processor shall also assist the Controller, taking into account the nature of the Processing and the
          information available to it, in fulfilling its obligations concerning data security, Personal Data Breaches,
          data protection impact assessments, and consultations with supervisory authorities, where applicable.
        </li>
        <li>
          Where the Processor receives a request from a Data Subject concerning Personal Data Processed on behalf of the
          Controller, the Processor shall inform the Controller without undue delay and shall not respond to the request
          independently unless authorised by the Controller or required by applicable law. The Processor shall provide
          reasonable assistance to the Controller in handling such requests in accordance with paragraph 1 above.
        </li>
      </ol>

      <h2>§ 13</h2>
      <ol>
        <li>
          Any amendments to this DPA shall be made in writing, including electronic form where legally permissible,
          failing which such amendments shall be null and void.
        </li>
        <li>
          Any matters not expressly governed by this DPA shall be subject to the applicable provisions of Polish law,
          including the Polish Civil Code, without prejudice to the mandatory provisions of applicable Data Protection
          Laws.
        </li>
        <li>
          Any references in this DPA to applicable laws and regulations shall be construed as including any subsequent
          amendments, modifications, or replacements thereof, as well as any other applicable legislation governing the
          protection of Personal Data.
        </li>
        <li>
          Where the Processor materially breaches its obligations under this DPA or applicable Data Protection Laws, the
          Controller may request that the Processor remedy the breach within a reasonable period appropriate to its
          nature and severity. If the Processor fails to remedy the breach within that period, or where the breach
          cannot be remedied or requires immediate action to protect Personal Data, the Controller may terminate the
          Processing activities governed by this DPA. Following termination, the Processor shall return or delete the
          entrusted Personal Data in accordance with § 11 of this DPA.
        </li>
        <li>
          This DPA shall remain in force for the duration of the Agreement and, where necessary, thereafter for as long
          as the Processor Processes Personal Data on behalf of the Controller, including for the purposes of returning
          or deleting Personal Data in accordance with this DPA and applicable Data Protection Laws.
        </li>
      </ol>
    </>
  );
}
