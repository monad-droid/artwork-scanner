#!/usr/bin/env node
import "dotenv/config";
import { parseOpenseaUrl, buildOpenseaUrl } from "./parse-url.js";
import * as watchlist from "./watchlist.js";
import { resolveCollectionSlug } from "./opensea.js";

const [, , command, ...args] = process.argv;

const USAGE = `
Usage:
  node src/cli.js add <opensea-url> <your-bid-in-eth>
  node src/cli.js remove <opensea-url | index>
  node src/cli.js list

Examples:
  node src/cli.js add https://opensea.io/item/ethereum/0xa7d8.../163000007 2.5
  node src/cli.js remove https://opensea.io/item/ethereum/0xa7d8.../163000007
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

switch (command) {
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
