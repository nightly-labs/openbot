# AWS ECS

You can run the [OpenBot image](docker.md) as an Amazon ECS service on an EC2 instance. AWS Fargate
is not supported (see [Fargate](#fargate)). The service is a normal Remote host of your account, as
any [Docker](docker.md) container. It publishes no port.

Read [Docker](docker.md) first. This page gives only the ECS settings for its options.

## Instance

Use one EC2 instance for OpenBot, with the Amazon ECS-optimized Amazon Linux 2023 AMI. OpenBot
needs the [seccomp profile](docker.md#security) of the image, and an ECS task definition cannot
set a seccomp profile: `dockerSecurityOptions` accepts only `no-new-privileges`, `apparmor:`,
`label:` and `credentialspec:`. So the Docker daemon of the instance uses the profile for each
container. Do not put other tasks on this instance.

Give the instance a second EBS volume for `/data`, with `DeleteOnTermination` set to `false`. In the
user data, mount it, give it to the user of the image, and set the daemon options before ECS starts
a task:

```sh
#!/bin/bash
set -euo pipefail
# The data volume. Replace the device with the one of your instance.
blkid /dev/nvme1n1 || mkfs -t xfs /dev/nvme1n1
mkdir -p /srv/openbot-data
echo '/dev/nvme1n1 /srv/openbot-data xfs defaults,nofail 0 2' >>/etc/fstab
mount /srv/openbot-data
chown 1000:1000 /srv/openbot-data
# The seccomp profile of the image, and no-new-privileges, for each container.
curl -fsSL -o /etc/docker/openbot-seccomp.json \
  https://raw.githubusercontent.com/nightly-labs/openbot/main/docker/seccomp.json
cat >/etc/docker/daemon.json <<'EOF'
{ "seccomp-profile": "/etc/docker/openbot-seccomp.json", "no-new-privileges": true }
EOF
systemctl restart docker
echo ECS_CLUSTER=openbot >>/etc/ecs/ecs.config
```

`mkfs` runs only on a volume with no file system. Use the device name of your instance. If the
instance has an `/etc/docker/daemon.json`, add the two keys to it.

The data stays on the volume when the instance stops or restarts. If you replace the instance,
attach the old data volume to the new instance before the service starts a task.

## Task definition

```json
{
  "family": "openbot",
  "requiresCompatibilities": ["EC2"],
  "networkMode": "bridge",
  "taskRoleArn": "arn:aws:iam::<account>:role/openbot-task",
  "executionRoleArn": "arn:aws:iam::<account>:role/openbot-execution",
  "volumes": [{ "name": "data", "host": { "sourcePath": "/srv/openbot-data" } }],
  "containerDefinitions": [
    {
      "name": "openbot",
      "image": "ghcr.io/nightly-labs/openbot:<version>",
      "essential": true,
      "memory": 4096,
      "linuxParameters": { "sharedMemorySize": 1024 },
      "stopTimeout": 60,
      "mountPoints": [{ "sourceVolume": "data", "containerPath": "/data" }],
      "logConfiguration": {
        "logDriver": "awslogs",
        "options": {
          "awslogs-group": "/ecs/openbot",
          "awslogs-region": "<region>",
          "awslogs-stream-prefix": "openbot",
          "awslogs-create-group": "true"
        }
      }
    }
  ]
}
```

| Setting | Docker option | Why |
| --- | --- | --- |
| `sharedMemorySize: 1024` | `--shm-size 1g` | Chromium uses shared memory. |
| `stopTimeout: 60` | `--stop-timeout 60` | OpenBot stops its agents and closes its database before it exits. |
| `host.sourcePath` | `-v openbot-data:/data` | All data is in `/data`. |
| `daemon.json` | `--security-opt` | See [Instance](#instance). |

The image starts `tini` as process 1. Do not set `initProcessEnabled`.

To give a provider API key from AWS Secrets Manager or SSM Parameter Store, add `secrets` to the
container, for example `{ "name": "XAI_API_KEY", "valueFrom": "<secret ARN>" }`. The execution
role must be able to read it. Agents can read each variable of OpenBot (see
[Environment](docker.md#environment)).

The task role is for ECS Exec only. Agents can read the credentials of the task role, so do not give
it other permissions.

## Service

Make a service with `desiredCount` 1, `minimumHealthyPercent` 0 and `maximumPercent` 100. Two tasks
must never use the same `/data`: a deployment then stops the old task before it starts the new one.
Turn on `enableExecuteCommand` for the [sign-in](#sign-in).

Use a version tag. To upgrade, register the task definition with the new tag and update the service.
Do not go back to an older tag (see [Upgrades](docker.md#upgrades)).

## Sign-in

ECS Exec opens a terminal in the container. The task role needs `ssmmessages:CreateControlChannel`,
`ssmmessages:CreateDataChannel`, `ssmmessages:OpenControlChannel` and
`ssmmessages:OpenDataChannel`. Install the Session Manager plugin for the AWS CLI on your computer,
then:

```sh
aws ecs execute-command --cluster openbot --task <task ID> --container openbot \
  --interactive --command "openbot login"
```

`openbot status` and the other commands of [Docker](docker.md#commands) work in the same way.

## Network

The task only connects out. Allow HTTPS to the hosts in
[A company firewall or proxy blocks OpenBot](TROUBLESHOOTING.md#a-company-firewall-or-proxy-blocks-openbot),
to your providers, and the UDP and TCP ports of the TURN relay for remote use. The security group
needs no inbound rule.

## Backups

Stop the service (`desiredCount` 0), make a snapshot of the data volume, and start the service again.
Keep `/data` as one unit (see [Data](docker.md#data)).

## Fargate

Fargate cannot run the image with the Electron sandbox on:

- `dockerSecurityOptions` is not valid on Fargate, and Fargate adds no capability other than
  `SYS_PTRACE`. If the default profile of Fargate refuses user namespaces, the container stops with a
  message about the seccomp profile.
- Fargate stores data on EFS, a network file system. The OpenBot database uses the SQLite WAL mode,
  which [does not work over a network file system](https://www.sqlite.org/wal.html).

Fargate does not let you set the shared memory size. When `/dev/shm` is smaller than 1 GiB, the image
tells Chromium to use `/tmp`.

Do not turn off the sandbox to use Fargate. Use EC2, or a [hosted server](hosted-servers.md).

## Not confirmed

This setup was not tested on AWS. Not confirmed: the user data on the ECS-optimized Amazon Linux 2023
AMI, a user namespace on that AMI with the profile of the image, the start of the image on Fargate,
and the user that ECS Exec uses. From its script, the `openbot` command works as root and as the
user of the image.
