# Artwork Scanner

An OpenSea NFT bid monitoring bot that tracks bids on the Ethereum blockchain and sends real-time alerts via Telegram.

## Features

- **Wallet Mode** (recommended) — Automatically monitors all active offers from your wallet and alerts you when you've been outbid
- **Watchlist Mode** — Manually track specific NFTs and get notified when new higher bids appear
- **Telegram Bot** — Full command interface to manage tracking, switch wallets, and check status
- **CLI** — Terminal interface for managing your watchlist and checking offers
- **Persistent State** — Survives restarts via JSON file storage
- **Systemd Integration** — Auto-start on boot with crash recovery
- **Multi-chain** — Supports ethereum, polygon, arbitrum, and more

## Prerequisites

- Node.js
- An [OpenSea API key](https://docs.opensea.io/reference/api-keys)
- A Telegram bot token (create one via [@BotFather](https://t.me/BotFather))
- Your Telegram chat ID

## Setup

```bash
# Clone and install
npm install

# Configure environment
cp .env.example .env
# Edit .env with your API keys and settings

# Start the bot
npm start
```

### Environment Variables

| Variable | Required | Description |
|---|---|---|
| `OPENSEA_API_KEY` | Yes | OpenSea API key |
| `TELEGRAM_BOT_TOKEN` | Yes | Telegram bot token from @BotFather |
| `TELEGRAM_CHAT_ID` | Yes | Telegram chat ID for notifications |
| `WALLET_ADDRESS` | No | Ethereum wallet address (enables wallet mode) |
| `WALLET_CHAIN` | No | Blockchain to use (default: `ethereum`) |
| `POLL_INTERVAL_SECONDS` | No | How often to check for new bids (default: `60`) |

## Usage

### Telegram Commands

| Command | Description |
|---|---|
| `/wallet <address>` | Set wallet to track |
| `/wallet` | Show current wallet info |
| `/track <opensea-url> <bid>` | Add an NFT to your watchlist with a bid threshold |
| `/untrack <url \| #number>` | Stop tracking an NFT |
| `/list` | Show all tracked items or active offers |
| `/status` | Check bot uptime and monitoring status |
| `/help` | Show available commands |

### CLI

```bash
# Show active offers for a wallet
node src/cli.js offers 0xYourWalletAddress

# Add an NFT to the watchlist
node src/cli.js add https://opensea.io/item/ethereum/0xContractAddress/123 2.5

# Remove an item by index
node src/cli.js remove 1

# List all tracked NFTs
node src/cli.js list
```

## How It Works

### Wallet Mode

1. Set your `WALLET_ADDRESS` in `.env` or via the `/wallet` Telegram command
2. The bot fetches all your active offers from OpenSea
3. For each offer, it compares your bid against the current top bid
4. If someone outbids you, it sends an immediate Telegram alert

### Watchlist Mode

1. Add NFTs via `/track <opensea-url> <bid>` or the CLI
2. The bot periodically checks each NFT's best offer
3. If the best offer exceeds your threshold, it sends a notification

## Deploying as a Service

For running on a server with auto-restart:

```bash
bash install-service.sh

# Useful commands
systemctl status artwork-scanner
systemctl restart artwork-scanner
journalctl -u artwork-scanner -f
```

## Project Structure

```
src/
├── index.js        # Main bot engine (polling loop, command handling)
├── cli.js          # Command-line interface
├── config.js       # Environment variable loader
├── opensea.js      # OpenSea API v2 client
├── telegram.js     # Telegram Bot API client
├── parse-url.js    # OpenSea URL parsing utilities
└── watchlist.js    # Persistent watchlist storage
```
