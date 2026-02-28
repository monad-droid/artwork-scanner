import { config } from "./config.js";
import {
  resolveCollectionSlug,
  getBestOffer,
  parseOfferPrice,
  getOfferer,
} from "./opensea.js";
import { sendMessage, sendBidAlert } from "./telegram.js";

const { nft, pollIntervalMs, currentBidEth } = config;

let collectionSlug = nft.collectionSlug;
let highestKnownBid = currentBidEth;
let tokenName = `${nft.contractAddress}/${nft.tokenId}`;

function openseaUrl() {
  return `https://opensea.io/item/${nft.chain}/${nft.contractAddress}/${nft.tokenId}`;
}

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

async function init() {
  // Resolve collection slug if not provided
  if (!collectionSlug) {
    log("Resolving collection slug from contract address...");
    collectionSlug = await resolveCollectionSlug(
      nft.chain,
      nft.contractAddress,
      nft.tokenId
    );
    log(`Collection slug: ${collectionSlug}`);
  }

  tokenName = `${collectionSlug} #${nft.tokenId}`;

  log(`Monitoring: ${tokenName}`);
  log(`OpenSea: ${openseaUrl()}`);
  log(`Your current bid: ${currentBidEth} WETH`);
  log(`Starting threshold (highest known bid): ${highestKnownBid} WETH`);
  log(`Poll interval: ${pollIntervalMs / 1000}s`);

  // Send a startup notification
  await sendMessage(
    `<b>Bid Scanner Started</b>\n\n` +
      `Monitoring: ${tokenName}\n` +
      `Your bid: ${currentBidEth} WETH\n` +
      `Poll interval: ${pollIntervalMs / 1000}s\n\n` +
      `<a href="${openseaUrl()}">View on OpenSea</a>`
  );
}

async function checkBids() {
  log("Checking for new bids...");

  // First try the best offer endpoint for a quick check
  const bestOffer = await getBestOffer(collectionSlug, nft.tokenId);
  const bestPrice = parseOfferPrice(bestOffer);

  if (bestPrice > 0) {
    log(`Best offer: ${bestPrice.toFixed(4)} WETH`);
  } else {
    log("No active offers found.");
    return;
  }

  if (bestPrice > highestKnownBid) {
    const offerer = getOfferer(bestOffer);
    log(
      `NEW HIGHER BID: ${bestPrice.toFixed(4)} WETH (was ${highestKnownBid.toFixed(4)}) from ${offerer}`
    );

    await sendBidAlert({
      tokenName,
      newBidEth: bestPrice,
      previousHighEth: highestKnownBid,
      offerer,
      openseaUrl: openseaUrl(),
    });

    highestKnownBid = bestPrice;
  } else {
    log(
      `No new higher bids. Current best: ${bestPrice.toFixed(4)} WETH, threshold: ${highestKnownBid.toFixed(4)} WETH`
    );
  }
}

async function poll() {
  try {
    await checkBids();
  } catch (err) {
    log(`Error checking bids: ${err.message}`);
    // Don't crash — keep polling
  }
}

async function main() {
  try {
    await init();
  } catch (err) {
    console.error("Failed to initialize:", err.message);
    process.exit(1);
  }

  // Run immediately, then on interval
  await poll();
  setInterval(poll, pollIntervalMs);

  log("Scanner running. Press Ctrl+C to stop.");
}

main();
