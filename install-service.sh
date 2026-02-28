#!/bin/bash
set -e

# Install the artwork-scanner systemd service
# Run this once on your server: bash install-service.sh

SERVICE_NAME="artwork-scanner"
SERVICE_FILE="$(pwd)/${SERVICE_NAME}.service"

if [ ! -f "$SERVICE_FILE" ]; then
  echo "Error: ${SERVICE_NAME}.service not found in current directory."
  echo "Run this script from the artwork-scanner project root."
  exit 1
fi

if [ ! -f .env ]; then
  echo "Error: .env file not found. Copy .env.example to .env and fill in your keys first."
  exit 1
fi

# Stop the old nohup process if it's still running
if pgrep -f "node src/index.js" > /dev/null 2>&1; then
  echo "Stopping existing bot process..."
  pkill -f "node src/index.js"
  sleep 2
fi

# Install and enable the service
echo "Installing systemd service..."
cp "$SERVICE_FILE" /etc/systemd/system/
systemctl daemon-reload
systemctl enable "$SERVICE_NAME"
systemctl start "$SERVICE_NAME"

echo ""
echo "Done! The bot is now running and will auto-start on reboot."
echo ""
echo "Useful commands:"
echo "  systemctl status $SERVICE_NAME   — check if running"
echo "  journalctl -u $SERVICE_NAME -f   — live logs"
echo "  systemctl restart $SERVICE_NAME  — restart after code changes"
echo "  tail -f scanner.log              — application logs"
