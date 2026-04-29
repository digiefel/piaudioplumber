#!/usr/bin/env bash
# deploy/setup-pipewire.sh
#
# One-time OS bootstrap: installs PipeWire + WirePlumber on Debian/Pi OS,
# enables user services, and optionally sets up SPDIF loopback.
#
# Run this on the Pi itself (not from a dev machine):
#   bash deploy/setup-pipewire.sh
#
# After this, install piaudioplumber normally:
#   uv sync
#   cp deploy/systemd/*.service ~/.config/systemd/user/
#   systemctl --user daemon-reload && systemctl --user enable --now pap-daemon

set -euo pipefail

log() { echo -e "\033[1;34m[setup]\033[0m $*"; }
ok()  { echo -e "\033[1;32m[ok]\033[0m $*"; }

AUDIO_USER="$(whoami)"
AUDIO_UID="$(id -u)"

# ── Install packages ──────────────────────────────────────────────────────────
log "Installing PipeWire packages..."
sudo apt-get update -qq
sudo apt-get install -y \
  pipewire pipewire-audio pipewire-pulse pipewire-alsa \
  wireplumber \
  acl \
  git

ok "Packages installed"

# ── Install uv (not in apt on Debian trixie) ─────────────────────────────────
if ! command -v uv >/dev/null 2>&1; then
  log "Installing uv..."
  curl -LsSf https://astral.sh/uv/install.sh | sh
  export PATH="$HOME/.local/bin:$PATH"
  ok "uv installed"
fi

# ── Enable PipeWire user services ────────────────────────────────────────────
log "Enabling PipeWire user services..."
loginctl enable-linger "$AUDIO_USER"
systemctl --user daemon-reload
systemctl --user enable pipewire pipewire-pulse wireplumber
systemctl --user start  pipewire pipewire-pulse wireplumber || true
sleep 2

if XDG_RUNTIME_DIR="/run/user/$AUDIO_UID" pw-cli info >/dev/null 2>&1; then
  ok "PipeWire is running"
else
  echo "[warn] PipeWire may still be starting — check: systemctl --user status pipewire"
fi

# ── Socket ACL: allow 'audio' group to connect ───────────────────────────────
# System services (e.g. shairport-sync) run as different users in the audio
# group. This service sets a filesystem ACL on the PipeWire socket after start.
mkdir -p ~/.config/systemd/user
cat > ~/.config/systemd/user/pipewire-socket-acl.service << 'EOF'
[Unit]
Description=Set PipeWire socket ACL for audio group
After=pipewire.socket

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=/bin/sh -c 'SOCK=/run/user/%u/pipewire-0; [ -S "$SOCK" ] && setfacl -m g:audio:rw "$SOCK" || chmod g+rw "$SOCK" 2>/dev/null || true'

[Install]
WantedBy=default.target
EOF
systemctl --user daemon-reload
systemctl --user enable --now pipewire-socket-acl || true
ok "Socket ACL service installed"

# ── Override system audio services to find this user's PipeWire socket ───────
for SVC in shairport-sync snapclient librespot; do
  if systemctl list-unit-files --all "$SVC.service" 2>/dev/null | grep -q "$SVC"; then
    sudo mkdir -p "/etc/systemd/system/$SVC.service.d"
    sudo tee "/etc/systemd/system/$SVC.service.d/pipewire.conf" > /dev/null << EOF
[Service]
Environment=XDG_RUNTIME_DIR=/run/user/${AUDIO_UID}
Environment=PIPEWIRE_RUNTIME_DIR=/run/user/${AUDIO_UID}
EOF
    ok "Added PipeWire socket env override for $SVC"
  fi
done

# ── Disable any existing alsaloop SPDIF service ───────────────────────────────
if systemctl is-active --quiet tv-spdif 2>/dev/null; then
  sudo systemctl stop tv-spdif && sudo systemctl disable tv-spdif
  ok "Disabled alsaloop tv-spdif (replaced by PipeWire loopback)"
fi

# ── Auto-configure SPDIF loopback if a capture device is present ─────────────
SPDIF_NODE=$(XDG_RUNTIME_DIR="/run/user/$AUDIO_UID" pw-dump 2>/dev/null | \
  python3 -c "
import json, sys
data = json.load(sys.stdin)
for obj in data:
  if obj.get('type') == 'PipeWire:Interface:Node':
    info = obj.get('info') or {}
    props = info.get('props') or {}
    name = props.get('node.name','')
    desc = props.get('node.description','')
    cls  = props.get('media.class','')
    if cls == 'Audio/Source' and ('spdif' in name.lower() or 'iec958' in name.lower() or 'spdif' in desc.lower()):
      print(name); break
" 2>/dev/null || echo "")

mkdir -p ~/.config/pipewire/pipewire.conf.d

if [[ -n "$SPDIF_NODE" ]]; then
  ok "Found SPDIF capture node: $SPDIF_NODE"
  cat > ~/.config/pipewire/pipewire.conf.d/10-spdif-loopback.conf << EOF
context.modules = [
  {
    name = libpipewire-module-loopback
    args = {
      node.description = "SPDIF Input Loopback"
      audio.position   = [ FL FR ]
      capture.props = {
        node.name         = "loopback.spdif.capture"
        audio.position    = [ FL FR ]
        stream.dont-remix = true
        node.target       = "${SPDIF_NODE}"
      }
      playback.props = {
        node.name         = "loopback.spdif.playback"
        node.description  = "SPDIF Input"
        media.class       = "Stream/Input/Audio"
        audio.position    = [ FL FR ]
        stream.dont-remix = true
      }
    }
  }
]
EOF
  systemctl --user restart pipewire || true
  ok "SPDIF loopback configured"
else
  echo "[info] No SPDIF capture device found — skipping loopback config"
  echo "       Plug in a SPDIF device and re-run this script to configure it"
fi

sudo systemctl daemon-reload

log "PipeWire setup complete."
echo ""
echo "Next: install piaudioplumber"
echo "  git clone <repo> && cd piaudioplumber"
echo "  uv sync"
echo "  cp deploy/systemd/*.service ~/.config/systemd/user/"
echo "  systemctl --user daemon-reload"
echo "  systemctl --user enable --now pap-daemon"
