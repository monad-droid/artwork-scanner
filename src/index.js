import { config } from "./config.js";
import {
  resolveCollectionSlug,
  getBestOffer,
  parseOfferPrice,
  getOfferer,
} from "./opensea.js";
import { sendMessage, sendBidAlert, getUpdates } from "./telegram.js";
import * as watchlist from "./watchlist.js";
import { parseOpenseaUrl, buildOpenseaUrl } from "./parse-url.js";

const { pollIntervalMs } = config;

// In-memory map of "contract:tokenId" -> highest known bid
const highestBids = new Map();

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

function itemKey(item) {
  return `${item.contractAddress}:${item.tokenId}`;
}

/**
 * Ensure an item has a resolved collection slug. If not, resolve and persist it.
 */
async function ensureSlug(item) {
  if (item.collectionSlug) return item;
  log(`Resolving slug for ${item.contractAddress}/${item.tokenId}...`);
  const slug = await resolveCollectionSlug(
    item.chain,
    item.contractAddress,
    item.tokenId
  );
  const name = `${slug} #${item.tokenId}`;
  watchlist.updateSlug(item.contractAddress, item.tokenId, slug, name);
  item.collectionSlug = slug;
  item.name = name;
  log(`Resolved: ${name}`);
  return item;
}

/**
 * Check bids for a single watchlist item.
 */
async function checkItem(item) {
  await ensureSlug(item);
  const key = itemKey(item);
  const threshold = highestBids.get(key) ?? item.bidThresholdEth;

  const bestOffer = await getBestOffer(item.collectionSlug, item.tokenId);
  const bestPrice = parseOfferPrice(bestOffer);
  const label = item.name || `${item.contractAddress}/${item.tokenId}`;

  if (bestPrice <= 0) {
    log(`[${label}] No active offers.`);
    return;
  }

  log(`[${label}] Best: ${bestPrice.toFixed(4)} WETH | Threshold: ${threshold.toFixed(4)} WETH`);

  if (bestPrice > threshold) {
    const offerer = getOfferer(bestOffer);
    log(`[${label}] NEW HIGHER BID: ${bestPrice.toFixed(4)} from ${offerer}`);

    await sendBidAlert({
      tokenName: label,
      newBidEth: bestPrice,
      previousHighEth: threshold,
      offerer,
      openseaUrl: buildOpenseaUrl(item.chain, item.contractAddress, item.tokenId),
    });

    highestBids.set(key, bestPrice);
  }
}

/**
 * Poll all items in the watchlist.
 */
async function pollBids() {
  const items = watchlist.getAll();
  if (items.length === 0) return;

  log(`Checking ${items.length} NFT(s)...`);
  for (const item of items) {
    try {
      await checkItem(item);
    } catch (err) {
      const label = item.name || `${item.contractAddress}/${item.tokenId}`;
      log(`[${label}] Error: ${err.message}`);
    }
  }
}

/**
 * Handle incoming Telegram bot commands.
 */
async function handleTelegramCommands() {
  let messages;
  try {
    messages = await getUpdates();
  } catch {
    return; // Silently skip if Telegram polling fails
  }

  for (const msg of messages) {
    const text = (msg.text || "").trim();
    if (!text.startsWith("/")) continue;

    const parts = text.split(/\s+/);
    const cmd = parts[0].toLowerCase().replace(/@\w+$/, ""); // strip @botname

    try {
      switch (cmd) {
        case "/track":
          await handleTrack(parts.slice(1));
          break;
        case "/untrack":
          await handleUntrack(parts.slice(1));
          break;
        case "/list":
          await handleList();
          break;
        case "/help":
        case "/start":
          await sendMessage(
            `<b>Bid Scanner Commands</b>\n\n` +
              `/track &lt;opensea-url&gt; &lt;bid&gt; — Track an NFT\n` +
              `/untrack &lt;opensea-url | #number&gt; — Stop tracking\n` +
              `/list — Show all tracked NFTs\n` +
              `/help — Show this message`
          );
          break;
      }
    } catch (err) {
      log(`Command error: ${err.message}`);
      await sendMessage(`Error: ${err.message}`);
    }
  }
}

async function handleTrack(args) {
  if (args.length < 2) {
    await sendMessage("Usage: /track &lt;opensea-url&gt; &lt;bid-in-eth&gt;");
    return;
  }

  const url = args[0];
  const bid = parseFloat(args[1]);
  if (isNaN(bid) || bid <= 0) {
    await sendMessage(`Invalid bid amount: ${args[1]}`);
    return;
  }

  const { chain, contractAddress, tokenId } = parseOpenseaUrl(url);

  let collectionSlug = "";
  let name = `${contractAddress}/${tokenId}`;
  try {
    collectionSlug = await resolveCollectionSlug(chain, contractAddress, tokenId);
    name = `${collectionSlug} #${tokenId}`;
  } catch {
    // Will resolve on next poll
  }

  const entry = watchlist.add({
    chain,
    contractAddress,
    tokenId,
    collectionSlug,
    bidThresholdEth: bid,
    name,
  });

  await sendMessage(
    `<b>Now tracking:</b> ${entry.name}\n` +
      `<b>Alert above:</b> ${entry.bidThresholdEth} WETH\n` +
      `<a href="${buildOpenseaUrl(chain, contractAddress, tokenId)}">View on OpenSea</a>`
  );
  log(`Telegram: added ${entry.name} at ${bid} WETH`);
}

async function handleUntrack(args) {
  if (args.length < 1) {
    await sendMessage("Usage: /untrack &lt;opensea-url | #number&gt;");
    return;
  }

  const target = args[0];
  let removed;

  // Allow "#1", "#2" etc. for index-based removal
  const indexMatch = target.match(/^#?(\d+)$/);
  if (indexMatch) {
    removed = watchlist.removeByIndex(parseInt(indexMatch[1], 10));
  } else {
    const { contractAddress, tokenId } = parseOpenseaUrl(target);
    removed = watchlist.remove(contractAddress, tokenId);
  }

  if (removed) {
    const label = removed.name || `${removed.contractAddress}/${removed.tokenId}`;
    highestBids.delete(itemKey(removed));
    await sendMessage(`<b>Stopped tracking:</b> ${label}`);
    log(`Telegram: removed ${label}`);
  } else {
    await sendMessage("Not found in watchlist. Use /list to see tracked NFTs.");
  }
}

async function handleList() {
  const items = watchlist.getAll();
  if (items.length === 0) {
    await sendMessage("Watchlist is empty.\n\nUse /track &lt;opensea-url&gt; &lt;bid&gt; to add one.");
    return;
  }

  let text = `<b>Watching ${items.length} NFT(s):</b>\n\n`;
  items.forEach((item, i) => {
    const url = buildOpenseaUrl(item.chain, item.contractAddress, item.tokenId);
    const label = item.name || `${item.contractAddress}/${item.tokenId}`;
    const current = highestBids.get(itemKey(item));
    const currentStr = current ? ` (current best: ${current.toFixed(4)})` : "";
    text += `${i + 1}. <a href="${url}">${label}</a>\n`;
    text += `    Alert above: ${item.bidThresholdEth} WETH${currentStr}\n\n`;
  });
  await sendMessage(text);
}

/**
 * Migrate the single-NFT env config into the watchlist on first run.
 */
function migrateEnvConfig() {
  const { nft, currentBidEth } = config;
  if (!nft.contractAddress || !nft.tokenId) return;

  const existing = watchlist.find(nft.contractAddress, nft.tokenId);
  if (existing) return; // Already in watchlist

  log("Migrating .env NFT config into watchlist...");
  watchlist.add({
    chain: nft.chain,
    contractAddress: nft.contractAddress,
    tokenId: nft.tokenId,
    collectionSlug: nft.collectionSlug,
    bidThresholdEth: currentBidEth,
    name: nft.collectionSlug
      ? `${nft.collectionSlug} #${nft.tokenId}`
      : "",
  });
}

async function main() {
  migrateEnvConfig();

  const items = watchlist.getAll();
  log(`Loaded ${items.length} NFT(s) from watchlist.`);
  log(`Poll interval: ${pollIntervalMs / 1000}s`);

  // Initialize thresholds from watchlist
  for (const item of items) {
    highestBids.set(itemKey(item), item.bidThresholdEth);
  }

  await sendMessage(
    `<b>Bid Scanner Started</b>\n` +
      `Watching ${items.length} NFT(s). Poll interval: ${pollIntervalMs / 1000}s\n\n` +
      `Send /help for commands.`
  );

  async function tick() {
    await handleTelegramCommands();
    await pollBids();
  }

  // Run immediately, then on interval
  await tick();
  setInterval(tick, pollIntervalMs);

  log("Scanner running. Press Ctrl+C to stop.");
}

main().catch((err) => {
  console.error("Fatal:", err.message);
  process.exit(1);
});
