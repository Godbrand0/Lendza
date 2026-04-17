/**
 * x402 Payment Server — Lendza Protocol
 *
 * Implements the x402 (HTTP 402 Payment Required) flow for gating FHE
 * position handle access. Agents pay a USDC fee to unlock read permissions
 * on encrypted borrower positions in the ConfidentialVault.
 *
 * Flow:
 *   1. Agent POSTs /v1/alpha        → server returns 402 with payment details
 *   2. Agent pays USDC on-chain
 *   3. Agent POSTs /v1/alpha/confirm → server verifies tx, calls grantAgentAccess()
 *   4. AgentAccessGranted fires on-chain → agent can read FHE handles
 *
 * Required .env:
 *   RPC_URL              — JSON-RPC endpoint (Zama devnet or Sepolia)
 *   VAULT_ADDRESS        — ConfidentialVault contract address
 *   CUSDC_ADDRESS        — cUSDC token address (used for payment verification)
 *   ADMIN_PRIVATE_KEY    — wallet authorised to call vault.grantAgentAccess()
 *   PAYMENT_ADDRESS      — USDC receiving address for fee collection
 *   X402_FEE_USDC        — fee in 6-decimal USDC units (default: 10000000 = 10 USDC)
 *   SERVER_PORT          — port to listen on (default: 3001)
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
  CUSDC_ADDRESS      = "",
  ADMIN_PRIVATE_KEY  = "",
  PAYMENT_ADDRESS    = "",
  X402_FEE_USDC      = "10000000",  // 10 USDC default
  SERVER_PORT        = "3001",
} = process.env;

const FEE = BigInt(X402_FEE_USDC);

// Only the function this server needs to call on the vault
const VAULT_ABI = [
  "function grantAgentAccess(address account, address agent) external",
  "event AgentAccessGranted(address indexed account, address indexed agent)",
];

// ─── Ethers setup ─────────────────────────────────────────────────────────────

const provider    = new ethers.JsonRpcProvider(RPC_URL);
const adminWallet = new ethers.Wallet(ADMIN_PRIVATE_KEY, provider);
const vault       = new ethers.Contract(VAULT_ADDRESS, VAULT_ABI, adminWallet);

// ─── Startup validation ───────────────────────────────────────────────────────

function assertConfig() {
  const required: [string, string][] = [
    ["VAULT_ADDRESS",     VAULT_ADDRESS],
    ["CUSDC_ADDRESS",     CUSDC_ADDRESS],
    ["ADMIN_PRIVATE_KEY", ADMIN_PRIVATE_KEY],
    ["PAYMENT_ADDRESS",   PAYMENT_ADDRESS],
  ];
  const missing = required.filter(([, v]) => !v).map(([k]) => k);
  if (missing.length) {
    console.error(`[Config] Missing required env vars: ${missing.join(", ")}`);
    process.exit(1);
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function isAddress(v: unknown): v is string {
  return typeof v === "string" && ethers.isAddress(v);
}

// ─── Express app ──────────────────────────────────────────────────────────────

const app = express();
app.use(cors());
app.use(express.json());

// ── GET /health ───────────────────────────────────────────────────────────────
app.get("/health", (_req: Request, res: Response) => {
  res.json({
    status: "ok",
    vault: VAULT_ADDRESS,
    paymentAddress: PAYMENT_ADDRESS,
    feeUsdc: `${(Number(FEE) / 1e6).toFixed(2)} USDC`,
    network: RPC_URL,
  });
});

// ── POST /v1/alpha ─────────────────────────────────────────────────────────────
// Step 1 of the x402 flow.
// Returns 200 if access is already granted, or 402 with payment requirements.
app.post("/v1/alpha", (req: Request, res: Response) => {
  const { agentAddress, borrowerAddress } = req.body ?? {};

  if (!isAddress(agentAddress) || !isAddress(borrowerAddress)) {
    res.status(400).json({
      error: "agentAddress and borrowerAddress must be valid EVM addresses.",
    });
    return;
  }

  if (hasGrant(agentAddress, borrowerAddress)) {
    res.status(200).json({
      granted: true,
      agentAddress,
      borrowerAddress,
      message:
        "Access already granted. Call getPositionHandles(borrower) on the Vault.",
    });
    return;
  }

  // Return 402 with everything the agent needs to complete payment
  res.status(402).json({
    granted: false,
    // Payment details
    payTo: PAYMENT_ADDRESS,
    amount: Number(FEE),                           // raw 6-decimal integer
    amountFormatted: `${(Number(FEE) / 1e6).toFixed(2)} USDC`,
    currency: "USDC",
    tokenAddress: CUSDC_ADDRESS,
    network: RPC_URL,
    // What is unlocked after payment
    description:
      "Payment grants your agent FHE read access to the borrower's encrypted position handles via vault.grantAgentAccess().",
    // How to confirm
    confirmEndpoint: "POST /v1/alpha/confirm",
    requiredFields: ["agentAddress", "borrowerAddress", "txHash"],
  });
});

// ── POST /v1/alpha/confirm ────────────────────────────────────────────────────
// Step 2 of the x402 flow.
// Agent submits their payment txHash; server verifies on-chain then grants access.
app.post("/v1/alpha/confirm", async (req: Request, res: Response) => {
  const { agentAddress, borrowerAddress, txHash } = req.body ?? {};

  if (!isAddress(agentAddress) || !isAddress(borrowerAddress)) {
    res.status(400).json({
      error: "agentAddress and borrowerAddress must be valid EVM addresses.",
    });
    return;
  }

  if (typeof txHash !== "string" || !txHash.startsWith("0x")) {
    res.status(400).json({ error: "txHash must be a 0x-prefixed hex string." });
    return;
  }

  // Idempotent — if already granted, just confirm it
  if (hasGrant(agentAddress, borrowerAddress)) {
    res.status(200).json({
      granted: true,
      message: "Access was already granted for this (agent, borrower) pair.",
    });
    return;
  }

  // ── 1. Verify the USDC transfer on-chain ──────────────────────────────────
  console.log(`[x402] Verifying payment tx ${txHash} for agent ${agentAddress}...`);

  const result = await verifyPayment(
    provider,
    txHash,
    CUSDC_ADDRESS,
    PAYMENT_ADDRESS,
    FEE
  );

  if (!result.ok) {
    console.warn(`[x402] Payment verification failed: ${result.reason}`);
    res.status(402).json({ granted: false, error: result.reason });
    return;
  }

  console.log(`[x402] Payment verified — ${result.amount} USDC units from ${result.from}`);

  // ── 2. Call vault.grantAgentAccess(borrower, agent) on-chain ─────────────
  let onChainTx: string;
  try {
    console.log(
      `[x402] Calling grantAgentAccess(${borrowerAddress}, ${agentAddress})...`
    );
    const tx      = await vault.grantAgentAccess(borrowerAddress, agentAddress);
    const receipt = await tx.wait();
    onChainTx     = receipt.hash;
    console.log(`[x402] Access granted — tx: ${onChainTx}`);
  } catch (e: any) {
    console.error("[x402] grantAgentAccess failed:", e.message);
    res.status(500).json({
      granted: false,
      error:
        "On-chain grant call failed. Ensure the server wallet is authorised on the Vault.",
      detail: e.message,
    });
    return;
  }

  // ── 3. Persist the grant ──────────────────────────────────────────────────
  recordGrant({
    agentAddress,
    borrowerAddress,
    txHash,
    onChainTx,
    grantedAt: new Date().toISOString(),
  });

  res.status(200).json({
    granted: true,
    agentAddress,
    borrowerAddress,
    onChainTx,
    message:
      "FHE read access granted. Your agent wallet can now call getPositionHandles(borrower) on the Vault.",
  });
});

// ── GET /v1/grants ─────────────────────────────────────────────────────────────
// Admin — list every (agent, borrower) pair that has been granted access.
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
  const pad = (s: string, n: number) => s + " ".repeat(Math.max(0, n - s.length));
  console.log(`
╔══════════════════════════════════════════════════════╗
║          Lendza  x402  Payment  Server               ║
╠══════════════════════════════════════════════════════╣
║  ${pad(`Listening  : http://localhost:${port}`, 52)}║
║  ${pad(`Vault      : ${VAULT_ADDRESS.slice(0, 30)}...`, 52)}║
║  ${pad(`Pay to     : ${PAYMENT_ADDRESS.slice(0, 30)}...`, 52)}║
║  ${pad(`Fee        : ${(Number(FEE) / 1e6).toFixed(2)} USDC`, 52)}║
╠══════════════════════════════════════════════════════╣
║  POST /v1/alpha          probe — 200 or 402          ║
║  POST /v1/alpha/confirm  submit payment proof        ║
║  GET  /v1/grants         list all granted pairs      ║
║  GET  /health            liveness check              ║
╚══════════════════════════════════════════════════════╝
`);
});
