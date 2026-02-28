/**
 * Parse an OpenSea item URL into its components.
 * Supports: https://opensea.io/item/{chain}/{contractAddress}/{tokenId}
 */
export function parseOpenseaUrl(url) {
  const match = url.match(
    /opensea\.io\/item\/([^/]+)\/(0x[a-fA-F0-9]+)\/(\d+)/
  );
  if (!match) {
    throw new Error(
      `Invalid OpenSea URL: ${url}\n` +
        "Expected format: https://opensea.io/item/{chain}/{contract}/{tokenId}"
    );
  }
  return {
    chain: match[1],
    contractAddress: match[2].toLowerCase(),
    tokenId: match[3],
  };
}

/**
 * Build an OpenSea item URL from components.
 */
export function buildOpenseaUrl(chain, contractAddress, tokenId) {
  return `https://opensea.io/item/${chain}/${contractAddress}/${tokenId}`;
}
