/**
 * x402 Payment Server — Lendza Protocol
 *
 * Endpoints:
 *
 *  POST /v1/alpha              — probe: 200 (granted) or 402 (pay to unlock)
 *  POST /v1/alpha/confirm      — submit payment tx → vault.grantAgentAccess()
 *
 *  POST /v1/positions/unhealthy         — probe: 200 or 402 (0.05 USDC)
 *  POST /v1/positions/unhealthy/confirm — pay → receive overdue position list
 *
 *  POST /v1/auction/access         — probe: 200 or 402 (0.05 USDC)
 *  POST /v1/auction/access/confirm — pay → receive live auction data
 *
 *  GET  /v1/grants             — list all granted (agent, borrower) pairs
 *  GET  /health                — liveness check
 *
 * Required .env:
 *   RPC_URL              — JSON-RPC endpoint
 *   VAULT_ADDRESS        — ConfidentialVault address
 *   AUCTION_ADDRESS      — DutchAuction address
 *   CUSDC_ADDRESS        — cUSDC token address (payment verification)
 *   USDC_ADDRESS         — real USDC token address (payment verification)
 *   ADMIN_PRIVATE_KEY    — wallet authorised to call vault.grantAgentAccess()
 *   PAYMENT_ADDRESS      — USDC receiving address for fee collection
 *   X402_FEE_USDC        — fee for alpha access in 6-dec units (default: 10 USDC)
 *   X402_FEE_DATA_USDC   — fee for position/auction data (default: 50000 = 0.05 USDC)
 *   SERVER_PORT          — port (default: 3001)
 */

import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import { ethers } from "ethers";
import * as dotenv from "dotenv";
import { loadGrants, hasGrant, recordGrant, allGrants } from "./grants";
import { verifyPayment } from "./verify";

dotenv.config();

// ─── Config ──────────────────────────────────────────────────────────────────

const {
  RPC_URL            = "http://localhost:8545",
  VAULT_ADDRESS      = "",
  AUCTION_ADDRESS    = "",
  CUSDC_ADDRESS      = "",
  USDC_ADDRESS       = "",
  ADMIN_PRIVATE_KEY  = "",
  PAYMENT_ADDRESS    = "",
  X402_FEE_USDC      = "10000000",   // 10 USDC — alpha FHE access
  X402_FEE_DATA_USDC = "50000",      // 0.05 USDC — position/auction data
  SERVER_PORT        = "3001",
} = process.env;

const ALPHA_FEE = BigInt(X402_FEE_USDC);
const DATA_FEE  = BigInt(X402_FEE_DATA_USDC);

// Vault ABI — only what this server needs
const VAULT_ABI = [
  "function grantAgentAccess(address account, address agent) external",
  "function getActivePositions() external view returns (address[])",
  "function getLoanInfo(address borrower) external view returns (uint256 startTime, uint256 termSeconds, uint256 dueTime, bool isOverdue, bool isActive)",
  "function collateralGwei(address) external view returns (uint256)",
  "event AgentAccessGranted(address indexed account, address indexed agent)",
];

const AUCTION_ABI = [
  "function getActiveAuctions() external view returns (uint256[])",
  "function auctions(uint256) external view returns (address borrower, uint256 startPrice, uint256 floorPrice, uint256 startTime, bool settled)",
  "function getCurrentPrice(uint256 auctionId) external view returns (uint256)",
];

// ─── Ethers setup ─────────────────────────────────────────────────────────────

const provider    = new ethers.JsonRpcProvider(RPC_URL);
const adminWallet = new ethers.Wallet(ADMIN_PRIVATE_KEY, provider);
const vault       = new ethers.Contract(VAULT_ADDRESS, VAULT_ABI, adminWallet);
const auction     = AUCTION_ADDRESS
  ? new ethers.Contract(AUCTION_ADDRESS, AUCTION_ABI, provider)
  : null;

// ─── Startup validation ───────────────────────────────────────────────────────

function assertConfig() {
  const required: [string, string][] = [
    ["VAULT_ADDRESS",     VAULT_ADDRESS],
    ["ADMIN_PRIVATE_KEY", ADMIN_PRIVATE_KEY],
    ["PAYMENT_ADDRESS",   PAYMENT_ADDRESS],
  ];
  const missing = required.filter(([, v]) => !v).map(([k]) => k);
  if (missing.length) {
    console.error(`[Config] Missing required env vars: ${missing.join(", ")}`);
    process.exit(1);
  }
}

function isAddress(v: unknown): v is string {
  return typeof v === "string" && ethers.isAddress(v);
}

// Payment token for data routes — prefer real USDC, fall back to cUSDC
const DATA_PAYMENT_TOKEN = USDC_ADDRESS || CUSDC_ADDRESS;

// ─── Express app ──────────────────────────────────────────────────────────────

const app = express();
app.use(cors());
app.use(express.json());

// ── GET /health ───────────────────────────────────────────────────────────────
app.get("/health", (_req: Request, res: Response) => {
  res.json({
    status: "ok",
    vault: VAULT_ADDRESS,
    auction: AUCTION_ADDRESS || "not set",
    paymentAddress: PAYMENT_ADDRESS,
    alphaFee: `${(Number(ALPHA_FEE) / 1e6).toFixed(2)} USDC`,
    dataFee:  `${(Number(DATA_FEE)  / 1e6).toFixed(4)} USDC`,
    network: RPC_URL,
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// /v1/alpha — FHE handle access (original flow)
// ═════════════════════════════════════════════════════════════════════════════

app.post("/v1/alpha", (req: Request, res: Response) => {
  const { agentAddress, borrowerAddress } = req.body ?? {};

  if (!isAddress(agentAddress) || !isAddress(borrowerAddress)) {
    res.status(400).json({ error: "agentAddress and borrowerAddress must be valid EVM addresses." });
    return;
  }

  if (hasGrant(agentAddress, borrowerAddress)) {
    res.status(200).json({
      granted: true,
      agentAddress,
      borrowerAddress,
      message: "Access already granted. Call getPositionHandles(borrower) on the Vault.",
    });
    return;
  }

  res.status(402).json({
    granted: false,
    payTo: PAYMENT_ADDRESS,
    amount: Number(ALPHA_FEE),
    amountFormatted: `${(Number(ALPHA_FEE) / 1e6).toFixed(2)} USDC`,
    currency: "USDC",
    tokenAddress: DATA_PAYMENT_TOKEN,
    network: RPC_URL,
    description: "Payment grants your agent FHE read access to the borrower's encrypted position handles via vault.grantAgentAccess().",
    confirmEndpoint: "POST /v1/alpha/confirm",
    requiredFields: ["agentAddress", "borrowerAddress", "txHash"],
  });
});

app.post("/v1/alpha/confirm", async (req: Request, res: Response) => {
  const { agentAddress, borrowerAddress, txHash } = req.body ?? {};

  if (!isAddress(agentAddress) || !isAddress(borrowerAddress)) {
    res.status(400).json({ error: "agentAddress and borrowerAddress must be valid EVM addresses." });
    return;
  }
  if (typeof txHash !== "string" || !txHash.startsWith("0x")) {
    res.status(400).json({ error: "txHash must be a 0x-prefixed hex string." });
    return;
  }

  if (hasGrant(agentAddress, borrowerAddress)) {
    res.status(200).json({ granted: true, message: "Access was already granted." });
    return;
  }

  console.log(`[x402/alpha] Verifying payment tx ${txHash}...`);
  const result = await verifyPayment(provider, txHash, DATA_PAYMENT_TOKEN, PAYMENT_ADDRESS, ALPHA_FEE);
  if (!result.ok) {
    res.status(402).json({ granted: false, error: result.reason });
    return;
  }

  try {
    const tx      = await vault.grantAgentAccess(borrowerAddress, agentAddress);
    const receipt = await tx.wait();
    recordGrant({ agentAddress, borrowerAddress, txHash, onChainTx: receipt.hash, grantedAt: new Date().toISOString() });
    res.status(200).json({
      granted: true, agentAddress, borrowerAddress, onChainTx: receipt.hash,
      message: "FHE read access granted. Call getPositionHandles(borrower) on the Vault.",
    });
  } catch (e: any) {
    res.status(500).json({ granted: false, error: "On-chain grant failed.", detail: e.message });
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// /v1/positions/unhealthy — pay 0.05 USDC to get overdue position list
// ═════════════════════════════════════════════════════════════════════════════

app.post("/v1/positions/unhealthy", (_req: Request, res: Response) => {
  res.status(402).json({
    granted: false,
    payTo: PAYMENT_ADDRESS,
    amount: Number(DATA_FEE),
    amountFormatted: `${(Number(DATA_FEE) / 1e6).toFixed(4)} USDC`,
    currency: "USDC",
    tokenAddress: DATA_PAYMENT_TOKEN,
    network: RPC_URL,
    description: "Pay 0.05 USDC to receive the list of all overdue borrow positions eligible for liquidation.",
    confirmEndpoint: "POST /v1/positions/unhealthy/confirm",
    requiredFields: ["txHash"],
  });
});

app.post("/v1/positions/unhealthy/confirm", async (req: Request, res: Response) => {
  const { txHash } = req.body ?? {};

  if (typeof txHash !== "string" || !txHash.startsWith("0x")) {
    res.status(400).json({ error: "txHash must be a 0x-prefixed hex string." });
    return;
  }

  console.log(`[x402/unhealthy] Verifying payment tx ${txHash}...`);
  const result = await verifyPayment(provider, txHash, DATA_PAYMENT_TOKEN, PAYMENT_ADDRESS, DATA_FEE);
  if (!result.ok) {
    res.status(402).json({ granted: false, error: result.reason });
    return;
  }

  try {
    // Fetch all active positions and filter to overdue ones
    const positions: string[] = await vault.getActivePositions();
    const now = Math.floor(Date.now() / 1000);

    const overdue: Array<{
      borrower: string;
      collateralEth: string;
      dueTime: number;
      overdueSeconds: number;
    }> = [];

    await Promise.all(
      positions.map(async (borrower) => {
        try {
          const [, , dueTime, isOverdue] = await vault.getLoanInfo(borrower);
          if (isOverdue) {
            const gwei: bigint = await vault.collateralGwei(borrower);
            overdue.push({
              borrower,
              collateralEth: ethers.formatEther(gwei * 1_000_000_000n),
              dueTime: Number(dueTime),
              overdueSeconds: now - Number(dueTime),
            });
          }
        } catch { /* skip */ }
      })
    );

    console.log(`[x402/unhealthy] Payment verified — returning ${overdue.length} overdue position(s)`);
    res.status(200).json({
      granted: true,
      count: overdue.length,
      positions: overdue,
      note: "Call vault.requestLiquidationCheck(borrower) for each position to trigger FHE health evaluation.",
    });
  } catch (e: any) {
    res.status(500).json({ error: "Failed to fetch positions.", detail: e.message });
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// /v1/auction/access — pay 0.05 USDC to get live auction data
// ═════════════════════════════════════════════════════════════════════════════

app.post("/v1/auction/access", (_req: Request, res: Response) => {
  res.status(402).json({
    granted: false,
    payTo: PAYMENT_ADDRESS,
    amount: Number(DATA_FEE),
    amountFormatted: `${(Number(DATA_FEE) / 1e6).toFixed(4)} USDC`,
    currency: "USDC",
    tokenAddress: DATA_PAYMENT_TOKEN,
    network: RPC_URL,
    description: "Pay 0.05 USDC to receive live auction data including current prices and collateral details.",
    confirmEndpoint: "POST /v1/auction/access/confirm",
    requiredFields: ["txHash"],
  });
});

app.post("/v1/auction/access/confirm", async (req: Request, res: Response) => {
  const { txHash } = req.body ?? {};

  if (typeof txHash !== "string" || !txHash.startsWith("0x")) {
    res.status(400).json({ error: "txHash must be a 0x-prefixed hex string." });
    return;
  }

  if (!auction) {
    res.status(503).json({ error: "AUCTION_ADDRESS not configured on this server." });
    return;
  }

  console.log(`[x402/auction] Verifying payment tx ${txHash}...`);
  const result = await verifyPayment(provider, txHash, DATA_PAYMENT_TOKEN, PAYMENT_ADDRESS, DATA_FEE);
  if (!result.ok) {
    res.status(402).json({ granted: false, error: result.reason });
    return;
  }

  try {
    const activeIds: bigint[] = await auction.getActiveAuctions();

    const auctions = await Promise.all(
      activeIds.map(async (id) => {
        const [borrower, startPrice, floorPrice, startTime] = await auction.auctions(id);
        const currentPrice: bigint = await auction.getCurrentPrice(id);
        const elapsed = Math.floor(Date.now() / 1000) - Number(startTime);
        const endsAt = Number(startTime) + 3600; // 1 hour auction
        return {
          auctionId: id.toString(),
          borrower,
          startPrice: ethers.formatEther(startPrice),
          floorPrice: ethers.formatEther(floorPrice),
          currentPrice: ethers.formatEther(currentPrice),
          discountPct: (100 - (Number(currentPrice) * 100 / Number(startPrice))).toFixed(1),
          startTime: Number(startTime),
          endsAt,
          secondsRemaining: Math.max(0, endsAt - Math.floor(Date.now() / 1000)),
        };
      })
    );

    console.log(`[x402/auction] Payment verified — returning ${auctions.length} active auction(s)`);
    res.status(200).json({
      granted: true,
      count: auctions.length,
      auctions,
      note: "Call auction.submitBid(auctionId, encMaxBid, proof) with ETH deposit >= floorPrice to participate.",
    });
  } catch (e: any) {
    res.status(500).json({ error: "Failed to fetch auction data.", detail: e.message });
  }
});

// ── GET /v1/grants ─────────────────────────────────────────────────────────────
app.get("/v1/grants", (_req: Request, res: Response) => {
  res.json({ count: allGrants().length, grants: allGrants() });
});

// ── Global error handler ──────────────────────────────────────────────────────
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error("[Server] Unhandled error:", err);
  res.status(500).json({ error: "Internal server error." });
});

// ─── Start ────────────────────────────────────────────────────────────────────

assertConfig();
loadGrants();

const port = parseInt(SERVER_PORT);
app.listen(port, () => {
  console.log(`
╔══════════════════════════════════════════════════════╗
║          Lendza  x402  Payment  Server               ║
╠══════════════════════════════════════════════════════╣
║  Listening  : http://localhost:${port.toString().padEnd(22)}║
║  Vault      : ${VAULT_ADDRESS.slice(0, 20)}...${" ".repeat(13)}║
║  Auction    : ${(AUCTION_ADDRESS || "not set").slice(0, 20).padEnd(23)}║
╠══════════════════════════════════════════════════════╣
║  POST /v1/alpha                  10 USDC             ║
║  POST /v1/positions/unhealthy    0.05 USDC           ║
║  POST /v1/auction/access         0.05 USDC           ║
║  GET  /v1/grants                 admin               ║
║  GET  /health                    liveness            ║
╚══════════════════════════════════════════════════════╝
`);
});
