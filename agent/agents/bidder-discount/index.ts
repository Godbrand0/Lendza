/**
 * Bidder Discount — Patient Threshold Bidder
 *
 * Strategy:
 *   Watches each active auction and polls the current price every 30 seconds.
 *   Only bids once the price has dropped to or below TARGET_DISCOUNT_PCT of
 *   the auction's start price. Balances profit margin against the risk that
 *   another bidder wins first.
 *
 *   Dutch auction price schedule:
 *     startPrice  = 100% of collateral ETH value
 *     floor price = 70%  of collateral ETH value  (FLOOR_BPS = 7000)
 *     duration    = 3600 seconds (1 hour)
 *     price at t  = startPrice − (startPrice − floorPrice) × (t / 3600)
 *
 *   At TARGET_DISCOUNT_PCT = 85, the agent bids when the price has fallen to
 *   85% of start, which happens at t = (0.15 / 0.30) × 3600 = 1800 s (30 min).
 *
 * Earnings:
 *   Profit = market ETH price − (startPrice × TARGET_DISCOUNT_PCT / 100).
 *
 * Wallet needs:
 *   ETH ≥ (startPrice × TARGET_DISCOUNT_PCT / 100) + gas.
 *
 * Env:
 *   RPC_URL, VAULT_ADDRESS, AUCTION_ADDRESS, BIDDER_DISCOUNT_PRIVATE_KEY
 *   TARGET_DISCOUNT_PCT — price target as % of start price (default: 85)
 *   POLL_INTERVAL_MS    — how often to check price (default: 30000)
 */

import { ethers } from "ethers";
import { config, AUCTION_ABI, getFheInstance, makeLogger } from "../shared";

const log = makeLogger("BidderDiscount");

const TARGET_DISCOUNT_PCT = Number(process.env.TARGET_DISCOUNT_PCT || "85");
const POLL_INTERVAL_MS    = Number(process.env.POLL_INTERVAL_MS    || "30000");

// Per-auction state
interface AuctionState {
  startPrice: bigint;
  targetPrice: bigint;  // startPrice × TARGET_DISCOUNT_PCT / 100
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
  if (auctionStates.has(auctionId)) return; // already watching

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
      // Auction may have settled — stop polling
      clearInterval(state.pollTimer!);
      auctionStates.delete(auctionId);
      return;
    }

    log.info(
      `Auction #${auctionId} — current: ${ethers.formatEther(currentPrice)} ETH ` +
      `(target: ${ethers.formatEther(targetPrice)} ETH)`
    );

    if (currentPrice > targetPrice) return; // not cheap enough yet

    // Price has hit our target — bid now
    clearInterval(state.pollTimer!);
    state.bidSubmitted = true;

    log.win(
      `Price target reached for auction #${auctionId} — ` +
      `${ethers.formatEther(currentPrice)} ETH ≤ ${TARGET_DISCOUNT_PCT}% target`
    );

    try {
      const provider = auction.runner?.provider as ethers.Provider;
      const fhe      = await getFheInstance(provider);

      // Use target price as our encrypted bid ceiling (we only bid at or below target)
      const bidCeilingGwei = targetPrice; // already in gwei from contract
      const input = fhe.createEncryptedInput(config.auctionAddress, wallet.address);
      input.add64(bidCeilingGwei);
      const { handles, inputProof } = await input.encrypt();

      log.info(`Submitting bid — deposit: ${ethers.formatEther(currentPrice)} ETH`);
      const tx = await auction.submitBid(auctionId, handles[0], inputProof, {
        value: currentPrice,
      });
      const receipt = await tx.wait();
      log.info(`Bid submitted — tx: ${receipt.hash}`);

      // Request resolution immediately after bidding
      const resTx = await auction.requestBidResolution(auctionId, wallet.address);
      await resTx.wait();
      log.info(`Resolution requested for auction #${auctionId}`);
    } catch (e: any) {
      log.error(`Bid failed for auction #${auctionId}:`, e.message);
      state.bidSubmitted = false; // allow retry on next poll
      state.pollTimer = setInterval(poll, POLL_INTERVAL_MS);
    }
  };

  // Poll immediately, then on interval
  await poll();
  if (!state.bidSubmitted) {
    state.pollTimer = setInterval(poll, POLL_INTERVAL_MS);
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
  log.info(`Wallet    : ${wallet.address}`);
  log.info(`Balance   : ${ethers.formatEther(balance)} ETH`);
  log.info(`Auction   : ${config.auctionAddress}`);
  log.info(`Target    : ${TARGET_DISCOUNT_PCT}% of start price`);
  log.info(`Poll      : every ${POLL_INTERVAL_MS / 1000}s`);
  log.info(`Strategy  : wait for ${100 - TARGET_DISCOUNT_PCT}% price drop before bidding`);

  // ── Event listeners ──────────────────────────────────────────────────────

  auction.on("AuctionStarted", async (auctionId: bigint, _borrower: string, startPrice: bigint) => {
    await watchAuction(auction, wallet, auctionId, startPrice).catch((e) =>
      log.error("watchAuction failed:", e.message)
    );
  });

  auction.on("AuctionSettled", (auctionId: bigint, winner: string, pricePaid: bigint) => {
    const state = auctionStates.get(auctionId);
    if (state?.pollTimer) clearInterval(state.pollTimer);
    auctionStates.delete(auctionId);

    const won = winner.toLowerCase() === wallet.address.toLowerCase();
    if (won) {
      log.win(`WON auction #${auctionId} — paid ${ethers.formatEther(pricePaid)} ETH`);
    } else {
      log.info(`Auction #${auctionId} settled — won by ${winner}`);
    }
  });

  auction.on("BidRefunded", (auctionId: bigint, bidder: string) => {
    if (bidder.toLowerCase() === wallet.address.toLowerCase()) {
      log.warn(`Deposit refunded for auction #${auctionId}`);
    }
  });

  // ── Catch auctions already live at startup ────────────────────────────────

  const active: bigint[] = await auction.getActiveAuctions();
  log.info(`Found ${active.length} active auction(s) at startup`);

  for (const id of active) {
    const [, startPrice] = await auction.auctions(id);
    await watchAuction(auction, wallet, id, startPrice).catch((e) =>
      log.error(`Startup watch failed for #${id}:`, e.message)
    );
  }

  log.info(`Watching for new auctions...`);
}

main().catch((e) => {
  console.error("[BidderDiscount] Fatal error:", e);
  process.exit(1);
});
