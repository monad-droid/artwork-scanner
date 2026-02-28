import "dotenv/config";

function required(name) {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing required environment variable: ${name}`);
    console.error("Copy .env.example to .env and fill in your values.");
    process.exit(1);
  }
  return value;
}

export const config = {
  opensea: {
    apiKey: required("OPENSEA_API_KEY"),
    baseUrl: "https://api.opensea.io/api/v2",
  },
  telegram: {
    botToken: required("TELEGRAM_BOT_TOKEN"),
    chatId: required("TELEGRAM_CHAT_ID"),
  },
  // Wallet mode: track all active offers from this wallet automatically.
  // When set, the scanner monitors your bids and alerts when outbid.
  wallet: {
    address: process.env.WALLET_ADDRESS || "",
    chain: process.env.WALLET_CHAIN || "ethereum",
  },
  // Legacy: NFT fields for watchlist mode (used when WALLET_ADDRESS is not set).
  nft: {
    chain: process.env.NFT_CHAIN || "ethereum",
    contractAddress: process.env.NFT_CONTRACT_ADDRESS || "",
    tokenId: process.env.NFT_TOKEN_ID || "",
    collectionSlug: process.env.NFT_COLLECTION_SLUG || "",
  },
  pollIntervalMs:
    parseInt(process.env.POLL_INTERVAL_SECONDS || "60", 10) * 1000,
  currentBidEth: parseFloat(process.env.CURRENT_BID_ETH || "0"),
};
