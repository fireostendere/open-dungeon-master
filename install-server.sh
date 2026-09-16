#!/usr/bin/env bash
# Standalone bootstrap for Ubuntu 22.04/24.04/26.04 and Debian 12/13.
# The private repository needs a read-only GitHub Contents token (or a local mirror).
set -Eeuo pipefail
umask 077
ROOT=/opt/odm
REPO=fireostendere/dungeon_master
BRANCH=main
REF=''
SOURCE=''
TOKEN_FILE=''
MODE=server
RUNTIME=''
YES=0
PLAN=0
ARGS=()
usage() {
  cat <<'EOF'
Usage: sudo bash install-server.sh [options]
  --root /opt/odm               Separate managed installation directory
  --repo owner/name --branch main --ref COMMIT
  --token-file /secure/token    Private repository, read-only Contents permission
  --source /path/to/git         Local/offline Git mirror instead of GitHub
  --mode server|local           Local defaults to optional Ollama
  --runtime none|ollama|external --model MODEL
  --accelerator cpu|amd|nvidia  CPU is portable; GPU requires existing drivers
  --domain dnd.example.com      Caddy HTTPS (DNS and ports 80/443 must work)
  --listen 127.0.0.1|0.0.0.0 --port 3005
  --llm-url URL --comfy-url URL --auto-update --skip-assets
  --yes                        Use defaults without the configuration questions
  --plan                       Print actions without changing the machine
EOF
}
while (($#)); do
  case "$1" in
    --root|--repo|--branch|--ref|--source|--token-file|--mode|--runtime)
      (($# >= 2)) || { usage; exit 2; }
      case "$1" in
        --root) ROOT=$2;; --repo) REPO=$2;; --branch) BRANCH=$2;; --ref) REF=$2;;
        --source) SOURCE=$2;; --token-file) TOKEN_FILE=$2;; --mode) MODE=$2;; --runtime) RUNTIME=$2;;
      esac; shift 2;;
    --domain|--listen|--port|--model|--llm-url|--comfy-url|--accelerator)
      (($# >= 2)) || { usage; exit 2; }; ARGS+=("$1" "$2"); shift 2;;
    --auto-update|--skip-assets) ARGS+=("$1"); shift;;
    --yes) YES=1; shift;; --plan) PLAN=1; shift;; --help|-h) usage; exit 0;;
    *) printf 'Unknown option: %s\n' "$1" >&2; exit 2;;
  esac
done
[[ $REPO =~ ^[A-Za-z0-9][A-Za-z0-9-]*/[A-Za-z0-9][A-Za-z0-9_.-]*$ ]] || { echo 'Invalid repository' >&2; exit 2; }
[[ $BRANCH =~ ^[A-Za-z0-9][A-Za-z0-9._/-]*$ && $BRANCH != *..* ]] || exit 2
[[ $ROOT =~ ^/[A-Za-z0-9_./-]+$ && $ROOT != / && $ROOT != *..* && ! -L $ROOT ]] || { echo 'Unsafe root path' >&2; exit 2; }
[[ $MODE == server || $MODE == local ]] || exit 2
if ((PLAN)); then
  printf 'Target: %s\nRepository: %s (%s)\n' "$ROOT" "$REPO" "$BRANCH"
  echo 'Install missing Git, Python, restic and Docker Compose; build this fork locally.'
  echo 'Keep state/keys separate; create private admin; encrypted backups; systemd timers.'
  echo 'Install the token-protected MCP sidecar and keep it synced to the active release.'
  echo 'No existing database, container, firewall or GPU driver will be removed.'
  exit 0
fi
if ((EUID != 0)); then
  echo 'Run this installer with sudo. The installer does not copy credentials from your personal applications.' >&2
  exit 1
fi
[[ -f /etc/os-release ]] || { echo 'Linux distribution could not be detected' >&2; exit 1; }
# shellcheck disable=SC1091
. /etc/os-release
case "${ID}:${VERSION_ID}" in ubuntu:22.04|ubuntu:24.04|ubuntu:26.04|debian:12|debian:13) ;; *) echo 'Supported: Ubuntu 22.04/24.04/26.04 or Debian 12/13' >&2; exit 1;; esac
if [[ -d $ROOT && -n $(ls -A "$ROOT") && ! -f $ROOT/.odm-managed ]]; then
  echo 'Target is not an ODM-managed directory. Choose an empty --root; existing projects are not overwritten.' >&2; exit 1
fi
mkdir -p "$ROOT/config" "$ROOT/tools"
printf 'schema=1\n' > "$ROOT/.odm-managed"
chmod 700 "$ROOT/config"
if [[ -z $RUNTIME ]]; then
  RUNTIME=none; [[ $MODE == local ]] && RUNTIME=ollama
  if ((YES == 0)) && [[ -t 0 ]]; then
    read -r -p "Model runtime: none (cloud wizard), ollama, external [$RUNTIME]: " ANSWER
    RUNTIME=${ANSWER:-$RUNTIME}
    if [[ $MODE == server ]]; then
      read -r -p 'HTTPS domain (blank = local port / SSH tunnel): ' DOMAIN
      [[ -z $DOMAIN ]] || ARGS+=(--domain "$DOMAIN")
    fi
  fi
fi
[[ $RUNTIME == none || $RUNTIME == ollama || $RUNTIME == external ]] || { echo 'Invalid runtime' >&2; exit 2; }
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y --no-install-recommends ca-certificates curl git python3 restic util-linux
if ! command -v docker >/dev/null 2>&1; then
  install -m 0755 -d /etc/apt/keyrings
  curl --fail --show-error --silent --location --proto '=https' --tlsv1.2 "https://download.docker.com/linux/$ID/gpg" -o /etc/apt/keyrings/odm-docker.asc
  chmod a+r /etc/apt/keyrings/odm-docker.asc
  printf 'Types: deb\nURIs: https://download.docker.com/linux/%s\nSuites: %s\nComponents: stable\nArchitectures: %s\nSigned-By: /etc/apt/keyrings/odm-docker.asc\n' "$ID" "${UBUNTU_CODENAME:-$VERSION_CODENAME}" "$(dpkg --print-architecture)" > /etc/apt/sources.list.d/odm-docker.sources
  apt-get update
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi
if ! docker compose version >/dev/null 2>&1; then
  if apt-cache show docker-compose-plugin >/dev/null 2>&1; then
    apt-get install -y docker-compose-plugin
  elif apt-cache show docker-compose-v2 >/dev/null 2>&1; then
    apt-get install -y docker-compose-v2
  else
    echo 'Existing Docker has no matching Compose package. It was not replaced; install its Compose v2 plugin and rerun.' >&2; exit 1
  fi
fi
if [[ -d /run/systemd/system ]]; then systemctl enable --now docker; fi
docker info >/dev/null || { echo 'Docker daemon is unavailable' >&2; exit 1; }
if [[ -n $TOKEN_FILE ]]; then
  [[ -f $TOKEN_FILE && ! -L $TOKEN_FILE ]] || { echo 'Invalid token file' >&2; exit 1; }
  if [[ $(realpath "$TOKEN_FILE") != "$ROOT/config/github.token" ]]; then install -m 600 "$TOKEN_FILE" "$ROOT/config/github.token"; fi
fi
cat > "$ROOT/config/git-askpass.sh" <<EOF
#!/bin/sh
case "\$1" in
  *Username*) printf '%s\\n' x-access-token;;
  *Password*) cat '$ROOT/config/github.token';;
  *) exit 1;;
esac
EOF
chmod 700 "$ROOT/config/git-askpass.sh"
export GIT_ASKPASS="$ROOT/config/git-askpass.sh" GIT_TERMINAL_PROMPT=0
if [[ ! -d $ROOT/repository/.git ]]; then
  if [[ -n $SOURCE ]]; then
    git -c safe.directory="$SOURCE" -c safe.directory="$SOURCE/.git" clone --no-hardlinks -- "$SOURCE" "$ROOT/repository"
  else
    if ! git ls-remote "https://github.com/$REPO.git" HEAD >/dev/null 2>&1; then
      if ((YES)) || [[ ! -t 0 ]]; then
        echo 'Private repository access required. Supply --token-file with read-only Contents permission.' >&2; exit 1
      fi
      read -r -s -p 'Read-only GitHub repository token: ' TOKEN; printf '\n'
      printf '%s\n' "$TOKEN" > "$ROOT/config/github.token"; unset TOKEN
      chmod 600 "$ROOT/config/github.token"
    fi
    git clone --branch "$BRANCH" -- "https://github.com/$REPO.git" "$ROOT/repository"
  fi
fi
if [[ -n $REF ]]; then git -C "$ROOT/repository" checkout --detach "$REF"; fi
[[ -f $ROOT/repository/deploy/odmctl.py ]] || { echo 'Selected revision does not contain the deployment controller' >&2; exit 1; }
[[ -f $ROOT/repository/deploy/mcpctl.py ]] || { echo 'Selected revision does not contain the MCP controller' >&2; exit 1; }
if [[ ! -f $ROOT/tools/odmctl.py ]]; then install -m 700 "$ROOT/repository/deploy/odmctl.py" "$ROOT/tools/odmctl.py"; fi
if [[ ! -f $ROOT/tools/mcpctl.py ]]; then install -m 700 "$ROOT/repository/deploy/mcpctl.py" "$ROOT/tools/mcpctl.py"; fi
if [[ -f $ROOT/repository/deploy/retention.py ]]; then install -m 700 "$ROOT/repository/deploy/retention.py" "$ROOT/tools/retention.py"; fi

cat > /usr/local/bin/odm-refresh-units <<EOF
#!/bin/sh
set -eu
ROOT='$ROOT'
[ -d /run/systemd/system ] || exit 0
PROJECT=\$(/usr/bin/python3 -c 'import hashlib,sys; print("odm-"+hashlib.sha256(sys.argv[1].encode()).hexdigest()[:10])' "\$ROOT")
for UNIT in "/etc/systemd/system/\$PROJECT.service" /etc/systemd/system/"\$PROJECT"-*.service; do
  [ -f "\$UNIT" ] || continue
  sed -E -i "s#^ExecStart=/usr/bin/python3 [^ ]+/tools/odmctl.py --root [^ ]+(.*)#ExecStart=/usr/local/bin/odmctl\\1#" "\$UNIT"
  sed -E -i "s#^ExecStop=/usr/bin/python3 [^ ]+/tools/odmctl.py --root [^ ]+(.*)#ExecStop=/usr/local/bin/odmctl\\1#" "\$UNIT"
done
systemctl daemon-reload
EOF
chmod 755 /usr/local/bin/odm-refresh-units

cat > /usr/local/bin/odm-mcpctl <<EOF
#!/bin/sh
set -eu
ROOT='$ROOT'
SELF=/usr/local/bin/odm-mcpctl
if [ "\${ODM_RELEASE_LOCK_HELD:-0}" != 1 ] && [ "\${1:-}" != status ]; then
  exec /usr/bin/flock -x "\$ROOT/.release.lock" /usr/bin/env ODM_RELEASE_LOCK_HELD=1 "\$SELF" "\$@"
fi
ACTIVE="\$ROOT/config/active.json"
if [ -f "\$ACTIVE" ]; then
  SHA=\$(/usr/bin/python3 -c 'import json,sys; print(json.load(open(sys.argv[1], encoding="utf-8")).get("sha", ""))' "\$ACTIVE")
  SOURCE="\$ROOT/releases/\$SHA/source/deploy/mcpctl.py"
  if [ -f "\$SOURCE" ] && ! cmp -s "\$SOURCE" "\$ROOT/tools/mcpctl.py"; then
    install -m 700 "\$SOURCE" "\$ROOT/tools/mcpctl.py"
  fi
fi
exec /usr/bin/python3 "\$ROOT/tools/mcpctl.py" --root "\$ROOT" "\$@"
EOF
chmod 755 /usr/local/bin/odm-mcpctl

cat > /usr/local/bin/odmctl <<EOF
#!/bin/sh
set -eu
ROOT='$ROOT'
SELF=/usr/local/bin/odmctl
ACTION="\${1:-}"
case "\$ACTION" in
  status|logs|snapshots|check-update) ;;
  *)
    if [ "\${ODM_RELEASE_LOCK_HELD:-0}" != 1 ]; then
      exec /usr/bin/flock -x "\$ROOT/.release.lock" /usr/bin/env ODM_RELEASE_LOCK_HELD=1 "\$SELF" "\$@"
    fi
    ;;
esac

refresh_release_tools() {
  [ -f "\$ROOT/config/active.json" ] || return 0
  SHA=\$(/usr/bin/python3 -c 'import json,sys; print(json.load(open(sys.argv[1], encoding="utf-8")).get("sha", ""))' "\$ROOT/config/active.json")
  for NAME in mcpctl.py retention.py; do
    SRC="\$ROOT/releases/\$SHA/source/deploy/\$NAME"
    [ -f "\$SRC" ] && install -m 700 "\$SRC" "\$ROOT/tools/\$NAME"
  done
}

/usr/bin/python3 "\$ROOT/tools/odmctl.py" --root "\$ROOT" "\$@"
RC=\$?
[ "\$RC" -eq 0 ] || exit "\$RC"

case "\$ACTION" in
  update|rollback|restore)
    refresh_release_tools
    if ! /usr/bin/env ODM_RELEASE_LOCK_HELD=1 /usr/local/bin/odm-mcpctl sync; then
      if [ "\$ACTION" = update ]; then
        echo 'MCP release failed health gate; rolling the application back to the previous release.' >&2
        /usr/bin/python3 "\$ROOT/tools/odmctl.py" --root "\$ROOT" rollback --yes || exit 1
        refresh_release_tools
        /usr/bin/env ODM_RELEASE_LOCK_HELD=1 /usr/local/bin/odm-mcpctl sync || true
        /usr/local/bin/odm-refresh-units || true
      fi
      exit 1
    fi
    [ ! -x "\$ROOT/tools/retention.py" ] || /usr/bin/python3 "\$ROOT/tools/retention.py" --root "\$ROOT" --local-only || true
    /usr/local/bin/odm-refresh-units || true
    ;;
  check)
    refresh_release_tools
    [ ! -x "\$ROOT/tools/retention.py" ] || /usr/bin/python3 "\$ROOT/tools/retention.py" --root "\$ROOT"
    /usr/local/bin/odm-refresh-units || true
    ;;
esac
exit 0
EOF
chmod 755 /usr/local/bin/odmctl

[[ -z $REF ]] || ARGS+=(--ref "$REF")
[[ -z $SOURCE ]] || ARGS+=(--offline-source)
python3 "$ROOT/tools/odmctl.py" --root "$ROOT" install --repo "$REPO" --branch "$BRANCH" --runtime "$RUNTIME" "${ARGS[@]}"

# Make the timers installed by odmctl enter through the coordinated wrapper,
# then provision MCP while the application is already healthy.
odm-refresh-units
ODM_RELEASE_LOCK_HELD=1 odm-mcpctl sync

if [[ -d /run/systemd/system ]]; then
  PROJECT=$(python3 -c 'import hashlib,sys; print("odm-"+hashlib.sha256(sys.argv[1].encode()).hexdigest()[:10])' "$ROOT")
  cat > /etc/systemd/system/odm-mcp-sync.service <<EOF
[Unit]
Description=Synchronize Open Dungeon Master MCP sidecar
After=docker.service network-online.target $PROJECT.service
Requires=$PROJECT.service
Wants=network-online.target

[Service]
Type=oneshot
ExecStart=/usr/local/bin/odm-mcpctl sync
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=$ROOT
EOF
  cat > /etc/systemd/system/odm-mcp-sync.timer <<'EOF'
[Unit]
Description=Repair Open Dungeon Master MCP if it drifts from the active release

[Timer]
OnBootSec=2min
OnUnitActiveSec=15min
RandomizedDelaySec=30
Persistent=true

[Install]
WantedBy=timers.target
EOF
  systemctl daemon-reload
  systemctl enable --now odm-mcp-sync.timer
fi

printf '\nMCP installed.\n'
printf '  Status: odm-mcpctl status\n'
printf '  Token:  %s/config/mcp.token\n' "$ROOT"
printf '  Local endpoint: http://127.0.0.1:3006/mcp\n'
