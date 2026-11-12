import { Link } from "@tanstack/solid-router";
import { OPENBOT_LINKS } from "../../lib/landing-links";

export function InstallOpenBotVPS() {
  return (
    <>
      <p>
        Installing OpenBot on a VPS gives your agents a computer that can stay running when you close your laptop. Their
        files, conversations and tools live on the server, and you connect from the OpenBot app or your browser.
      </p>

      <p>
        You can install OpenBot directly on Ubuntu or run the official Docker image. Both methods connect the server to
        your OpenBot account. Choose one, then follow the same steps to open the server and set up your first agent.
      </p>

      <h2>What you need</h2>

      <p>
        For the Ubuntu method, use a 64-bit VPS running <strong>Ubuntu 24.04 LTS</strong>, with <strong>systemd</strong>{" "}
        and access to <strong>sudo</strong>. OpenBot provides builds for x86_64 and arm64. Ubuntu 24.04 is the baseline
        used for the full installation tests in the project's documentation.
      </p>

      <p>
        Have your SSH login details ready, plus access to the email address you use for OpenBot. You will also need
        access to an AI provider when you create an agent. The server installation does not include an AI subscription.
      </p>

      <p>
        Choose enough RAM and disk space for the work your agents will do. Browser sessions, coding tools and several
        agents can use more memory than a single text task. Monitor the server as you add work; this guide does not set
        a universal minimum VPS size.
      </p>

      <h2>1. Connect to your VPS</h2>

      <p>Open a terminal on your computer and connect using the SSH details supplied by your VPS provider:</p>

      <pre>
        <code>{"ssh YOUR_USER@YOUR_VPS_IP"}</code>
      </pre>

      <p>
        Replace <code>YOUR_USER</code> and <code>YOUR_VPS_IP</code> with your actual login and server address. Run the
        installation commands below inside that SSH session, on the VPS.
      </p>

      <p>On a fresh Ubuntu server, install the download tools first:</p>

      <pre>
        <code>{"sudo apt-get update\nsudo apt-get install -y curl ca-certificates"}</code>
      </pre>

      <h2>2. Choose an installation method</h2>

      <table>
        <thead>
          <tr>
            <th>Method</th>
            <th>When to use it</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <strong>Ubuntu installer</strong>
            </td>
            <td>You want OpenBot to run as a system service on the VPS.</td>
          </tr>
          <tr>
            <td>
              <strong>Docker Compose</strong>
            </td>
            <td>You already manage services with Docker, or prefer to keep OpenBot in a container.</td>
          </tr>
        </tbody>
      </table>

      <h3>Option A: Install directly on Ubuntu</h3>

      <p>Run the official OpenBot server installer:</p>

      <pre>
        <code>
          {
            "curl -fsSL \\\n  https://raw.githubusercontent.com/nightly-labs/openbot/main/scripts/install-server.sh |\n  sudo bash"
          }
        </code>
      </pre>

      <p>
        The installer downloads the latest released Linux build, verifies its checksum and sets up the OpenBot service.
        On a fresh installation, it creates a separate <code>openbot</code> service user and starts OpenBot in the
        background.
      </p>

      <p>Sign in and give the server a name you will recognize in the app:</p>

      <pre>
        <code>{'sudo openbot login --name "OpenBot VPS"'}</code>
      </pre>

      <p>
        Enter the email address for your OpenBot account, then the code sent to it. Use the same account when you open
        the app later.
      </p>

      <p>Check the result:</p>

      <pre>
        <code>{"sudo openbot status"}</code>
      </pre>

      <p>
        Look for your installed version, account and server state. If the command cannot reach OpenBot yet, check the
        service log using the troubleshooting section below.
      </p>

      <p>OpenBot runs as a system service, so closing the SSH session does not stop it. Continue to step 3.</p>

      <h3>Option B: Run OpenBot with Docker Compose</h3>

      <p>
        This option needs Docker Engine and the Docker Compose plugin on the VPS. If they are not installed, follow the{" "}
        <a href={OPENBOT_LINKS.dockerInstallUbuntu} rel="noopener noreferrer" target="_blank">
          Docker installation instructions for Ubuntu
        </a>{" "}
        first.
      </p>

      <p>Create a new folder for this deployment. Keep its Compose file and security profile together:</p>

      <pre>
        <code>
          {
            "mkdir openbot-vps\ncd openbot-vps\ncurl -fsSLO \\\n  https://raw.githubusercontent.com/nightly-labs/openbot/main/docker/compose.yaml\ncurl -fsSLO \\\n  https://raw.githubusercontent.com/nightly-labs/openbot/main/docker/seccomp.json\nsudo docker compose up -d"
          }
        </code>
      </pre>

      <p>
        Use another new folder name if <code>openbot-vps</code> already exists. The official Compose file uses the
        latest release image and a persistent data volume. It also includes the security profile and shared-memory
        setting required by the container.
      </p>

      <p>
        Keep those settings in place. The Electron sandbox stays enabled; the supplied security profile lets it run in
        the container. Agent commands and files live inside that container, so mount only the host folders you intend
        agents to use.
      </p>

      <p>Sign in to OpenBot and check the server:</p>

      <pre>
        <code>
          {
            'sudo docker compose exec openbot openbot login --name "OpenBot VPS"\nsudo docker compose exec openbot openbot status'
          }
        </code>
      </pre>

      <p>
        Enter your OpenBot account email and its sign-in code. Run later Compose commands from this same deployment
        folder.
      </p>

      <p>
        The container uses a persistent volume for its data and restarts according to the Compose policy. Continue to
        step 3.
      </p>

      <h2>3. Open the server in OpenBot</h2>

      <p>
        Open the OpenBot desktop app or <Link to="/app">OpenBot in your browser</Link> and sign in to the same account.
        Find <strong>OpenBot VPS</strong> in the server list and select it.
      </p>

      <p>
        The standard setup connects through OpenBot's existing account and remote-access services. You use the app to
        reach the VPS; the OpenBot container publishes no web port of its own.
      </p>

      <p>
        When you work on this server, your agents' workspace files and conversations are stored on the VPS. AI
        providers, websites and connected services can still receive the task data needed for their work.
      </p>

      <h2>4. Connect a provider and create an agent</h2>

      <p>
        Choose the provider you want to use on the server and follow its sign-in or API-key flow in OpenBot. A provider
        connection on your laptop is not automatically a working connection on the VPS.
      </p>

      <p>
        If this is a new server with no agents, OpenBot offers provider setup before the first-agent form. Once
        connected, create an agent, give it clear instructions and start with a small task.
      </p>

      <p>For example:</p>

      <blockquote>
        <p>
          Create a file called server-check.txt in your workspace. Put today's date and a short description of what you
          can access in it. Do not change system settings or send anything externally.
        </p>
      </blockquote>

      <p>
        Open the file in the agent's workspace and check the result. The{" "}
        <Link to="/guides/$slug" params={{ slug: "openbot-101" }}>
          first-agent guide
        </Link>{" "}
        walks through the agent setup in more detail.
      </p>

      <p>
        Your VPS can stay available around the clock while its service, network and provider access are working. Check
        routines and their times before leaving scheduled work running.
      </p>

      <h3>Use Hermes Agent on the server</h3>

      <p>
        Open the server's provider settings and select Download on the Hermes row. OpenBot installs Hermes Agent for its
        service user, then the row shows Connect.
      </p>

      <p>
        To install Hermes from a terminal instead, install it as the service user, not as your SSH login. For the Ubuntu
        installer, run this on the VPS:
      </p>

      <pre>
        <code>
          {
            "sudo -u openbot -i bash -c \\\n  'curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash -s -- --non-interactive'\nsudo openbot restart"
          }
        </code>
      </pre>

      <p>For Docker, install it in the container. Hermes stays in the data volume when you replace the container:</p>

      <pre>
        <code>
          {
            "sudo docker compose exec openbot bash -c \\\n  'curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash -s -- --non-interactive'\nsudo docker compose restart openbot"
          }
        </code>
      </pre>

      <p>
        Then select Connect on the Hermes row and enter the Nous Portal code. You can also run <code>hermes setup</code>{" "}
        or <code>hermes model</code> as that user to choose another model provider.
      </p>

      <h2>5. Read logs and keep the server updated</h2>

      <p>For the direct Ubuntu installation, these are the main commands:</p>

      <table>
        <thead>
          <tr>
            <th>Task</th>
            <th>Command</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Check the server</td>
            <td>
              <code>sudo openbot status</code>
            </td>
          </tr>
          <tr>
            <td>Follow its logs</td>
            <td>
              <code>sudo openbot logs -f</code>
            </td>
          </tr>
          <tr>
            <td>Restart OpenBot</td>
            <td>
              <code>sudo openbot restart</code>
            </td>
          </tr>
          <tr>
            <td>Install the latest update</td>
            <td>
              <code>sudo openbot update</code>
            </td>
          </tr>
        </tbody>
      </table>

      <p>
        An update restarts OpenBot, so run it when an interruption is acceptable. Back up the server data first. The
        native service also checks for updates and can stage them for installation; <code>openbot status</code> shows a
        staged update.
      </p>

      <p>For Docker Compose, use these commands from your deployment folder:</p>

      <pre>
        <code>{"sudo docker compose logs --tail 100 openbot\nsudo docker compose exec openbot openbot status"}</code>
      </pre>

      <p>To upgrade after checking the release notes and making a backup:</p>

      <pre>
        <code>
          {"sudo docker compose pull\nsudo docker compose up -d\nsudo docker compose exec openbot openbot status"}
        </code>
      </pre>

      <p>
        A container upgrade replaces the image and keeps its data volume. The <code>latest</code> tag follows new
        releases. If you want to choose a specific release, set its version tag in <code>compose.yaml</code> before
        upgrading. Use the same volume and runtime settings.
      </p>

      <p>
        OpenBot can migrate its database during an upgrade. Use a compatible release with your backup when recovering;
        switching an upgraded live volume to an older image is not a safe rollback.
      </p>

      <h2>Keep a backup of the complete setup</h2>

      <p>
        For the native installation with the default service user, keep the service user's home at{" "}
        <code>/var/lib/openbot</code> and the keyring data at <code>/srv/openbot-hosted</code> together. If you selected
        another service user, back up that user's actual home instead.
      </p>

      <p>Stop OpenBot before making a consistent copy, then start it again when the copy is complete:</p>

      <pre>
        <code>{"sudo openbot stop"}</code>
      </pre>

      <p>Back up both locations using your normal backup process, then run:</p>

      <pre>
        <code>{"sudo openbot start"}</code>
      </pre>

      <p>
        For Docker, stop the service and back up the complete persistent data volume, then start it again. The volume
        includes provider sign-ins, the database and its encryption keyring. A copy of the workspace files alone is not
        a complete backup.
      </p>

      <p>
        Protect backups like account credentials and keep a copy outside the VPS. A persistent disk or Docker volume can
        survive a restart, but it is still part of the server you manage.
      </p>

      <h2>If the server does not appear</h2>

      <p>
        Check that you completed <code>openbot login</code> on the VPS and that the app uses the same email account. A
        successful installation alone does not sign the server in.
      </p>

      <p>
        For the native install, read <code>sudo openbot status</code> and <code>sudo openbot logs -f</code>. For Docker,
        check <code>sudo docker compose ps</code> and the container logs. Follow any reported errors before trying to
        reinstall.
      </p>

      <p>
        If the container reports a user-namespace or sandbox problem, check that it uses the official security profile.
        Some VPS hosts restrict user namespaces or apply extra AppArmor rules. Keep the sandbox enabled and follow the{" "}
        <a href={OPENBOT_LINKS.dockerDocumentation} rel="noopener noreferrer" target="_blank">
          container documentation
        </a>{" "}
        for those host limits.
      </p>

      <p>
        If work starts waiting when memory is low, inspect the memory information in <code>openbot status</code>. Reduce
        concurrent work or give the VPS more memory for the tasks you want to run.
      </p>

      <h2>Frequently asked questions</h2>

      <p>
        <strong>Will agents keep working when I close my laptop?</strong> Yes, while OpenBot is running on the VPS and
        the required services remain available. Your laptop is the client; the VPS runs the agents.
      </p>

      <p>
        <strong>Do I need a domain for this setup?</strong> The standard setup uses OpenBot's existing account services
        and app. A custom domain is not required for this installation.
      </p>

      <p>
        <strong>Does the VPS include model access?</strong> You connect a provider in OpenBot. VPS costs and provider
        access are separate.
      </p>

      <p>
        <strong>Can I move my existing agents to the VPS?</strong> Yes. Choose the VPS as the destination when using an
        appropriate import or transfer flow. Reading local Hermes folders belongs to the local desktop flow; a joined
        VPS uses a ZIP import.
      </p>
    </>
  );
}
