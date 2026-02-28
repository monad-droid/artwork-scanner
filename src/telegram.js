import { config } from "./config.js";

const { botToken, chatId } = config.telegram;
const TELEGRAM_API = `https://api.telegram.org/bot${botToken}`;

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
 * Send a bid alert notification.
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
