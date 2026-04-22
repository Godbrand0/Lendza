/**
 * Monitor Agent — Liquidation Scout
 *
 * Strategy:
 *   Scans for overdue borrow positions every 60 seconds and submits each one
 *   for an FHE health check. When a position is found unhealthy the Zama relayer
 *   calls resolveHealthCheck() on-chain, the Vault starts a liquidation, and
 *   this agent receives TRIGGER_FEE_BPS = 100 (1%) of the collateral ETH.
 *
 * x402 integration (when X402_SERVER_URL is set):
 *   Pays 0.05 USDC to the x402 server to get a pre-filtered list of overdue
 *   positions instead of fetching all active positions and checking each one.
 *   Falls back to direct chain scan when X402_SERVER_URL is not configured.
 *
 * Wallet needs:
 *   ETH for gas + a small amount of mock USDC if using x402 (0.05 USDC per scan).
 *
 * Env:
 *   RPC_URL, VAULT_ADDRESS, MONITOR_PRIVATE_KEY
 *   X402_SERVER_URL     — optional: pay for pre-filtered overdue position list
 *   MOCK_USDC_ADDRESS   — optional: overrides default Sepolia mock USDC address
 */

import { ethers } from "ethers";
import { config, VAULT_ABI, makeLogger } from "../shared";
import { X402Client, OverduePosition } from "../x402client";

const log = makeLogger("Monitor");

const SCAN_INTERVAL_MS = 60_000;

// Track positions with a pending check to avoid duplicate calls
const pendingChecks = new Set<string>();

// ── x402-powered scan ─────────────────────────────────────────────────────────

async function scanViaX402(
  x402: X402Client,
  vault: ethers.Contract,
): Promise<void> {
  let positions: OverduePosition[];
  try {
    positions = await x402.getOverduePositions();
    log.info(`x402 scan — ${positions.length} overdue position(s) returned`);
  } catch (e: any) {
    log.warn(`x402 scan failed: ${e.message} — falling back to chain scan`);
    await scanChain(vault);
    return;
  }

  for (const { borrower, collateralEth, overdueSeconds } of positions) {
    if (pendingChecks.has(borrower.toLowerCase())) {
      log.info(`Skipping ${borrower} — check already in-flight`);
      continue;
    }
    log.info(
      `Overdue position: ${borrower} — ` +
      `${collateralEth} ETH collateral — ` +
      `${Math.round(overdueSeconds / 60)}m overdue`
    );
    await submitCheck(vault, borrower);
  }
}

// ── Direct chain scan (fallback) ──────────────────────────────────────────────

async function scanChain(vault: ethers.Contract): Promise<void> {
  const positions: string[] = await vault.getActivePositions();
  log.info(`Chain scan — ${positions.length} active position(s) found`);

  for (const borrower of positions) {
    if (pendingChecks.has(borrower.toLowerCase())) {
      log.info(`Skipping ${borrower} — check already in-flight`);
      continue;
    }
    await submitCheck(vault, borrower);
  }
}

// ── Shared: submit a health check for one borrower ────────────────────────────

async function submitCheck(vault: ethers.Contract, borrower: string): Promise<void> {
  try {
    log.info(`Requesting health check for ${borrower}…`);
    const tx = await vault.requestLiquidationCheck(borrower);
    const receipt = await tx.wait();
    pendingChecks.add(borrower.toLowerCase());
    log.info(`Health check submitted — tx: ${receipt.hash}`);
  } catch (e: any) {
    if (e.message?.includes("AlreadyPendingCheck")) {
      pendingChecks.add(borrower.toLowerCase());
      log.info(`${borrower} already has an in-flight check`);
    } else {
      log.error(`Failed for ${borrower}:`, e.message);
    }
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  if (!config.vaultAddress) throw new Error("VAULT_ADDRESS is not set in .env");
  if (!config.monitorKey)   throw new Error("MONITOR_PRIVATE_KEY is not set in .env");

  const provider = new ethers.JsonRpcProvider(config.rpcUrl);
  const wallet   = new ethers.Wallet(config.monitorKey, provider);
  const vault    = new ethers.Contract(config.vaultAddress, VAULT_ABI, wallet);

  const balance = await provider.getBalance(wallet.address);
  log.info(`Starting monitor agent`);
  log.info(`Wallet  : ${wallet.address}`);
  log.info(`Balance : ${ethers.formatEther(balance)} ETH`);
  log.info(`Vault   : ${config.vaultAddress}`);

  // ── x402 client (optional) ────────────────────────────────────────────────

  let x402: X402Client | null = null;
  if (config.x402ServerUrl) {
    x402 = new X402Client(
      config.x402ServerUrl,
      wallet,
      config.mockUsdcAddress,
      (msg) => log.info(msg),
    );
    log.info(`x402 server : ${config.x402ServerUrl} (paying 0.05 USDC per scan)`);
  } else {
    log.info(`x402 server : not configured — using direct chain scan`);
  }

  // ── Event listeners ───────────────────────────────────────────────────────

  vault.on("HealthCheckResolved", (borrower: string, isUnhealthy: boolean) => {
    pendingChecks.delete(borrower.toLowerCase());
    if (isUnhealthy) {
      log.win(`Position UNHEALTHY — ${borrower} — liquidation starting`);
    } else {
      log.info(`Position healthy — ${borrower}`);
    }
  });

  vault.on("LiquidationStarted", (borrower: string) => {
    log.win(`LIQUIDATION TRIGGERED — ${borrower} — 1% trigger fee earned!`);
  });

  // ── Scan loop ─────────────────────────────────────────────────────────────

  const scan = () =>
    x402 ? scanViaX402(x402!, vault) : scanChain(vault);

  await scan();
  setInterval(scan, SCAN_INTERVAL_MS);

  log.info(`Scanning every ${SCAN_INTERVAL_MS / 1000}s…`);
}

main().catch((e) => {
  console.error("[Monitor] Fatal error:", e);
  process.exit(1);
});
