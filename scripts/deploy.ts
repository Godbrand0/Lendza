/**
 * ARGEN × ZAMA — Deployment Script
 *
 * Run on Sepolia:
 *   npm run deploy:sepolia
 *
 * Run locally (mock FHE, fast):
 *   npm run deploy:localhost
 *
 * Required hardhat vars (set once with `npx hardhat vars set <KEY>`):
 *   MNEMONIC        — deployer wallet mnemonic
 *   INFURA_API_KEY  — Infura project ID for Sepolia RPC
 *   ETHERSCAN_API_KEY (optional) — for contract verification
 *
 * Deployment order (each depends on the previous):
 *   1. MockPriceFeed   — $3,000 ETH/USD (8-dec Chainlink format)
 *   2. PriceOracle     — wraps MockPriceFeed
 *   3. ConfidentialCollateral (cETH)  — needs Vault address (predicted via nonce)
 *   4. ConfidentialDebt (cUSDC)       — needs Vault address (predicted via nonce)
 *   5. ConfidentialVault              — needs oracle, cETH, cUSDC
 *   6. DutchAuction                   — needs Vault address
 *   7. vault.setAuctionContract()     — wires Vault ↔ Auction
 *
 * After deployment, addresses are written to frontend/.env.local automatically.
 */

import fs from "fs";
import path from "path";
import hre from "hardhat";

async function main() {
  const { ethers } = hre;
  const [deployer] = await ethers.getSigners();

  console.log("=".repeat(60));
  console.log("  ARGEN × ZAMA — Deployment");
  console.log("=".repeat(60));
  console.log(`  Network  : ${hre.network.name}`);
  console.log(`  Deployer : ${deployer.address}`);
  console.log(
    `  Balance  : ${ethers.formatEther(await ethers.provider.getBalance(deployer.address))} ETH`
  );
  console.log("=".repeat(60));

  // ─── 1. MockPriceFeed ───────────────────────────────────────────────────────
  console.log("\n[1/7] Deploying MockPriceFeed...");
  const MockPriceFeed = await ethers.getContractFactory("MockPriceFeed");
  const mockPriceFeed = await MockPriceFeed.deploy(
    300_000_000_000n // $3,000 with 8 decimals
  );
  await mockPriceFeed.waitForDeployment();
  const mockPriceFeedAddress = await mockPriceFeed.getAddress();
  console.log(`      MockPriceFeed → ${mockPriceFeedAddress}`);

  // ─── 2. PriceOracle ─────────────────────────────────────────────────────────
  console.log("\n[2/7] Deploying PriceOracle...");
  const PriceOracle = await ethers.getContractFactory("PriceOracle");
  const oracle = await PriceOracle.deploy(mockPriceFeedAddress);
  await oracle.waitForDeployment();
  const oracleAddress = await oracle.getAddress();
  console.log(`      PriceOracle   → ${oracleAddress}`);

  // ─── Pre-compute Vault address ──────────────────────────────────────────────
  // After deploying MockPriceFeed + PriceOracle, the deployer's nonce is N+2.
  // The next deploys will be:
  //   nonce N+2 → cETH
  //   nonce N+3 → cUSDC
  //   nonce N+4 → ConfidentialVault  ← this is what cETH/cUSDC need
  const currentNonce = await deployer.getNonce();
  const predictedVaultAddress = ethers.getCreateAddress({
    from: deployer.address,
    nonce: currentNonce + 2, // +0=cETH, +1=cUSDC, +2=Vault
  });
  console.log(`\n      Predicted Vault address: ${predictedVaultAddress}`);

  // ─── 3. ConfidentialCollateral (cETH) ───────────────────────────────────────
  console.log("\n[3/7] Deploying ConfidentialCollateral (cETH)...");
  const ConfidentialCollateral = await ethers.getContractFactory("ConfidentialCollateral");
  const cETH = await ConfidentialCollateral.deploy(predictedVaultAddress);
  await cETH.waitForDeployment();
  const cETHAddress = await cETH.getAddress();
  console.log(`      cETH          → ${cETHAddress}`);

  // ─── 4. ConfidentialDebt (cUSDC) ────────────────────────────────────────────
  console.log("\n[4/7] Deploying ConfidentialDebt (cUSDC)...");
  const ConfidentialDebt = await ethers.getContractFactory("ConfidentialDebt");
  const cUSDC = await ConfidentialDebt.deploy(predictedVaultAddress);
  await cUSDC.waitForDeployment();
  const cUSDCAddress = await cUSDC.getAddress();
  console.log(`      cUSDC         → ${cUSDCAddress}`);

  // ─── 5. ConfidentialVault ────────────────────────────────────────────────────
  console.log("\n[5/7] Deploying ConfidentialVault...");
  const ConfidentialVault = await ethers.getContractFactory("ConfidentialVault");
  const vault = await ConfidentialVault.deploy(oracleAddress, cETHAddress, cUSDCAddress);
  await vault.waitForDeployment();
  const vaultAddress = await vault.getAddress();
  console.log(`      Vault         → ${vaultAddress}`);

  // Sanity-check: predicted address must match actual
  if (vaultAddress.toLowerCase() !== predictedVaultAddress.toLowerCase()) {
    throw new Error(
      `Vault address mismatch!\n  Predicted: ${predictedVaultAddress}\n  Actual:    ${vaultAddress}`
    );
  }
  console.log("      ✓ Address matches prediction");

  // ─── 6. DutchAuction ────────────────────────────────────────────────────────
  console.log("\n[6/7] Deploying DutchAuction...");
  const DutchAuction = await ethers.getContractFactory("DutchAuction");
  const auction = await DutchAuction.deploy(vaultAddress);
  await auction.waitForDeployment();
  const auctionAddress = await auction.getAddress();
  console.log(`      DutchAuction  → ${auctionAddress}`);

  // ─── 7. Wire Vault → Auction ─────────────────────────────────────────────────
  console.log("\n[7/7] Wiring: vault.setAuctionContract()...");
  const tx = await vault.setAuctionContract(auctionAddress);
  await tx.wait();
  console.log(`      ✓ Auction registered in Vault (tx: ${tx.hash})`);

  // ─── Summary ─────────────────────────────────────────────────────────────────
  console.log("\n" + "=".repeat(60));
  console.log("  Deployment complete");
  console.log("=".repeat(60));
  console.log(`  MockPriceFeed        : ${mockPriceFeedAddress}`);
  console.log(`  PriceOracle          : ${oracleAddress}`);
  console.log(`  ConfidentialCollateral (cETH) : ${cETHAddress}`);
  console.log(`  ConfidentialDebt     (cUSDC)  : ${cUSDCAddress}`);
  console.log(`  ConfidentialVault    : ${vaultAddress}`);
  console.log(`  DutchAuction         : ${auctionAddress}`);
  console.log("=".repeat(60));

  // ─── Write frontend/.env.local ───────────────────────────────────────────────
  const envPath = path.resolve(__dirname, "../frontend/.env.local");

  // Preserve any existing variables that aren't being overwritten
  let existing: Record<string, string> = {};
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, "utf8").split("\n");
    for (const line of lines) {
      const [key, ...rest] = line.split("=");
      if (key && rest.length) existing[key.trim()] = rest.join("=").trim();
    }
  }

  const newVars: Record<string, string> = {
    ...existing,
    NEXT_PUBLIC_VAULT_ADDRESS: vaultAddress,
    NEXT_PUBLIC_AUCTION_ADDRESS: auctionAddress,
    NEXT_PUBLIC_CETH_ADDRESS: cETHAddress,
    NEXT_PUBLIC_CUSDC_ADDRESS: cUSDCAddress,
    NEXT_PUBLIC_ORACLE_ADDRESS: oracleAddress,
  };

  const envContent = Object.entries(newVars)
    .map(([k, v]) => `${k}=${v}`)
    .join("\n") + "\n";

  fs.writeFileSync(envPath, envContent);
  console.log(`\n  ✓ Addresses written to frontend/.env.local`);
}

main().catch((err) => {
  console.error("\n✗ Deployment failed:", err);
  process.exit(1);
});
