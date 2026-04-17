/**
 * Bidder Sniper — Last-Minute Floor Bidder
 *
 * Strategy:
 *   Silently watches every auction and waits until the final SNIPE_WINDOW_SECONDS
 *   before expiry (default: 600s = last 10 min of a 60-min auction). At that
 *   point the price is near the protocol floor of 70% of start, giving the
 *   largest possible discount. Bids exactly once in this window.
 *
 *   Auction duration = 3600s, floor = 70%.
 *   At t = 3000s (50 min in) price ≈ 75% of start.
 *   At t = 3540s (59 min in) price ≈ 70.5% of start (near floor).
 *
 *   Risk: another bidder may win before the snipe window opens. If that
 *   happens, this agent misses the auction entirely and pays nothing.
 *
 * Earnings:
 *   Highest potential profit margin of the three bidder strategies.
 *   Profit = market ETH price − ~72% of collateral ETH value.
 *
 * Wallet needs:
 *   ETH ≥ ~72% of expected collateral ETH value + gas.
 *
 * Env:
 *   RPC_URL, VAULT_ADDRESS, AUCTION_ADDRESS, BIDDER_SNIPER_PRIVATE_KEY
 *   SNIPE_WINDOW_SECONDS — seconds before expiry to trigger bid (default: 600)
 *   AUCTION_DURATION     — total auction length in seconds (default: 3600)
 */

import { ethers } from "ethers";
import { config, AUCTION_ABI, getFheInstance, makeLogger } from "../shared";

const log = makeLogger("BidderSniper");

const AUCTION_DURATION    = Number(process.env.AUCTION_DURATION    || "3600");  // 1 hour
const SNIPE_WINDOW_SECONDS = Number(process.env.SNIPE_WINDOW_SECONDS || "600"); // 10 min

// Seconds into the auction to schedule the snipe
const SNIPE_AT_SECONDS = AUCTION_DURATION - SNIPE_WINDOW_SECONDS;

// Per-auction snipe timers
const snipeTimers  = new Map<bigint, ReturnType<typeof setTimeout>>();
const bidsAttempted = new Set<bigint>();

async function scheduleSnipe(
  auction: ethers.Contract,
  wallet: ethers.Wallet,
  auctionId: bigint,
  startTime: bigint,
) {
  if (snipeTimers.has(auctionId)) return; // already scheduled

  const now      = Math.floor(Date.now() / 1000);
  const elapsed  = now - Number(startTime);
  const snipeIn  = Math.max(0, SNIPE_AT_SECONDS - elapsed) * 1000; // ms
  const snipePct = Math.round(100 - (30 * SNIPE_AT_SECONDS) / AUCTION_DURATION);

  log.info(
    `Auction #${auctionId} — scheduling snipe in ${Math.round(snipeIn / 1000)}s ` +
    `(≈${snipePct}% of start price)`
  );

  const timer = setTimeout(async () => {
    snipeTimers.delete(auctionId);
    if (bidsAttempted.has(auctionId)) return;

    let currentPrice: bigint;
    try {
      currentPrice = await auction.getCurrentPrice(auctionId);
    } catch {
      log.info(`Auction #${auctionId} already settled — snipe skipped`);
      return;
    }

    bidsAttempted.add(auctionId);
    log.win(
      `SNIPE WINDOW OPEN — auction #${auctionId} — ` +
      `price: ${ethers.formatEther(currentPrice)} ETH`
    );

    try {
      const provider = auction.runner?.provider as ethers.Provider;
      const fhe      = await getFheInstance(provider);

      // Bid ceiling = slightly above current price to handle any block-level drift
      // Add 1% buffer to current price as the encrypted ceiling
      const bidCeilingGwei = (currentPrice * 101n) / 100n;
      const input = fhe.createEncryptedInput(config.auctionAddress, wallet.address);
      input.add64(bidCeilingGwei);
      const { handles, inputProof } = await input.encrypt();

      log.info(`Submitting snipe bid — deposit: ${ethers.formatEther(currentPrice)} ETH`);
      const tx = await auction.submitBid(auctionId, handles[0], inputProof, {
        value: currentPrice,
      });
      const receipt = await tx.wait();
      log.info(`Snipe bid submitted — tx: ${receipt.hash}`);

      // Request resolution immediately
      const resTx = await auction.requestBidResolution(auctionId, wallet.address);
      await resTx.wait();
      log.info(`Resolution requested for auction #${auctionId}`);
    } catch (e: any) {
      log.error(`Snipe bid failed for auction #${auctionId}:`, e.message);
      bidsAttempted.delete(auctionId);
    }
  }, snipeIn);

  snipeTimers.set(auctionId, timer);
}

async function main() {
  if (!config.auctionAddress)   throw new Error("AUCTION_ADDRESS is not set in .env");
  if (!config.bidderSniperKey)  throw new Error("BIDDER_SNIPER_PRIVATE_KEY is not set in .env");

  const provider = new ethers.JsonRpcProvider(config.rpcUrl);
  const wallet   = new ethers.Wallet(config.bidderSniperKey, provider);
  const auction  = new ethers.Contract(config.auctionAddress, AUCTION_ABI, wallet);

  const balance = await provider.getBalance(wallet.address);
  log.info(`Starting sniper bidder agent`);
  log.info(`Wallet         : ${wallet.address}`);
  log.info(`Balance        : ${ethers.formatEther(balance)} ETH`);
  log.info(`Auction        : ${config.auctionAddress}`);
  log.info(`Auction length : ${AUCTION_DURATION}s`);
  log.info(`Snipe window   : last ${SNIPE_WINDOW_SECONDS}s of auction`);
  log.info(`Snipe fires at : t = ${SNIPE_AT_SECONDS}s (${Math.round(SNIPE_AT_SECONDS / 60)} min in)`);
  log.info(`Strategy       : wait for near-floor price, bid once in final window`);

  // ── Event listeners ──────────────────────────────────────────────────────

  auction.on("AuctionStarted", async (auctionId: bigint, _borrower: string, _startPrice: bigint) => {
    const [, , , startTime] = await auction.auctions(auctionId);
    await scheduleSnipe(auction, wallet, auctionId, startTime).catch((e) =>
      log.error("scheduleSnipe failed:", e.message)
    );
  });

  auction.on("AuctionSettled", (auctionId: bigint, winner: string, pricePaid: bigint) => {
    // Cancel pending snipe if another bidder won first
    const timer = snipeTimers.get(auctionId);
    if (timer) { clearTimeout(timer); snipeTimers.delete(auctionId); }
    bidsAttempted.add(auctionId);

    const won = winner.toLowerCase() === wallet.address.toLowerCase();
    if (won) {
      log.win(`WON auction #${auctionId} — paid ${ethers.formatEther(pricePaid)} ETH`);
    } else {
      log.info(`Auction #${auctionId} settled early — won by ${winner} — snipe cancelled`);
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
    const [, , , startTime] = await auction.auctions(id);
    await scheduleSnipe(auction, wallet, id, startTime).catch((e) =>
      log.error(`Startup schedule failed for #${id}:`, e.message)
    );
  }

  log.info(`Watching for new auctions...`);
}

main().catch((e) => {
  console.error("[BidderSniper] Fatal error:", e);
  process.exit(1);
});
