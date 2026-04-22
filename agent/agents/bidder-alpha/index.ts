/**
 * Bidder Alpha — Aggressive Immediate Bidder
 *
 * Strategy:
 *   Bids the moment an AuctionStarted event fires, paying the full start price.
 *   Guarantees winning before any competitor can react — at the cost of paying
 *   the maximum price.
 *
 * x402 integration (when X402_SERVER_URL is set):
 *   Pays 0.05 USDC at startup to get pre-enriched auction data (current prices,
 *   discount %, time remaining) instead of fetching each auction individually.
 *
 * Env:
 *   RPC_URL, VAULT_ADDRESS, AUCTION_ADDRESS, BIDDER_ALPHA_PRIVATE_KEY
 *   X402_SERVER_URL   — optional
 *   MOCK_USDC_ADDRESS — optional
 *   MAX_BID_GWEI      — bid ceiling in gwei (default: 5 ETH = 5_000_000_000)
 */

import { ethers } from "ethers";
import { config, AUCTION_ABI, getFheInstance, makeLogger } from "../shared";
import { X402Client, AuctionData } from "../x402client";

const log = makeLogger("BidderAlpha");

const MAX_BID_GWEI = BigInt(process.env.MAX_BID_GWEI || "5000000000"); // 5 ETH default

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
  log.info(`Bidding immediately (alpha strategy)…`);

  const provider = auction.runner?.provider;
  if (!provider) throw new Error("No provider on contract");

  const fhe = await getFheInstance(provider as ethers.Provider);

  const input = fhe.createEncryptedInput(config.auctionAddress, wallet.address);
  input.add64(MAX_BID_GWEI);
  const { handles, inputProof } = await input.encrypt();

  const currentPrice: bigint = await auction.getCurrentPrice(auctionId);
  log.info(`Submitting bid — deposit: ${ethers.formatEther(currentPrice)} ETH`);

  try {
    const tx = await auction.submitBid(auctionId, handles[0], inputProof, {
      value: currentPrice,
    });
    const receipt = await tx.wait();
    bidsSubmitted.add(auctionId);
    log.info(`Bid submitted — tx: ${receipt.hash}`);

    log.info(`Requesting bid resolution…`);
    const resTx = await auction.requestBidResolution(auctionId, wallet.address);
    await resTx.wait();
    log.info(`Resolution requested for auction #${auctionId}`);
  } catch (e: any) {
    log.error(`Bid failed for auction #${auctionId}:`, e.message);
    bidsSubmitted.delete(auctionId);
  }
}

// ── Bootstrap: catch auctions already live at startup ─────────────────────────

async function bootstrapAuctions(
  auction: ethers.Contract,
  wallet: ethers.Wallet,
  x402: X402Client | null,
) {
  if (x402) {
    // x402 path — get enriched auction list from server
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
      log.info(
        `Auction #${a.auctionId}: ${a.currentPrice} ETH ` +
        `(${a.discountPct}% off, ${a.secondsRemaining}s remaining)`
      );
      await bidOnAuction(auction, wallet, BigInt(a.auctionId), ethers.parseEther(a.startPrice))
        .catch((e) => log.error(`Startup bid failed for #${a.auctionId}:`, e.message));
    }
  } else {
    // Direct chain path
    const active: bigint[] = await auction.getActiveAuctions();
    log.info(`Found ${active.length} active auction(s) at startup (chain)`);
    for (const id of active) {
      const [, startPrice] = await auction.auctions(id);
      await bidOnAuction(auction, wallet, id, startPrice)
        .catch((e) => log.error(`Startup bid failed for #${id}:`, e.message));
    }
  }
}

async function main() {
  if (!config.auctionAddress) throw new Error("AUCTION_ADDRESS is not set in .env");
  if (!config.bidderAlphaKey) throw new Error("BIDDER_ALPHA_PRIVATE_KEY is not set in .env");

  const provider = new ethers.JsonRpcProvider(config.rpcUrl);
  const wallet   = new ethers.Wallet(config.bidderAlphaKey, provider);
  const auction  = new ethers.Contract(config.auctionAddress, AUCTION_ABI, wallet);

  const balance = await provider.getBalance(wallet.address);
  log.info(`Starting alpha bidder agent`);
  log.info(`Wallet  : ${wallet.address}`);
  log.info(`Balance : ${ethers.formatEther(balance)} ETH`);
  log.info(`Auction : ${config.auctionAddress}`);
  log.info(`Max bid : ${ethers.formatEther(MAX_BID_GWEI)} ETH ceiling`);
  log.info(`Strategy: bid immediately at auction start price (100%)`);

  const x402 = config.x402ServerUrl
    ? new X402Client(config.x402ServerUrl, wallet, config.mockUsdcAddress, (m) => log.info(m))
    : null;

  if (x402) log.info(`x402 server: ${config.x402ServerUrl}`);
  else       log.info(`x402 server: not configured — using chain reads`);

  // ── Event listeners ───────────────────────────────────────────────────────

  auction.on("AuctionStarted", async (auctionId: bigint, _borrower: string, startPrice: bigint) => {
    await bidOnAuction(auction, wallet, auctionId, startPrice)
      .catch((e) => log.error("bidOnAuction failed:", e.message));
  });

  auction.on("AuctionSettled", (auctionId: bigint, winner: string, pricePaid: bigint) => {
    const won = winner.toLowerCase() === wallet.address.toLowerCase();
    if (won) log.win(`WON auction #${auctionId} — paid ${ethers.formatEther(pricePaid)} ETH`);
    else     log.info(`Auction #${auctionId} settled — winner: ${winner}`);
  });

  auction.on("BidRefunded", (auctionId: bigint, bidder: string) => {
    if (bidder.toLowerCase() === wallet.address.toLowerCase())
      log.warn(`Deposit refunded for auction #${auctionId}`);
  });

  await bootstrapAuctions(auction, wallet, x402);
  log.info(`Watching for new auctions…`);
}

main().catch((e) => {
  console.error("[BidderAlpha] Fatal error:", e);
  process.exit(1);
});
