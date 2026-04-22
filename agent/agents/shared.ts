/**
 * shared.ts — Common utilities for all Lendza agents
 * Provides ABIs, FHE instance initialisation, and a simple logger.
 */

import { ethers } from "ethers";
import { initFhevm, createInstance, FhevmInstance } from "fhevmjs";
import * as dotenv from "dotenv";

dotenv.config();

// ─── Config ──────────────────────────────────────────────────────────────────

export const config = {
  rpcUrl:           process.env.RPC_URL               || "http://localhost:8545",
  vaultAddress:     process.env.VAULT_ADDRESS          || "",
  auctionAddress:   process.env.AUCTION_ADDRESS        || "",
  monitorKey:       process.env.MONITOR_PRIVATE_KEY    || "",
  bidderAlphaKey:   process.env.BIDDER_ALPHA_PRIVATE_KEY   || "",
  bidderDiscountKey:process.env.BIDDER_DISCOUNT_PRIVATE_KEY || "",
  bidderSniperKey:  process.env.BIDDER_SNIPER_PRIVATE_KEY  || "",
  // x402 payment layer
  x402ServerUrl:    process.env.X402_SERVER_URL        || "",
  mockUsdcAddress:  process.env.MOCK_USDC_ADDRESS      || "0x9b5Cd13b8eFbB58Dc25A05CF411D8056058aDFfF",
};

// ─── ABIs ────────────────────────────────────────────────────────────────────

export const VAULT_ABI = [
  "function getActivePositions() external view returns (address[])",
  "function requestLiquidationCheck(address borrower) external",
  "event HealthCheckResolved(address indexed borrower, bool isUnhealthy)",
  "event LiquidationStarted(address indexed borrower)",
  "event AgentAccessGranted(address indexed account, address indexed agent)",
];

export const AUCTION_ABI = [
  "function getActiveAuctions() external view returns (uint256[])",
  "function getCurrentPrice(uint256 auctionId) public view returns (uint256)",
  "function submitBid(uint256 auctionId, bytes32 encMaxBid, bytes inputProof) external payable",
  "function requestBidResolution(uint256 auctionId, address bidder) external",
  "function auctions(uint256) external view returns (address borrower, uint256 startPrice, uint256 floorPrice, uint256 startTime, bool settled)",
  "event AuctionStarted(uint256 indexed auctionId, address indexed borrower, uint256 startPrice)",
  "event AuctionSettled(uint256 indexed auctionId, address indexed winner, uint256 pricePaid)",
  "event BidRefunded(uint256 indexed auctionId, address indexed bidder)",
];

// ─── FHE ─────────────────────────────────────────────────────────────────────

let _fheInstance: FhevmInstance | null = null;

export async function getFheInstance(provider: ethers.Provider): Promise<FhevmInstance> {
  if (_fheInstance) return _fheInstance;

  await initFhevm();
  const network = await provider.getNetwork();

  _fheInstance = await createInstance({
    chainId: Number(network.chainId),
    // @ts-ignore — Zama public key gateway
    publicKey: await provider.call({
      to: "0x000000000000000000000000000000000000005d",
      data: "0xd9438255",
    }),
  });

  return _fheInstance;
}

// ─── Logger ──────────────────────────────────────────────────────────────────

export function makeLogger(name: string) {
  const tag = `[${name}]`;
  return {
    info:  (...args: unknown[]) => console.log( tag, ...args),
    warn:  (...args: unknown[]) => console.warn( tag, "⚠", ...args),
    error: (...args: unknown[]) => console.error(tag, "✗", ...args),
    win:   (...args: unknown[]) => console.log( tag, "✓", ...args),
  };
}
