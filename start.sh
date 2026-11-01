#!/usr/bin/env bash
# Detects your LAN IP, writes .env, and starts the whole stack.
set -e
cd "$(dirname "$0")"
[ -f .env ] || cp .env.example .env
IP=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || hostname -I 2>/dev/null | awk '{print $1}')
if [ -z "$IP" ]; then echo "Could not detect LAN IP — set LAN_IP in .env manually"; exit 1; fi
if grep -q '^LAN_IP=' .env; then sed -i.bak "s/^LAN_IP=.*/LAN_IP=$IP/" .env && rm -f .env.bak; else echo "LAN_IP=$IP" >> .env; fi
echo "LAN IP: $IP"
docker compose up -d --build
echo
echo "  Open on this computer:   https://localhost"
echo "  Open on phone/laptop:    https://$IP      (same Wi-Fi; accept the certificate warning once)"
echo "  Moderator dashboard:     https://$IP/moderator   (password in .env, default admin123)"
echo
echo "  Logs: docker compose logs -f moderator web livekit"
