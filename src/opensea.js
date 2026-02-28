import { config } from "./config.js";

const { apiKey, baseUrl } = config.opensea;

const headers = {
  accept: "application/json",
  "x-api-key": apiKey,
};

/**
 * Fetch NFT details to resolve the collection slug.
 * GET /api/v2/chain/{chain}/contract/{address}/nfts/{token_id}
 */
export async function getNft(chain, contractAddress, tokenId) {
  const url = `${baseUrl}/chain/${chain}/contract/${contractAddress}/nfts/${tokenId}`;
  const res = await fetch(url, { headers });
  if (!res.ok) {
    throw new Error(
      `OpenSea getNft failed (${res.status}): ${await res.text()}`
    );
  }
  return res.json();
}

/**
 * Resolve a collection slug from contract address + token ID.
 */
export async function resolveCollectionSlug(chain, contractAddress, tokenId) {
  const data = await getNft(chain, contractAddress, tokenId);
  // The response nests collection info under "nft.collection"
  const slug = data?.nft?.collection;
  if (!slug) {
    throw new Error(
      "Could not resolve collection slug from NFT data. " +
        "Set NFT_COLLECTION_SLUG in your .env manually."
    );
  }
  return slug;
}

/**
 * Get the best (highest) active offer for a specific NFT.
 * GET /api/v2/offers/collection/{slug}/nfts/{identifier}/best
 */
export async function getBestOffer(collectionSlug, tokenId) {
  const url = `${baseUrl}/offers/collection/${collectionSlug}/nfts/${tokenId}/best`;
  const res = await fetch(url, { headers });
  if (!res.ok) {
    const body = await res.text();
    // 404 or empty means no offers — not an error
    if (res.status === 404) return null;
    throw new Error(`OpenSea getBestOffer failed (${res.status}): ${body}`);
  }
  return res.json();
}

/**
 * Get all active offers for a specific NFT, sorted by price descending.
 * GET /api/v2/offers/collection/{slug}/nfts/{identifier}
 */
export async function getOffers(collectionSlug, tokenId, limit = 50) {
  const url = `${baseUrl}/offers/collection/${collectionSlug}/nfts/${tokenId}?limit=${limit}`;
  const res = await fetch(url, { headers });
  if (!res.ok) {
    const body = await res.text();
    if (res.status === 404) return { offers: [] };
    throw new Error(`OpenSea getOffers failed (${res.status}): ${body}`);
  }
  return res.json();
}

/**
 * Parse a price value from an offer object.
 * OpenSea returns price as a string value with decimals (WETH = 18 decimals).
 * Returns the price in ETH as a number.
 */
export function parseOfferPrice(offer) {
  if (!offer) return 0;

  // API v2 returns price under price.current.value
  if (offer.price?.current) {
    const value = BigInt(offer.price.current.value);
    const decimals = offer.price.current.decimals;
    return Number(value) / Math.pow(10, decimals);
  }

  // Some endpoints may return price.value directly
  if (offer.price?.value) {
    const value = BigInt(offer.price.value);
    const decimals = offer.price.decimals || 18;
    return Number(value) / Math.pow(10, decimals);
  }

  // Fallback: try protocol_data.parameters.offer[0]
  if (offer.protocol_data?.parameters?.offer?.[0]) {
    const offerItem = offer.protocol_data.parameters.offer[0];
    const startAmount = BigInt(offerItem.startAmount);
    return Number(startAmount) / 1e18;
  }

  return 0;
}

/**
 * Extract the offerer address from an offer.
 */
export function getOfferer(offer) {
  return (
    offer?.protocol_data?.parameters?.offerer ||
    offer?.maker?.address ||
    "unknown"
  );
}
