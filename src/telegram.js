import { config } from "./config.js";

const { botToken, chatId } = config.telegram;
const TELEGRAM_API = `https://api.telegram.org/bot${botToken}`;

let lastUpdateId = 0;

/**
 * Send a text message via the Telegram Bot API.
 */
export async function sendMessage(text) {
  const url = `${TELEGRAM_API}/sendMessage`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: "HTML",
      disable_web_page_preview: true,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Telegram sendMessage failed (${res.status}): ${body}`);
  }

  return res.json();
}

/**
 * Send a bid alert notification (watchlist mode).
 */
export async function sendBidAlert({
  tokenName,
  newBidEth,
  previousHighEth,
  offerer,
  openseaUrl,
}) {
  const text =
    `<b>New Higher Bid Alert!</b>\n\n` +
    `<b>NFT:</b> ${tokenName}\n` +
    `<b>New bid:</b> ${newBidEth.toFixed(4)} WETH\n` +
    `<b>Previous high:</b> ${previousHighEth.toFixed(4)} WETH\n` +
    `<b>Bidder:</b> <code>${offerer}</code>\n\n` +
    `<a href="${openseaUrl}">View on OpenSea</a>`;

  return sendMessage(text);
}

/**
 * Send an outbid alert notification (wallet mode).
 */
export async function sendOutbidAlert({
  tokenName,
  myBidEth,
  topBidEth,
  topBidder,
  isCollectionOffer,
  openseaUrl,
}) {
  const diff = topBidEth - myBidEth;
  const title = isCollectionOffer
    ? `<b>Outbid by Collection Offer!</b>`
    : `<b>Outbid Alert!</b>`;
  const bidLabel = isCollectionOffer ? "Top collection bid" : "Top bid";
  const text =
    `${title}\n\n` +
    `<b>NFT:</b> ${tokenName}\n` +
    `<b>Your bid:</b> ${myBidEth.toFixed(4)} WETH\n` +
    `<b>${bidLabel}:</b> ${topBidEth.toFixed(4)} WETH (+${diff.toFixed(4)})\n` +
    `<b>Top bidder:</b> <code>${topBidder}</code>\n\n` +
    `<a href="${openseaUrl}">View on OpenSea</a>`;

  return sendMessage(text);
}

/**
 * Poll for new Telegram messages (bot commands).
 * Returns an array of message objects from the authorized chat only.
 */
export async function getUpdates() {
  const url = `${TELEGRAM_API}/getUpdates?offset=${lastUpdateId + 1}&timeout=0`;
  const res = await fetch(url);
  if (!res.ok) return [];

  const data = await res.json();
  if (!data.ok || !data.result?.length) return [];

  const messages = [];
  for (const update of data.result) {
    lastUpdateId = update.update_id;
    // Only accept messages from the authorized chat
    if (update.message && String(update.message.chat.id) === String(chatId)) {
      messages.push(update.message);
    }
  }
  return messages;
}
