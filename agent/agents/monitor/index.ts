/**
 * Monitor Agent — Liquidation Scout
 *
 * Strategy:
 *   Scans all active borrower positions every 60 seconds and submits each one
 *   for an FHE health check. When a position is found unhealthy the Zama relayer
 *   calls resolveHealthCheck() on-chain, the Vault starts a liquidation, and
 *   this agent receives TRIGGER_FEE_BPS = 100 (1%) of the collateral ETH.
 *
 * Earnings:
 *   1% of collateral ETH per liquidation triggered.
 *
 * Wallet needs:
 *   ETH for gas only — no token balance required.
 *
 * Env:
 *   RPC_URL, VAULT_ADDRESS, MONITOR_PRIVATE_KEY
 */

import { ethers } from "ethers";
import { config, VAULT_ABI, makeLogger } from "../shared";

const log = makeLogger("Monitor");

// How often to scan all positions (ms)
const SCAN_INTERVAL_MS = 60_000;

// Track positions that currently have a pending check to avoid duplicate calls
const pendingChecks = new Set<string>();

async function scan(vault: ethers.Contract, wallet: ethers.Wallet) {
  const positions: string[] = await vault.getActivePositions();
  log.info(`Scan complete — ${positions.length} active position(s) found`);

  for (const borrower of positions) {
    if (pendingChecks.has(borrower.toLowerCase())) {
      log.info(`Skipping ${borrower} — check already in-flight`);
      continue;
    }

    try {
      log.info(`Requesting health check for ${borrower}...`);
      const tx = await vault.requestLiquidationCheck(borrower);
      const receipt = await tx.wait();
      pendingChecks.add(borrower.toLowerCase());
      log.info(`Health check submitted for ${borrower} — tx: ${receipt.hash}`);
    } catch (e: any) {
      if (e.message?.includes("AlreadyPendingCheck")) {
        // Position already has an in-flight FHE check — mark it and skip
        pendingChecks.add(borrower.toLowerCase());
      } else {
        log.error(`Failed for ${borrower}:`, e.message);
      }
    }
  }
}

async function main() {
  if (!config.vaultAddress) throw new Error("VAULT_ADDRESS is not set in .env");
  if (!config.monitorKey)   throw new Error("MONITOR_PRIVATE_KEY is not set in .env");

  const provider = new ethers.JsonRpcProvider(config.rpcUrl);
  const wallet   = new ethers.Wallet(config.monitorKey, provider);
  const vault    = new ethers.Contract(config.vaultAddress, VAULT_ABI, wallet);

  const balance = await provider.getBalance(wallet.address);
  log.info(`Starting monitor agent`);
  log.info(`Wallet : ${wallet.address}`);
  log.info(`Balance: ${ethers.formatEther(balance)} ETH`);
  log.info(`Vault  : ${config.vaultAddress}`);
  log.info(`Scan interval: ${SCAN_INTERVAL_MS / 1000}s`);

  // ── Event listeners ──────────────────────────────────────────────────────

  vault.on("HealthCheckResolved", (borrower: string, isUnhealthy: boolean) => {
    pendingChecks.delete(borrower.toLowerCase());
    if (isUnhealthy) {
      log.win(`Position UNHEALTHY — ${borrower} — awaiting liquidation start`);
    } else {
      log.info(`Position healthy — ${borrower}`);
    }
  });

  vault.on("LiquidationStarted", (borrower: string) => {
    log.win(`LIQUIDATION TRIGGERED — ${borrower} — 1% trigger fee earned!`);
  });

  // ── Initial scan, then repeat ─────────────────────────────────────────────

  await scan(vault, wallet);
  setInterval(() => scan(vault, wallet), SCAN_INTERVAL_MS);
}

main().catch((e) => {
  console.error("[Monitor] Fatal error:", e);
  process.exit(1);
});
