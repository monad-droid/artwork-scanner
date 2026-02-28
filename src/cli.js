#!/usr/bin/env node
import "dotenv/config";
import { parseOpenseaUrl, buildOpenseaUrl } from "./parse-url.js";
import * as watchlist from "./watchlist.js";
import {
  resolveCollectionSlug,
  getAccountOffers,
  parseOrder,
  getBestOffer,
  parseOfferPrice,
  getOfferer,
} from "./opensea.js";

const [, , command, ...args] = process.argv;

const USAGE = `
Usage:
  node src/cli.js offers [wallet-address]   Show active offers for a wallet (uses WALLET_ADDRESS from .env if omitted)
  node src/cli.js add <opensea-url> <bid>   Add an NFT to the watchlist (legacy mode)
  node src/cli.js remove <opensea-url | index>
  node src/cli.js list                      Show watchlist (legacy mode)

Examples:
  node src/cli.js offers 0xa462...
  node src/cli.js add https://opensea.io/item/ethereum/0xa7d8.../163000007 2.5
  node src/cli.js remove 1
  node src/cli.js list
`.trim();

async function addNft(url, bidStr) {
  if (!url || !bidStr) {
    console.error("Usage: node src/cli.js add <opensea-url> <bid-in-eth>");
    process.exit(1);
  }

  const bid = parseFloat(bidStr);
  if (isNaN(bid) || bid <= 0) {
    console.error(`Invalid bid amount: ${bidStr}`);
    process.exit(1);
  }

  const { chain, contractAddress, tokenId } = parseOpenseaUrl(url);

  console.log(`Resolving collection slug for ${contractAddress}/${tokenId}...`);
  let collectionSlug = "";
  let name = "";
  try {
    collectionSlug = await resolveCollectionSlug(chain, contractAddress, tokenId);
    name = `${collectionSlug} #${tokenId}`;
    console.log(`Collection: ${collectionSlug}`);
  } catch (err) {
    console.warn(`Warning: could not resolve slug (${err.message}). Will retry on next scan.`);
    name = `${contractAddress}/${tokenId}`;
  }

  const entry = watchlist.add({
    chain,
    contractAddress,
    tokenId,
    collectionSlug,
    bidThresholdEth: bid,
    name,
  });

  console.log(`\nAdded to watchlist:`);
  console.log(`  NFT:       ${entry.name}`);
  console.log(`  Threshold: ${entry.bidThresholdEth} WETH`);
  console.log(`  URL:       ${buildOpenseaUrl(chain, contractAddress, tokenId)}`);
  console.log(`\nThe scanner will pick this up on the next poll cycle.`);
}

function removeNft(target) {
  if (!target) {
    console.error("Usage: node src/cli.js remove <opensea-url | index>");
    process.exit(1);
  }

  let removed;
  // If it's a number, remove by index
  if (/^\d+$/.test(target)) {
    removed = watchlist.removeByIndex(parseInt(target, 10));
  } else {
    const { contractAddress, tokenId } = parseOpenseaUrl(target);
    removed = watchlist.remove(contractAddress, tokenId);
  }

  if (removed) {
    console.log(`Removed: ${removed.name || removed.contractAddress + "/" + removed.tokenId}`);
  } else {
    console.error("Not found in watchlist.");
    process.exit(1);
  }
}

function listNfts() {
  const items = watchlist.getAll();
  if (items.length === 0) {
    console.log("Watchlist is empty. Add an NFT with:");
    console.log("  node src/cli.js add <opensea-url> <bid-in-eth>");
    return;
  }

  console.log(`Watching ${items.length} NFT(s):\n`);
  items.forEach((item, i) => {
    const url = buildOpenseaUrl(item.chain, item.contractAddress, item.tokenId);
    console.log(`  ${i + 1}. ${item.name || item.contractAddress + "/" + item.tokenId}`);
    console.log(`     Threshold: ${item.bidThresholdEth} WETH`);
    console.log(`     ${url}\n`);
  });
}

async function showOffers(addressArg) {
  const address = addressArg || process.env.WALLET_ADDRESS;
  if (!address) {
    console.error(
      "No wallet address provided.\n" +
        "Usage: node src/cli.js offers <wallet-address>\n" +
        "Or set WALLET_ADDRESS in your .env file."
    );
    process.exit(1);
  }

  const chain = process.env.WALLET_CHAIN || "ethereum";
  console.log(`Fetching active offers for ${address}...\n`);

  const orders = await getAccountOffers(chain, address);
  const items = orders.map((o) => parseOrder(o, chain)).filter(Boolean);

  if (items.length === 0) {
    console.log("No active item offers found.");
    return;
  }

  console.log(`Found ${items.length} active item offer(s):\n`);

  for (const item of items) {
    const url = buildOpenseaUrl(item.chain, item.contractAddress, item.tokenId);
    let status = "";

    try {
      const bestOffer = await getBestOffer(item.collectionSlug, item.tokenId);
      const bestPrice = parseOfferPrice(bestOffer);
      const bestBidder = getOfferer(bestOffer);
      const isOurs = bestBidder.toLowerCase() === address.toLowerCase();

      if (isOurs) {
        status = "TOP BIDDER";
      } else if (bestPrice > item.myBid) {
        status = `OUTBID (top: ${bestPrice.toFixed(4)} by ${bestBidder.slice(0, 10)}...)`;
      } else {
        status = `OK (top: ${bestPrice.toFixed(4)})`;
      }
    } catch {
      status = "could not check";
    }

    console.log(`  ${item.name}`);
    console.log(`  Your bid: ${item.myBid.toFixed(4)} WETH — ${status}`);
    console.log(`  ${url}\n`);
  }
}

switch (command) {
  case "offers":
    await showOffers(args[0]);
    break;
  case "add":
    await addNft(args[0], args[1]);
    break;
  case "remove":
  case "rm":
    removeNft(args[0]);
    break;
  case "list":
  case "ls":
    listNfts();
    break;
  default:
    console.log(USAGE);
    break;
}
