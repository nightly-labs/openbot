# syntax=docker/dockerfile:1
ARG BASE=pinned-base

FROM ubuntu:24.04@sha256:562111b88caa79c71391c0c4d3c2114a7d5c35915c20561fd893cb1e07929e6b AS pinned-base

FROM ${BASE} AS release
COPY OpenBot.AppImage /tmp/OpenBot.AppImage
WORKDIR /tmp
RUN chmod 0700 OpenBot.AppImage \
  && ./OpenBot.AppImage --appimage-extract >/dev/null \
  && chmod -R u+rwX,go=rX squashfs-root \
  && test -x squashfs-root/resources/hosting/openbot-container

FROM ${BASE}
ARG DEBIAN_FRONTEND=noninteractive
COPY --from=release /tmp/squashfs-root/resources/hosting/packages.txt /tmp/squashfs-root/resources/hosting/optional-packages.txt /tmp/
RUN apt-get update \
  && apt-get upgrade --yes \
  && sed -e '/^#/d' -e '/^$/d' -e '/^apparmor$/d' /tmp/packages.txt /tmp/optional-packages.txt \
    | xargs apt-get install --yes --no-install-recommends \
      fonts-noto-cjk git less openssh-client procps ripgrep tini unzip xz-utils \
  && rm -rf /var/lib/apt/lists/* /tmp/packages.txt /tmp/optional-packages.txt
RUN userdel --remove ubuntu \
  && useradd --uid 1000 --user-group --home-dir /data --create-home --shell /bin/bash openbot \
  && install -d -o openbot -g openbot -m 0700 /run/openbot
RUN install -d -m 0755 /var/lib/openbot-update/requests /var/lib/openbot-update/status
COPY --from=release /tmp/squashfs-root /opt/OpenBot/app
RUN install -d -m 0755 /opt/OpenBot/hosted \
  && printf 'container\n' >/opt/OpenBot/hosted/mode \
  && ln -s /opt/OpenBot/app/resources/hosting/openbot /usr/local/bin/openbot

ARG VERSION=unknown
ARG REVISION=unknown
LABEL org.opencontainers.image.title=OpenBot \
  org.opencontainers.image.source=https://github.com/nightly-labs/openbot \
  org.opencontainers.image.licenses=PolyForm-Noncommercial-1.0.0 \
  org.opencontainers.image.version=${VERSION} \
  org.opencontainers.image.revision=${REVISION}
ENV LANG=C.UTF-8 XDG_RUNTIME_DIR=/run/openbot
ENV PATH=${PATH}:/data/.local/bin
USER openbot
WORKDIR /data
VOLUME /data
STOPSIGNAL SIGTERM
ENTRYPOINT ["/usr/bin/tini", "--", "/opt/OpenBot/app/resources/hosting/openbot-container"]
