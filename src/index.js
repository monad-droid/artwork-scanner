import { config } from "./config.js";
import {
  resolveCollectionSlug,
  getBestOffer,
  parseOfferPrice,
  getOfferer,
  getAccountOffers,
  parseOrder,
} from "./opensea.js";
import {
  sendMessage,
  sendBidAlert,
  sendOutbidAlert,
  getUpdates,
} from "./telegram.js";
import * as watchlist from "./watchlist.js";
import { parseOpenseaUrl, buildOpenseaUrl } from "./parse-url.js";

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const WALLET_PATH = resolve(__dirname, "..", "wallet.json");

const { pollIntervalMs } = config;

// Mutable wallet state — can be set via Telegram /wallet command
let walletAddress = loadWallet() || config.wallet.address;
let walletChain = config.wallet.chain;

function isWalletMode() {
  return !!walletAddress;
}

function loadWallet() {
  if (!existsSync(WALLET_PATH)) return "";
  try {
    const data = JSON.parse(readFileSync(WALLET_PATH, "utf-8"));
    return data.address || "";
  } catch {
    return "";
  }
}

function saveWallet(address) {
  writeFileSync(
    WALLET_PATH,
    JSON.stringify({ address, updatedAt: new Date().toISOString() }, null, 2) + "\n"
  );
}

// Watchlist mode state
const highestBids = new Map();

// Wallet mode state: "contract:tokenId" -> { lastAlertedTopBid }
const outbidAlerts = new Map();
// Cached status for /list command: "contract:tokenId" -> status object
const offerStatus = new Map();

const startedAt = Date.now();

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

function itemKey(contractAddress, tokenId) {
  return `${contractAddress}:${tokenId}`;
}

// ═══════════════════════════════════════════════════════════════
// Wallet Mode
// ═══════════════════════════════════════════════════════════════

async function pollWalletOffers() {
  log(`Fetching active offers for ${walletAddress.slice(0, 10)}...`);

  let orders;
  try {
    orders = await getAccountOffers(walletChain, walletAddress);
  } catch (err) {
    log(`Error fetching wallet offers: ${err.message}`);
    return;
  }

  const items = orders.map((o) => parseOrder(o, walletChain)).filter(Boolean);
  log(
    `Found ${items.length} active item offer(s) (${orders.length} total orders)`
  );

  // Clear stale status for offers no longer active
  const activeKeys = new Set(
    items.map((i) => itemKey(i.contractAddress, i.tokenId))
  );
  for (const key of offerStatus.keys()) {
    if (!activeKeys.has(key)) {
      offerStatus.delete(key);
      outbidAlerts.delete(key);
    }
  }

  let outbidCount = 0;

  for (const item of items) {
    try {
      await checkWalletItem(item);
      const key = itemKey(item.contractAddress, item.tokenId);
      if (offerStatus.get(key)?.outbid) outbidCount++;
    } catch (err) {
      log(`[${item.name}] Error: ${err.message}`);
    }
  }

  if (outbidCount > 0) {
    log(`Summary: outbid on ${outbidCount}/${items.length} item(s)`);
  } else {
    log(`Summary: top bidder on all ${items.length} item(s)`);
  }
}

async function checkWalletItem(item) {
  const key = itemKey(item.contractAddress, item.tokenId);
  // Resolve slug if missing
  if (!item.collectionSlug) {
    try {
      item.collectionSlug = await resolveCollectionSlug(
        item.chain,
        item.contractAddress,
        item.tokenId
      );
      item.name = `${item.collectionSlug} #${item.tokenId}`;
    } catch {
      // Continue without slug
    }
  }

  const bestOffer = await getBestOffer(item.collectionSlug, item.tokenId);
  const bestPrice = parseOfferPrice(bestOffer);
  const bestBidder = getOfferer(bestOffer);

  const isOurBid = bestBidder.toLowerCase() === walletAddress.toLowerCase();
  const outbid = !isOurBid && bestPrice > item.myBid;

  // Cache status for /list
  offerStatus.set(key, {
    name: item.name,
    myBid: item.myBid,
    bestPrice,
    bestBidder,
    outbid,
    collectionSlug: item.collectionSlug,
    contractAddress: item.contractAddress,
    tokenId: item.tokenId,
    chain: item.chain,
  });

  if (outbid) {
    const lastAlerted = outbidAlerts.get(key);
    if (lastAlerted !== bestPrice) {
      log(
        `[${item.name}] OUTBID! Your bid: ${item.myBid.toFixed(4)} | Top: ${bestPrice.toFixed(4)} by ${bestBidder}`
      );

      await sendOutbidAlert({
        tokenName: item.name,
        myBidEth: item.myBid,
        topBidEth: bestPrice,
        topBidder: bestBidder,
        openseaUrl: buildOpenseaUrl(
          item.chain,
          item.contractAddress,
          item.tokenId
        ),
      });

      outbidAlerts.set(key, bestPrice);
    } else {
      log(
        `[${item.name}] Still outbid (${bestPrice.toFixed(4)} > ${item.myBid.toFixed(4)}) — already alerted`
      );
    }
  } else if (isOurBid) {
    log(`[${item.name}] Top bidder at ${item.myBid.toFixed(4)} WETH`);
    outbidAlerts.delete(key);
  } else {
    log(
      `[${item.name}] Best: ${bestPrice.toFixed(4)} | Ours: ${item.myBid.toFixed(4)} — OK`
    );
  }
}

// ═══════════════════════════════════════════════════════════════
// Watchlist Mode (legacy)
// ═══════════════════════════════════════════════════════════════

function itemKeyLegacy(item) {
  return `${item.contractAddress}:${item.tokenId}`;
}

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

async function checkItem(item) {
  await ensureSlug(item);
  const key = itemKeyLegacy(item);
  const threshold = highestBids.get(key) ?? item.bidThresholdEth;

  const bestOffer = await getBestOffer(item.collectionSlug, item.tokenId);
  const bestPrice = parseOfferPrice(bestOffer);
  const label = item.name || `${item.contractAddress}/${item.tokenId}`;

  if (bestPrice <= 0) {
    log(`[${label}] No active offers.`);
    return;
  }

  log(
    `[${label}] Best: ${bestPrice.toFixed(4)} WETH | Threshold: ${threshold.toFixed(4)} WETH`
  );

  if (bestPrice > threshold) {
    const offerer = getOfferer(bestOffer);
    log(`[${label}] NEW HIGHER BID: ${bestPrice.toFixed(4)} from ${offerer}`);

    await sendBidAlert({
      tokenName: label,
      newBidEth: bestPrice,
      previousHighEth: threshold,
      offerer,
      openseaUrl: buildOpenseaUrl(
        item.chain,
        item.contractAddress,
        item.tokenId
      ),
    });

    highestBids.set(key, bestPrice);
  }
}

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

// ═══════════════════════════════════════════════════════════════
// Telegram Commands
// ═══════════════════════════════════════════════════════════════

async function handleTelegramCommands() {
  let messages;
  try {
    messages = await getUpdates();
  } catch {
    return;
  }

  for (const msg of messages) {
    const text = (msg.text || "").trim();
    if (!text.startsWith("/")) continue;

    const parts = text.split(/\s+/);
    const cmd = parts[0].toLowerCase().replace(/@\w+$/, "");

    try {
      switch (cmd) {
        case "/track":
          if (!isWalletMode()) await handleTrack(parts.slice(1));
          else
            await sendMessage(
              "Wallet mode is active — offers are tracked automatically.\n" +
                "Use /list to see your active offers."
            );
          break;
        case "/untrack":
          if (!isWalletMode()) await handleUntrack(parts.slice(1));
          else
            await sendMessage(
              "Wallet mode is active — offers are tracked automatically.\n" +
                "Cancel your bid on OpenSea to stop tracking it."
            );
          break;
        case "/list":
          await handleList();
          break;
        case "/wallet":
          await handleWallet(parts.slice(1));
          break;
        case "/status":
          await handleStatus();
          break;
        case "/help":
        case "/start":
          await handleHelp();
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

  const indexMatch = target.match(/^#?(\d+)$/);
  if (indexMatch) {
    removed = watchlist.removeByIndex(parseInt(indexMatch[1], 10));
  } else {
    const { contractAddress, tokenId } = parseOpenseaUrl(target);
    removed = watchlist.remove(contractAddress, tokenId);
  }

  if (removed) {
    const label = removed.name || `${removed.contractAddress}/${removed.tokenId}`;
    highestBids.delete(itemKeyLegacy(removed));
    await sendMessage(`<b>Stopped tracking:</b> ${label}`);
    log(`Telegram: removed ${label}`);
  } else {
    await sendMessage("Not found in watchlist. Use /list to see tracked NFTs.");
  }
}

async function handleWallet(args) {
  // /wallet <address> — set a new wallet to track
  if (args.length > 0) {
    const newAddress = args[0].trim().toLowerCase();
    if (!/^0x[a-f0-9]{40}$/i.test(newAddress)) {
      await sendMessage(
        "Invalid wallet address.\n" +
          "Expected format: <code>0x</code> followed by 40 hex characters."
      );
      return;
    }

    const oldAddress = walletAddress;
    walletAddress = newAddress;
    saveWallet(newAddress);

    // Clear stale state from previous wallet
    offerStatus.clear();
    outbidAlerts.clear();

    const action = oldAddress ? "switched" : "set";
    await sendMessage(
      `<b>Wallet ${action}!</b>\n\n` +
        `<b>Address:</b> <code>${newAddress}</code>\n` +
        `<b>Chain:</b> ${walletChain}\n\n` +
        `Offers will be picked up on the next poll cycle.\n` +
        `<a href="https://opensea.io/profile/offers?addresses=${newAddress}">View on OpenSea</a>`
    );
    log(`Telegram: wallet ${action} to ${newAddress}`);
    return;
  }

  // /wallet (no args) — show current wallet info
  if (!isWalletMode()) {
    await sendMessage(
      "No wallet set.\n\n" +
        "Usage: /wallet &lt;address&gt;\n" +
        "Example: <code>/wallet 0xa462...</code>"
    );
    return;
  }

  const count = offerStatus.size;
  const outbidCount = [...offerStatus.values()].filter((s) => s.outbid).length;

  await sendMessage(
    `<b>Tracked Wallet</b>\n\n` +
      `<b>Address:</b> <code>${walletAddress}</code>\n` +
      `<b>Chain:</b> ${walletChain}\n` +
      `<b>Active offers:</b> ${count}\n` +
      `<b>Outbid on:</b> ${outbidCount}\n\n` +
      `<a href="https://opensea.io/profile/offers?addresses=${walletAddress}">View on OpenSea</a>`
  );
  log(`Telegram: /wallet requested`);
}

async function handleStatus() {
  const uptimeMs = Date.now() - startedAt;
  const seconds = Math.floor(uptimeMs / 1000) % 60;
  const minutes = Math.floor(uptimeMs / 60000) % 60;
  const hours = Math.floor(uptimeMs / 3600000) % 24;
  const days = Math.floor(uptimeMs / 86400000);

  let uptimeStr = "";
  if (days > 0) uptimeStr += `${days}d `;
  if (hours > 0 || days > 0) uptimeStr += `${hours}h `;
  uptimeStr += `${minutes}m ${seconds}s`;

  const pollSec = pollIntervalMs / 1000;

  if (isWalletMode()) {
    const count = offerStatus.size;
    const outbidCount = [...offerStatus.values()].filter(
      (s) => s.outbid
    ).length;

    await sendMessage(
      `<b>Bot Status: Running (Wallet Mode)</b>\n\n` +
        `<b>Uptime:</b> ${uptimeStr}\n` +
        `<b>Wallet:</b> <code>${walletAddress.slice(0, 10)}...</code>\n` +
        `<b>Active offers:</b> ${count}\n` +
        `<b>Outbid on:</b> ${outbidCount}\n` +
        `<b>Poll interval:</b> ${pollSec}s`
    );
  } else {
    const items = watchlist.getAll();
    await sendMessage(
      `<b>Bot Status: Running</b>\n\n` +
        `<b>Uptime:</b> ${uptimeStr}\n` +
        `<b>Tracking:</b> ${items.length} NFT(s)\n` +
        `<b>Poll interval:</b> ${pollSec}s`
    );
  }
  log(`Telegram: /status requested`);
}

async function handleList() {
  if (isWalletMode()) {
    await handleListWallet();
  } else {
    await handleListWatchlist();
  }
}

async function handleListWallet() {
  if (offerStatus.size === 0) {
    await sendMessage(
      "No active offers found yet.\n\n" +
        "The scanner will pick up your offers on the next poll cycle."
    );
    return;
  }

  let text = `<b>Your Active Offers (${offerStatus.size}):</b>\n\n`;
  let i = 1;

  for (const status of offerStatus.values()) {
    const url = buildOpenseaUrl(
      status.chain,
      status.contractAddress,
      status.tokenId
    );
    const label = status.name;

    if (status.outbid) {
      text += `${i}. <a href="${url}">${label}</a>\n`;
      text += `   ${status.myBid.toFixed(4)} WETH — <b>OUTBID</b> (top: ${status.bestPrice.toFixed(4)} by ${status.bestBidder.slice(0, 10)}...)\n\n`;
    } else {
      text += `${i}. <a href="${url}">${label}</a>\n`;
      text += `   ${status.myBid.toFixed(4)} WETH — top bidder\n\n`;
    }
    i++;
  }

  await sendMessage(text);
}

async function handleListWatchlist() {
  const items = watchlist.getAll();
  if (items.length === 0) {
    await sendMessage(
      "Watchlist is empty.\n\nUse /track &lt;opensea-url&gt; &lt;bid&gt; to add one."
    );
    return;
  }

  let text = `<b>Watching ${items.length} NFT(s):</b>\n\n`;
  items.forEach((item, i) => {
    const url = buildOpenseaUrl(
      item.chain,
      item.contractAddress,
      item.tokenId
    );
    const label = item.name || `${item.contractAddress}/${item.tokenId}`;
    const current = highestBids.get(itemKeyLegacy(item));
    const currentStr = current ? ` (current best: ${current.toFixed(4)})` : "";
    text += `${i + 1}. <a href="${url}">${label}</a>\n`;
    text += `    Alert above: ${item.bidThresholdEth} WETH${currentStr}\n\n`;
  });
  await sendMessage(text);
}

async function handleHelp() {
  log(`Telegram: /help requested`);

  if (isWalletMode()) {
    await sendMessage(
      `<b>Bid Scanner Commands (Wallet Mode)</b>\n\n` +
        `<b>/wallet</b> &lt;address&gt;\n` +
        `Set or change the tracked wallet\n\n` +
        `<b>/wallet</b>\n` +
        `Show tracked wallet info\n\n` +
        `<b>/list</b>\n` +
        `Show all active offers with outbid status\n\n` +
        `<b>/status</b>\n` +
        `Check if the bot is running\n\n` +
        `<b>/help</b>\n` +
        `Show this message`
    );
  } else {
    await sendMessage(
      `<b>Bid Scanner Commands</b>\n\n` +
        `<b>/wallet</b> &lt;address&gt;\n` +
        `Track a wallet's offers automatically\n\n` +
        `<b>/track</b> &lt;opensea-url&gt; &lt;bid&gt;\n` +
        `Add an NFT and alert when best offer exceeds &lt;bid&gt; WETH\n\n` +
        `<b>/untrack</b> &lt;opensea-url | #number&gt;\n` +
        `Stop tracking an NFT (use # number from /list)\n\n` +
        `<b>/list</b>\n` +
        `Show all tracked NFTs with current best offers\n\n` +
        `<b>/status</b>\n` +
        `Check if the bot is running\n\n` +
        `<b>/help</b>\n` +
        `Show this message`
    );
  }
}

// ═══════════════════════════════════════════════════════════════
// Bootstrap
// ═══════════════════════════════════════════════════════════════

function migrateEnvConfig() {
  const { nft, currentBidEth } = config;
  if (!nft.contractAddress || !nft.tokenId) return;

  const existing = watchlist.find(nft.contractAddress, nft.tokenId);
  if (existing) return;

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
  if (isWalletMode()) {
    log(`Wallet mode: tracking offers from ${walletAddress}`);
    log(`Chain: ${walletChain}`);
  } else {
    migrateEnvConfig();
    const items = watchlist.getAll();
    log(`Watchlist mode: loaded ${items.length} NFT(s)`);
    for (const item of items) {
      highestBids.set(
        itemKeyLegacy(item),
        item.bidThresholdEth
      );
    }
  }

  log(`Poll interval: ${pollIntervalMs / 1000}s`);

  const startMsg = isWalletMode()
    ? `<b>Bid Scanner Started (Wallet Mode)</b>\n` +
      `<b>Tracking:</b> <code>${walletAddress}</code>\n` +
      `<b>Poll interval:</b> ${pollIntervalMs / 1000}s\n\n` +
      `Send /help for commands.`
    : `<b>Bid Scanner Started</b>\n` +
      `Watching ${watchlist.getAll().length} NFT(s). Poll interval: ${pollIntervalMs / 1000}s\n\n` +
      `Send /help for commands.\n` +
      `Use /wallet &lt;address&gt; to track a wallet.`;

  await sendMessage(startMsg);

  async function tick() {
    await handleTelegramCommands();
    if (isWalletMode()) {
      await pollWalletOffers();
    } else {
      await pollBids();
    }
  }

  await tick();
  setInterval(tick, pollIntervalMs);

  log("Scanner running. Press Ctrl+C to stop.");
}

main().catch((err) => {
  console.error("Fatal:", err.message);
  process.exit(1);
});
