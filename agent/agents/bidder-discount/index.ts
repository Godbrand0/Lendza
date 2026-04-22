/**
 * Bidder Discount — Patient Threshold Bidder
 *
 * Strategy:
 *   Watches each active auction and polls the current price every 30 seconds.
 *   Only bids once the price has dropped to or below TARGET_DISCOUNT_PCT of
 *   the auction's start price.
 *
 * x402 integration (when X402_SERVER_URL is set):
 *   Pays 0.05 USDC at startup to get pre-enriched auction data including
 *   current prices and discount percentages — avoids fetching each auction
 *   individually and can immediately skip auctions already past their target.
 *
 * Env:
 *   RPC_URL, VAULT_ADDRESS, AUCTION_ADDRESS, BIDDER_DISCOUNT_PRIVATE_KEY
 *   X402_SERVER_URL     — optional
 *   MOCK_USDC_ADDRESS   — optional
 *   TARGET_DISCOUNT_PCT — price target as % of start price (default: 85)
 *   POLL_INTERVAL_MS    — how often to check price (default: 30000)
 */

import { ethers } from "ethers";
import { config, AUCTION_ABI, getFheInstance, makeLogger } from "../shared";
import { X402Client, AuctionData } from "../x402client";

const log = makeLogger("BidderDiscount");

const TARGET_DISCOUNT_PCT = Number(process.env.TARGET_DISCOUNT_PCT || "85");
const POLL_INTERVAL_MS    = Number(process.env.POLL_INTERVAL_MS    || "30000");

interface AuctionState {
  startPrice: bigint;
  targetPrice: bigint;
  bidSubmitted: boolean;
  pollTimer: ReturnType<typeof setInterval> | null;
}

const auctionStates = new Map<bigint, AuctionState>();

async function watchAuction(
  auction: ethers.Contract,
  wallet: ethers.Wallet,
  auctionId: bigint,
  startPrice: bigint,
) {
  if (auctionStates.has(auctionId)) return;

  const targetPrice = (startPrice * BigInt(TARGET_DISCOUNT_PCT)) / 100n;

  log.info(
    `Watching auction #${auctionId} — start: ${ethers.formatEther(startPrice)} ETH, ` +
    `target: ${ethers.formatEther(targetPrice)} ETH (${TARGET_DISCOUNT_PCT}%)`
  );

  const state: AuctionState = { startPrice, targetPrice, bidSubmitted: false, pollTimer: null };
  auctionStates.set(auctionId, state);

  const poll = async () => {
    if (state.bidSubmitted) return;

    let currentPrice: bigint;
    try {
      currentPrice = await auction.getCurrentPrice(auctionId);
    } catch {
      clearInterval(state.pollTimer!);
      auctionStates.delete(auctionId);
      return;
    }

    log.info(
      `Auction #${auctionId} — current: ${ethers.formatEther(currentPrice)} ETH ` +
      `(target: ${ethers.formatEther(targetPrice)} ETH)`
    );

    if (currentPrice > targetPrice) return;

    clearInterval(state.pollTimer!);
    state.bidSubmitted = true;

    log.win(
      `Price target reached for auction #${auctionId} — ` +
      `${ethers.formatEther(currentPrice)} ETH ≤ ${TARGET_DISCOUNT_PCT}% target`
    );

    try {
      const provider = auction.runner?.provider as ethers.Provider;
      const fhe      = await getFheInstance(provider);

      const bidCeilingGwei = targetPrice;
      const input = fhe.createEncryptedInput(config.auctionAddress, wallet.address);
      input.add64(bidCeilingGwei);
      const { handles, inputProof } = await input.encrypt();

      log.info(`Submitting bid — deposit: ${ethers.formatEther(currentPrice)} ETH`);
      const tx = await auction.submitBid(auctionId, handles[0], inputProof, { value: currentPrice });
      const receipt = await tx.wait();
      log.info(`Bid submitted — tx: ${receipt.hash}`);

      const resTx = await auction.requestBidResolution(auctionId, wallet.address);
      await resTx.wait();
      log.info(`Resolution requested for auction #${auctionId}`);
    } catch (e: any) {
      log.error(`Bid failed for auction #${auctionId}:`, e.message);
      state.bidSubmitted = false;
      state.pollTimer = setInterval(poll, POLL_INTERVAL_MS);
    }
  };

  await poll();
  if (!state.bidSubmitted) {
    state.pollTimer = setInterval(poll, POLL_INTERVAL_MS);
  }
}

// ── Bootstrap ──────────────────────────────────────────────────────────────────

async function bootstrapAuctions(
  auction: ethers.Contract,
  wallet: ethers.Wallet,
  x402: X402Client | null,
) {
  if (x402) {
    log.info(`Fetching live auctions via x402…`);
    let auctions: AuctionData[];
    try {
      auctions = await x402.getAuctionData();
      log.info(`x402: ${auctions.length} active auction(s)`);
    } catch (e: any) {
      log.warn(`x402 failed: ${e.message} — falling back to chain`);
      auctions = [];
    }

    for (const a of auctions) {
      const discountNum = parseFloat(a.discountPct);
      const alreadyCheapEnough = discountNum >= (100 - TARGET_DISCOUNT_PCT);
      log.info(
        `Auction #${a.auctionId}: ${a.currentPrice} ETH ` +
        `(${a.discountPct}% off, ${a.secondsRemaining}s remaining)` +
        (alreadyCheapEnough ? " — already at/below target, bidding now" : "")
      );
      await watchAuction(auction, wallet, BigInt(a.auctionId), ethers.parseEther(a.startPrice))
        .catch((e) => log.error(`Startup watch failed for #${a.auctionId}:`, e.message));
    }
  } else {
    const active: bigint[] = await auction.getActiveAuctions();
    log.info(`Found ${active.length} active auction(s) at startup (chain)`);
    for (const id of active) {
      const [, startPrice] = await auction.auctions(id);
      await watchAuction(auction, wallet, id, startPrice)
        .catch((e) => log.error(`Startup watch failed for #${id}:`, e.message));
    }
  }
}

async function main() {
  if (!config.auctionAddress)    throw new Error("AUCTION_ADDRESS is not set in .env");
  if (!config.bidderDiscountKey) throw new Error("BIDDER_DISCOUNT_PRIVATE_KEY is not set in .env");

  const provider = new ethers.JsonRpcProvider(config.rpcUrl);
  const wallet   = new ethers.Wallet(config.bidderDiscountKey, provider);
  const auction  = new ethers.Contract(config.auctionAddress, AUCTION_ABI, wallet);

  const balance = await provider.getBalance(wallet.address);
  log.info(`Starting discount bidder agent`);
  log.info(`Wallet   : ${wallet.address}`);
  log.info(`Balance  : ${ethers.formatEther(balance)} ETH`);
  log.info(`Auction  : ${config.auctionAddress}`);
  log.info(`Target   : ${TARGET_DISCOUNT_PCT}% of start price`);
  log.info(`Poll     : every ${POLL_INTERVAL_MS / 1000}s`);
  log.info(`Strategy : wait for ${100 - TARGET_DISCOUNT_PCT}% price drop before bidding`);

  const x402 = config.x402ServerUrl
    ? new X402Client(config.x402ServerUrl, wallet, config.mockUsdcAddress, (m) => log.info(m))
    : null;

  if (x402) log.info(`x402 server: ${config.x402ServerUrl}`);
  else       log.info(`x402 server: not configured — using chain reads`);

  // ── Event listeners ───────────────────────────────────────────────────────

  auction.on("AuctionStarted", async (auctionId: bigint, _borrower: string, startPrice: bigint) => {
    await watchAuction(auction, wallet, auctionId, startPrice)
      .catch((e) => log.error("watchAuction failed:", e.message));
  });

  auction.on("AuctionSettled", (auctionId: bigint, winner: string, pricePaid: bigint) => {
    const state = auctionStates.get(auctionId);
    if (state?.pollTimer) clearInterval(state.pollTimer);
    auctionStates.delete(auctionId);
    const won = winner.toLowerCase() === wallet.address.toLowerCase();
    if (won) log.win(`WON auction #${auctionId} — paid ${ethers.formatEther(pricePaid)} ETH`);
    else     log.info(`Auction #${auctionId} settled — won by ${winner}`);
  });

  auction.on("BidRefunded", (auctionId: bigint, bidder: string) => {
    if (bidder.toLowerCase() === wallet.address.toLowerCase())
      log.warn(`Deposit refunded for auction #${auctionId}`);
  });

  await bootstrapAuctions(auction, wallet, x402);
  log.info(`Watching for new auctions…`);
}

main().catch((e) => {
  console.error("[BidderDiscount] Fatal error:", e);
  process.exit(1);
});
