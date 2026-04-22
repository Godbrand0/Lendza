/**
 * Bidder Sniper — Last-Minute Floor Bidder
 *
 * Strategy:
 *   Watches every auction silently and waits until the final SNIPE_WINDOW_SECONDS
 *   before expiry (default: 600s). At that point the price is near the protocol
 *   floor of 70% of start, giving the largest possible discount.
 *
 * x402 integration (when X402_SERVER_URL is set):
 *   Pays 0.05 USDC at startup to get pre-enriched auction data including
 *   secondsRemaining — allows the sniper to immediately calculate the correct
 *   snipe delay without fetching each auction's startTime individually.
 *
 * Env:
 *   RPC_URL, VAULT_ADDRESS, AUCTION_ADDRESS, BIDDER_SNIPER_PRIVATE_KEY
 *   X402_SERVER_URL      — optional
 *   MOCK_USDC_ADDRESS    — optional
 *   SNIPE_WINDOW_SECONDS — seconds before expiry to trigger bid (default: 600)
 *   AUCTION_DURATION     — total auction length in seconds (default: 3600)
 */

import { ethers } from "ethers";
import { config, AUCTION_ABI, getFheInstance, makeLogger } from "../shared";
import { X402Client, AuctionData } from "../x402client";

const log = makeLogger("BidderSniper");

const AUCTION_DURATION     = Number(process.env.AUCTION_DURATION     || "3600");
const SNIPE_WINDOW_SECONDS = Number(process.env.SNIPE_WINDOW_SECONDS || "600");
const SNIPE_AT_SECONDS     = AUCTION_DURATION - SNIPE_WINDOW_SECONDS;

const snipeTimers   = new Map<bigint, ReturnType<typeof setTimeout>>();
const bidsAttempted = new Set<bigint>();

async function scheduleSnipe(
  auction: ethers.Contract,
  wallet: ethers.Wallet,
  auctionId: bigint,
  startTime: bigint,
) {
  if (snipeTimers.has(auctionId)) return;

  const now     = Math.floor(Date.now() / 1000);
  const elapsed = now - Number(startTime);
  const snipeIn = Math.max(0, SNIPE_AT_SECONDS - elapsed) * 1000;
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

      const bidCeilingGwei = (currentPrice * 101n) / 100n;
      const input = fhe.createEncryptedInput(config.auctionAddress, wallet.address);
      input.add64(bidCeilingGwei);
      const { handles, inputProof } = await input.encrypt();

      log.info(`Submitting snipe bid — deposit: ${ethers.formatEther(currentPrice)} ETH`);
      const tx = await auction.submitBid(auctionId, handles[0], inputProof, { value: currentPrice });
      const receipt = await tx.wait();
      log.info(`Snipe bid submitted — tx: ${receipt.hash}`);

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
      // x402 gives us secondsRemaining directly — derive startTime from it
      const now = Math.floor(Date.now() / 1000);
      const startTime = BigInt(a.endsAt - AUCTION_DURATION);
      log.info(
        `Auction #${a.auctionId}: ${a.secondsRemaining}s remaining ` +
        `(${a.discountPct}% off current)`
      );
      await scheduleSnipe(auction, wallet, BigInt(a.auctionId), startTime)
        .catch((e) => log.error(`Startup schedule failed for #${a.auctionId}:`, e.message));
    }
  } else {
    const active: bigint[] = await auction.getActiveAuctions();
    log.info(`Found ${active.length} active auction(s) at startup (chain)`);
    for (const id of active) {
      const [, , , startTime] = await auction.auctions(id);
      await scheduleSnipe(auction, wallet, id, startTime)
        .catch((e) => log.error(`Startup schedule failed for #${id}:`, e.message));
    }
  }
}

async function main() {
  if (!config.auctionAddress)  throw new Error("AUCTION_ADDRESS is not set in .env");
  if (!config.bidderSniperKey) throw new Error("BIDDER_SNIPER_PRIVATE_KEY is not set in .env");

  const provider = new ethers.JsonRpcProvider(config.rpcUrl);
  const wallet   = new ethers.Wallet(config.bidderSniperKey, provider);
  const auction  = new ethers.Contract(config.auctionAddress, AUCTION_ABI, wallet);

  const balance = await provider.getBalance(wallet.address);
  log.info(`Starting sniper bidder agent`);
  log.info(`Wallet        : ${wallet.address}`);
  log.info(`Balance       : ${ethers.formatEther(balance)} ETH`);
  log.info(`Auction       : ${config.auctionAddress}`);
  log.info(`Auction length: ${AUCTION_DURATION}s`);
  log.info(`Snipe window  : last ${SNIPE_WINDOW_SECONDS}s`);
  log.info(`Snipe fires at: t = ${SNIPE_AT_SECONDS}s (${Math.round(SNIPE_AT_SECONDS / 60)} min in)`);
  log.info(`Strategy      : wait for near-floor price, bid once in final window`);

  const x402 = config.x402ServerUrl
    ? new X402Client(config.x402ServerUrl, wallet, config.mockUsdcAddress, (m) => log.info(m))
    : null;

  if (x402) log.info(`x402 server: ${config.x402ServerUrl}`);
  else       log.info(`x402 server: not configured — using chain reads`);

  // ── Event listeners ───────────────────────────────────────────────────────

  auction.on("AuctionStarted", async (auctionId: bigint, _borrower: string, _startPrice: bigint) => {
    const [, , , startTime] = await auction.auctions(auctionId);
    await scheduleSnipe(auction, wallet, auctionId, startTime)
      .catch((e) => log.error("scheduleSnipe failed:", e.message));
  });

  auction.on("AuctionSettled", (auctionId: bigint, winner: string, pricePaid: bigint) => {
    const timer = snipeTimers.get(auctionId);
    if (timer) { clearTimeout(timer); snipeTimers.delete(auctionId); }
    bidsAttempted.add(auctionId);
    const won = winner.toLowerCase() === wallet.address.toLowerCase();
    if (won) log.win(`WON auction #${auctionId} — paid ${ethers.formatEther(pricePaid)} ETH`);
    else     log.info(`Auction #${auctionId} settled early — won by ${winner} — snipe cancelled`);
  });

  auction.on("BidRefunded", (auctionId: bigint, bidder: string) => {
    if (bidder.toLowerCase() === wallet.address.toLowerCase())
      log.warn(`Deposit refunded for auction #${auctionId}`);
  });

  await bootstrapAuctions(auction, wallet, x402);
  log.info(`Watching for new auctions…`);
}

main().catch((e) => {
  console.error("[BidderSniper] Fatal error:", e);
  process.exit(1);
});
