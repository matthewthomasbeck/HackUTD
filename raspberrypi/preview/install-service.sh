#!/bin/sh
# Install as the current Pi user. Does not start or configure actuators.
set -eu
script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
thermal_mode=--standalone
control_socket=/run/robot/control.sock
case "${1:-}" in
  --robot-socket)
    control_socket=$(python3 "$script_dir/check-robot.py" "${2:-/run/robot/control.sock}")
    thermal_mode=
    ;;
  ''|--standalone)
    if pgrep -x robot >/dev/null || pgrep -f '(^|/|[[:space:]])thermal_stream.py([[:space:]]|$)' >/dev/null; then
      echo 'Close the robot and thermal_stream.py first; this service captures both sensors itself.' >&2
      exit 1
    fi
    ;;
  *) echo 'Usage: sh install-service.sh [--standalone | --robot-socket PATH]' >&2; exit 1;;
esac
service_user=$(id -un)
if [ "$service_user" = root ]; then
  echo 'Run as the Pi login user, not with sudo. The script requests sudo for installation.' >&2
  exit 1
fi
command -v rpicam-vid >/dev/null || { echo 'rpicam-vid is required' >&2; exit 1; }
# systemd EnvironmentFile quoting: reject newlines, quotes and backslashes in paths.
case "$script_dir$control_socket" in *'"'*|*'\'*|*'
'*) echo 'Unsupported characters in install paths' >&2; exit 1;; esac
tmp_dir=$(mktemp -d)
trap 'rm -rf "$tmp_dir"' EXIT
printf 'ASSESS_PREVIEW_SCRIPT="%s/server.py"\nASSESS_CONTROL_SOCKET="%s"\nASSESS_THERMAL_MODE="%s"\n' "$script_dir" "$control_socket" "$thermal_mode" > "$tmp_dir/preview.env"
sed "s/^User=robot$/User=$service_user/" "$script_dir/systemd/assess-preview.service" > "$tmp_dir/assess-preview.service"
sudo install -m 644 "$tmp_dir/preview.env" /etc/assess-preview.env
sudo install -m 644 "$tmp_dir/assess-preview.service" /etc/systemd/system/assess-preview.service
sudo systemctl daemon-reload
sudo systemctl enable --now assess-preview.service
echo "Both captures start at boot. Mode: ${thermal_mode:-robot socket}."
echo 'Status: systemctl status assess-preview; logs: journalctl -u assess-preview -f'
