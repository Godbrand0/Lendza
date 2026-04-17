/**
 * Bidder Alpha — Aggressive Immediate Bidder
 *
 * Strategy:
 *   Bids the moment an AuctionStarted event fires, paying the full start price
 *   (100% of collateral ETH value). Guarantees winning the auction before any
 *   competitor can react — at the cost of paying the maximum price.
 *
 *   Best for: high-value positions where being first matters more than discount.
 *
 * Earnings:
 *   Profit = market ETH price − auction start price paid.
 *   (Start price = 100% of collateral ETH value at time of liquidation.)
 *   If ETH appreciates after the auction, profit grows further.
 *
 * Wallet needs:
 *   ETH ≥ auction start price + gas.
 *
 * Env:
 *   RPC_URL, VAULT_ADDRESS, AUCTION_ADDRESS, BIDDER_ALPHA_PRIVATE_KEY
 *   MAX_BID_GWEI — bid ceiling in gwei (default: 5 ETH = 5_000_000_000)
 */

import { ethers } from "ethers";
import { config, AUCTION_ABI, getFheInstance, makeLogger } from "../shared";

const log = makeLogger("BidderAlpha");

// Maximum bid ceiling in gwei — set this above the highest auction price you
// are willing to pay. The actual price paid is the auction's current price,
// not this ceiling. The ceiling is only used for the encrypted comparison.
const MAX_BID_GWEI = BigInt(process.env.MAX_BID_GWEI || "5000000000"); // 5 ETH default

// Auctions we have already submitted a bid for (avoid double-bidding)
const bidsSubmitted = new Set<bigint>();

async function bidOnAuction(
  auction: ethers.Contract,
  wallet: ethers.Wallet,
  auctionId: bigint,
  startPrice: bigint,
) {
  if (bidsSubmitted.has(auctionId)) {
    log.info(`Already bid on auction #${auctionId} — skipping`);
    return;
  }

  log.info(`NEW AUCTION #${auctionId} — start price: ${ethers.formatEther(startPrice)} ETH`);
  log.info(`Bidding immediately (alpha strategy)...`);

  const provider = auction.runner?.provider;
  if (!provider) throw new Error("No provider on contract");

  const fhe = await getFheInstance(provider as ethers.Provider);

  // Encrypt our max bid ceiling
  const input = fhe.createEncryptedInput(config.auctionAddress, wallet.address);
  input.add64(MAX_BID_GWEI);
  const { handles, inputProof } = await input.encrypt();

  // Fetch fresh price at bid time (may have changed slightly since event)
  const currentPrice: bigint = await auction.getCurrentPrice(auctionId);
  log.info(`Submitting bid — deposit: ${ethers.formatEther(currentPrice)} ETH`);

  try {
    const tx = await auction.submitBid(auctionId, handles[0], inputProof, {
      value: currentPrice,
    });
    const receipt = await tx.wait();
    bidsSubmitted.add(auctionId);
    log.info(`Bid submitted — tx: ${receipt.hash}`);

    // Immediately request resolution — no waiting needed for alpha strategy
    log.info(`Requesting bid resolution...`);
    const resTx = await auction.requestBidResolution(auctionId, wallet.address);
    await resTx.wait();
    log.info(`Resolution requested for auction #${auctionId}`);
  } catch (e: any) {
    log.error(`Bid failed for auction #${auctionId}:`, e.message);
    bidsSubmitted.delete(auctionId); // allow retry
  }
}

async function main() {
  if (!config.auctionAddress)  throw new Error("AUCTION_ADDRESS is not set in .env");
  if (!config.bidderAlphaKey)  throw new Error("BIDDER_ALPHA_PRIVATE_KEY is not set in .env");

  const provider = new ethers.JsonRpcProvider(config.rpcUrl);
  const wallet   = new ethers.Wallet(config.bidderAlphaKey, provider);
  const auction  = new ethers.Contract(config.auctionAddress, AUCTION_ABI, wallet);

  const balance = await provider.getBalance(wallet.address);
  log.info(`Starting alpha bidder agent`);
  log.info(`Wallet    : ${wallet.address}`);
  log.info(`Balance   : ${ethers.formatEther(balance)} ETH`);
  log.info(`Auction   : ${config.auctionAddress}`);
  log.info(`Max bid   : ${ethers.formatEther(MAX_BID_GWEI * 1n)} ETH ceiling`);
  log.info(`Strategy  : bid immediately at auction start price (100%)`);

  // ── Event listeners ──────────────────────────────────────────────────────

  auction.on("AuctionStarted", async (auctionId: bigint, borrower: string, startPrice: bigint) => {
    await bidOnAuction(auction, wallet, auctionId, startPrice).catch((e) =>
      log.error("bidOnAuction failed:", e.message)
    );
  });

  auction.on("AuctionSettled", (auctionId: bigint, winner: string, pricePaid: bigint) => {
    const won = winner.toLowerCase() === wallet.address.toLowerCase();
    if (won) {
      log.win(`WON auction #${auctionId} — paid ${ethers.formatEther(pricePaid)} ETH`);
    } else {
      log.info(`Auction #${auctionId} settled — winner was ${winner}`);
    }
  });

  auction.on("BidRefunded", (auctionId: bigint, bidder: string) => {
    if (bidder.toLowerCase() === wallet.address.toLowerCase()) {
      log.warn(`Deposit refunded for auction #${auctionId} — bid did not win`);
    }
  });

  // ── Catch any auctions already live at startup ────────────────────────────

  const active: bigint[] = await auction.getActiveAuctions();
  log.info(`Found ${active.length} active auction(s) at startup`);

  for (const id of active) {
    const [, startPrice] = await auction.auctions(id);
    await bidOnAuction(auction, wallet, id, startPrice).catch((e) =>
      log.error(`Startup bid failed for #${id}:`, e.message)
    );
  }

  log.info(`Watching for new auctions...`);
}

main().catch((e) => {
  console.error("[BidderAlpha] Fatal error:", e);
  process.exit(1);
});
