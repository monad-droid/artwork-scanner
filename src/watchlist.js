import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const WATCHLIST_PATH = resolve(__dirname, "..", "watchlist.json");

function readList() {
  if (!existsSync(WATCHLIST_PATH)) return [];
  return JSON.parse(readFileSync(WATCHLIST_PATH, "utf-8"));
}

function writeList(items) {
  writeFileSync(WATCHLIST_PATH, JSON.stringify(items, null, 2) + "\n");
}

/**
 * Get all watched NFTs.
 */
export function getAll() {
  return readList();
}

/**
 * Find an entry by contract address + token ID.
 */
export function find(contractAddress, tokenId) {
  return readList().find(
    (item) =>
      item.contractAddress.toLowerCase() === contractAddress.toLowerCase() &&
      item.tokenId === tokenId
  );
}

/**
 * Add an NFT to the watchlist. Returns the new entry.
 */
export function add({
  chain,
  contractAddress,
  tokenId,
  collectionSlug,
  bidThresholdEth,
  name,
}) {
  const items = readList();
  const existing = items.find(
    (item) =>
      item.contractAddress.toLowerCase() === contractAddress.toLowerCase() &&
      item.tokenId === tokenId
  );
  if (existing) {
    // Update the bid threshold if it already exists
    existing.bidThresholdEth = bidThresholdEth;
    existing.collectionSlug = collectionSlug || existing.collectionSlug;
    existing.name = name || existing.name;
    writeList(items);
    return existing;
  }

  const entry = {
    chain,
    contractAddress: contractAddress.toLowerCase(),
    tokenId,
    collectionSlug: collectionSlug || "",
    bidThresholdEth,
    name: name || "",
    addedAt: new Date().toISOString(),
  };
  items.push(entry);
  writeList(items);
  return entry;
}

/**
 * Remove an NFT from the watchlist by contract + tokenId.
 * Returns the removed entry or null.
 */
export function remove(contractAddress, tokenId) {
  const items = readList();
  const index = items.findIndex(
    (item) =>
      item.contractAddress.toLowerCase() === contractAddress.toLowerCase() &&
      item.tokenId === tokenId
  );
  if (index === -1) return null;
  const [removed] = items.splice(index, 1);
  writeList(items);
  return removed;
}

/**
 * Remove by 1-based index. Returns the removed entry or null.
 */
export function removeByIndex(oneBasedIndex) {
  const items = readList();
  const idx = oneBasedIndex - 1;
  if (idx < 0 || idx >= items.length) return null;
  const [removed] = items.splice(idx, 1);
  writeList(items);
  return removed;
}

/**
 * Update the collection slug for an entry (used after resolving).
 */
export function updateSlug(contractAddress, tokenId, collectionSlug, name) {
  const items = readList();
  const entry = items.find(
    (item) =>
      item.contractAddress.toLowerCase() === contractAddress.toLowerCase() &&
      item.tokenId === tokenId
  );
  if (!entry) return null;
  entry.collectionSlug = collectionSlug;
  if (name) entry.name = name;
  writeList(items);
  return entry;
}
