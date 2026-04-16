import { ethers } from "ethers";
import * as dotenv from "dotenv";

dotenv.config();

const VAULT_ADDRESS = process.env.VAULT_ADDRESS || "";
const RPC_URL = process.env.RPC_URL || "http://localhost:8545";
const PRIVATE_KEY = process.env.MONITOR_PRIVATE_KEY || "";

const VAULT_ABI = [
  "function getActivePositions() external view returns (uint256[])",
  "function requestLiquidationCheck(uint256 positionId) external returns (bytes32)",
  "event HealthCheckResolved(uint256 indexed positionId, bool isUnhealthy)"
];

async function main() {
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
  const vault = new ethers.Contract(VAULT_ADDRESS, VAULT_ABI, wallet);

  console.log(`[Monitor] Starting autonomous scout at ${VAULT_ADDRESS}...`);

  // Periodic scan
  setInterval(async () => {
    try {
      console.log("[Monitor] Scanning active positions...");
      const positions = await vault.getActivePositions();
      console.log(`[Monitor] Found ${positions.length} active positions.`);

      for (const posId of positions) {
        console.log(`[Monitor] Requesting health check for position #${posId}...`);
        const tx = await vault.requestLiquidationCheck(posId);
        const receipt = await tx.wait();
        console.log(`[Monitor] Triggered check in tx: ${receipt.hash}`);
      }
    } catch (error) {
      console.error("[Monitor] Scan error:", error);
    }
  }, 60000); // Scan every 60 seconds

  // Optional: Listen for resolutions to track success
  vault.on("HealthCheckResolved", (positionId, isUnhealthy) => {
    console.log(`[Monitor] HEALTH EVENT: Position #${positionId} resolution: ${isUnhealthy ? "UNHEALTHY (Liquidation Started)" : "HEALTHY"}`);
  });
}

main().catch(console.error);
