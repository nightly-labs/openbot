// The text of the contributor license agreement. Legal wording: change it only from the approved source text,
// replace `public/openbot-cla.pdf` with it, and move `CLA_UPDATED_AT`.

import { Link } from "@tanstack/solid-router";
import { CLA_PDF_PATH } from "../lib/cla";

const LICENSES_EMAIL = "licenses@openbot.run";

export function Cla() {
  return (
    <>
      <p>
        <a href={CLA_PDF_PATH} download>
          Download the agreement as a PDF
        </a>{" "}
        to fill in and sign it.
      </p>

      <h2>For Individual and Corporate Contributors</h2>
      <p>
        This Contributor License Agreement ("Agreement" or "CLA") is entered into between Synthetify Labs sp. z o.o.,
        with its registered address at Trzebunia 513, 32-438 Trzebunia, Poland, operating the OpenBot project
        ("OpenBot"), and the individual or legal entity identified below (the "Contributor").
      </p>
      <p>
        The purpose of this Agreement is to clarify the intellectual property rights granted to OpenBot in connection
        with Contributions made to the OpenBot project.
      </p>
      <p>
        This Agreement applies to Contributions specifically identified and voluntarily submitted by the Contributor to
        OpenBot, including Contributions submitted after the execution of this Agreement. Each Contribution becomes
        subject to this Agreement upon its submission.
      </p>
      <p>
        Except for the licenses expressly granted under this Agreement, the Contributor retains all rights, title, and
        interest in their Contributions.
      </p>
      <p>
        Please complete and sign this Agreement, and then email a pdf copy to{" "}
        <a href={`mailto:${LICENSES_EMAIL}`}>{LICENSES_EMAIL}</a> only. Read this document carefully before signing and
        keep a copy for your records.
      </p>

      <h2>Contributor Type (select one)</h2>
      <ul>
        <li>Individual Contributor – a natural person contributing on their own behalf.</li>
        <li>
          Corporate Contributor – a legal entity contributing through its authorised representative, employees, or other
          persons acting on its behalf.
        </li>
      </ul>

      <h2>Contributor Details</h2>
      <ul>
        <li>Full Legal Name / Legal Entity Name</li>
        <li>Country of Residence / Registration</li>
        <li>Address</li>
        <li>Email Address</li>
      </ul>
      <p>
        <strong>For Corporate Contributors only:</strong>
      </p>
      <ul>
        <li>Name of Authorised Representative</li>
        <li>Position / Title</li>
      </ul>

      <h2>Definitions</h2>
      <p>
        <strong>"Contributor", "You", or "Your"</strong> means the individual or legal entity entering into this
        Agreement and granting the licenses specified herein.
      </p>
      <p>
        <strong>"Contribution"</strong> means any original work of authorship, including source code, software
        modifications, documentation, fixes, improvements, and other materials intentionally submitted by the
        Contributor to OpenBot for inclusion in, or use in connection with, the OpenBot project.
      </p>
      <p>
        <strong>"Submitted"</strong> means communicated to OpenBot or its authorised representatives through source code
        repositories, pull requests, issue tracking systems, electronic communications, or other contribution channels
        designated or accepted by OpenBot for the purpose of improving the project.
      </p>
      <p>
        <strong>"Work"</strong> means the OpenBot software project and associated materials maintained or managed by
        OpenBot, including modifications, extensions, and derivative works.
      </p>
      <p>
        <strong>"Corporate Contributor"</strong> means a legal entity that owns or is otherwise legally authorised to
        license the intellectual property rights in Contributions submitted on its behalf.
      </p>

      <h2>Grant of Copyright License</h2>
      <p>
        Subject to the terms and conditions of this Agreement, You hereby grant to OpenBot and recipients of software
        distributed by OpenBot a worldwide, non-exclusive, no-charge, royalty-free copyright license, granted for an
        indefinite period, with the right to grant an unlimited number of non-exclusive sublicenses, including for
        commercial purposes, to:
      </p>
      <ul>
        <li>reproduce, store, load, execute, and otherwise use Your Contributions, in whole or in part;</li>
        <li>
          publish, display, publicly perform, and make Your Contributions available to the public, including through
          electronic networks;
        </li>
        <li>
          modify, translate, adapt, and prepare derivative works based upon or containing Your Contributions, and
          combine them with other software;
        </li>
        <li>
          distribute, license, sublicense, and commercially exploit Your Contributions and derivative works, including
          as part of open-source, source-available, or proprietary software products.
        </li>
      </ul>
      <p>
        You expressly authorise OpenBot to exercise and authorise third parties to exercise the rights necessary to use
        and exploit modifications and derivative works of Your Contributions within the scope of this Agreement.
      </p>
      <p>The license is granted without additional remuneration.</p>
      <p>
        The Parties agree that the copyright license is granted for an indefinite period and may be terminated by the
        Contributor in accordance with applicable law.
      </p>
      <p>
        Nothing in this Agreement shall affect Your moral rights in Your Contributions to the extent such rights are
        recognised and cannot be waived under applicable law.
      </p>
      <p>
        You retain ownership of the copyright in Your Contributions and remain free to use and license them
        independently, subject to any applicable third-party rights. Nothing in this Agreement transfers copyright
        ownership to OpenBot.
      </p>

      <h2>Grant of Patent License</h2>
      <p>
        Subject to the terms and conditions of this Agreement, You hereby grant to OpenBot and recipients of software
        distributed by OpenBot a worldwide, non-exclusive, royalty-free patent license, effective for the duration of
        the applicable patent rights and irrevocable (except as stated below), to make, have made, use, sell, offer for
        sale, import, and otherwise transfer Your Contributions, whether independently or in combination with the Work,
        including portions of such combinations.
      </p>
      <p>
        You expressly authorise OpenBot to grant non-exclusive patent sublicenses to third parties, including for
        commercial purposes. The recipients of such sublicenses shall not be authorised to grant further patent
        sublicenses.
      </p>
      <p>
        This license applies only to patent claims licensable by You that are necessarily infringed by Your
        Contributions alone or by combination of Your Contributions with the Work to which they were submitted.
      </p>
      <p>
        If any entity institutes patent litigation against You or another entity, including a cross-claim or
        counterclaim, alleging that a Contribution or the Work incorporating it constitutes direct or contributory
        patent infringement, any patent license granted to that entity under this Agreement for the relevant
        Contribution or Work shall terminate as of the date such litigation is filed.
      </p>

      <h2>Authority to Submit Contributions</h2>
      <p>You represent that You are legally entitled to grant the licenses specified in this Agreement.</p>
      <p>
        For Individual Contributors: If an employer, client, or another third party holds intellectual property rights
        in Your Contributions, You represent that You have obtained the necessary permission, waiver, or other legal
        authorisation to submit those Contributions and grant the licenses under this Agreement.
      </p>
      <p>
        For Corporate Contributors: You represent that the person signing this Agreement on Your behalf is duly
        authorised to do so, that the individuals submitting Contributions on Your behalf are authorised to make such
        submissions, and that You own or otherwise hold the rights necessary to grant the licenses specified herein.
      </p>
      <p>
        If You are a Corporate Contributor, You agree to ensure that Contributions submitted on Your behalf are
        identifiable as such and to notify OpenBot of any changes affecting the authorisation of individuals submitting
        Contributions on Your behalf.
      </p>

      <h2>Original Contributions and Third-Party Rights</h2>
      <p>
        You represent that each of Your Contributions is Your original creation or that You otherwise possess the rights
        and authorisations necessary to submit and license it.
      </p>
      <p>
        You further represent that You have disclosed all third-party licenses, patents, trademarks, or other
        restrictions known to You that may affect OpenBot's use, modification, licensing, or distribution of Your
        Contributions.
      </p>

      <h2>No Obligation to Provide Support</h2>
      <p>
        You are not required to provide support, maintenance, updates, or other assistance in connection with Your
        Contributions unless separately agreed.
      </p>
      <p>
        Unless required by applicable law or expressly agreed in writing, You provide Your Contributions on an "AS IS"
        BASIS, without warranties or conditions of any kind, express or implied, including warranties of
        merchantability, fitness for a particular purpose, and non-infringement.
      </p>
      <p>
        Nothing in this section limits Your express representations concerning Your authority to grant licenses under
        this Agreement.
      </p>

      <h2>Third-Party Contributions</h2>
      <p>
        If You wish to submit materials that are not Your original creation, You shall identify those materials
        separately and provide information reasonably available to You concerning their source and any applicable
        licenses, intellectual property rights, or restrictions.
      </p>
      <p>Such materials must be clearly identified as third-party materials.</p>
      <p>
        OpenBot may determine whether the submitted materials can be legally incorporated into the Work. Submission of
        third-party materials does not grant OpenBot rights that You are not legally entitled to license.
      </p>

      <h2>Miscellaneous</h2>
      <p>
        By signing this Agreement, You confirm that You have read and understood its terms, agree to be bound by them,
        and have the authority necessary to grant the licenses specified herein.
      </p>
      <p>
        This Agreement shall be governed by and construed in accordance with the laws of Poland. Any disputes arising
        out of or in connection with this Agreement shall be subject to the exclusive jurisdiction of the competent
        courts of Poland, to the extent permitted by applicable law.
      </p>
      <p>
        This Agreement constitutes the entire agreement between You and OpenBot concerning the licenses granted for Your
        Contributions under this CLA and supersedes any prior agreements or understandings relating specifically to
        those licenses, unless otherwise expressly agreed in writing.
      </p>
      <p>
        You agree to notify OpenBot of any facts or circumstances of which you become aware that would make this
        Agreement inaccurate in any respect. If You are a Corporate Contributor, this obligation also includes changes
        concerning the authority of individuals submitting Contributions on Your behalf.
      </p>
      <p>
        <strong>Please sign:</strong>
      </p>
      <ul>
        <li>Signature</li>
        <li>Date</li>
      </ul>
      <p>
        This is a legal contract containing Personally Identifiable Information. Please refer to{" "}
        <Link to="/privacy">https://openbot.run/privacy</Link> for the policy governing how this information is used and
        shared.
      </p>
    </>
  );
}
