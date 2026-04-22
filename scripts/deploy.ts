/**
 * ARGEN × ZAMA — Core Deployment Script
 *
 * Run on Sepolia:
 *   npm run deploy:sepolia
 *
 * Deploys 4 contracts:
 *   1. ConfidentialCollateral (cETH)  — needs Vault address (predicted via nonce)
 *   2. ConfidentialDebt (cUSDC)       — needs Vault address (predicted via nonce)
 *   3. ConfidentialVault              — needs cETH, cUSDC
 *   4. DutchAuction                   — needs Vault address
 *   + wires Vault ↔ Auction via setAuctionContract()
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

  // Predict Vault address to break the circular dependency:
  //   nonce+0 → cETH
  //   nonce+1 → cUSDC
  //   nonce+2 → ConfidentialVault  ← what cETH/cUSDC need at deploy time
  const currentNonce = await deployer.getNonce();
  const predictedVaultAddress = ethers.getCreateAddress({
    from: deployer.address,
    nonce: currentNonce + 2,
  });
  console.log(`\n  Predicted Vault address: ${predictedVaultAddress}`);

  // ─── 1. ConfidentialCollateral (cETH) ───────────────────────────────────────
  console.log("\n[1/4] Deploying ConfidentialCollateral (cETH)...");
  const ConfidentialCollateral = await ethers.getContractFactory("ConfidentialCollateral");
  const cETH = await ConfidentialCollateral.deploy(predictedVaultAddress);
  await cETH.waitForDeployment();
  const cETHAddress = await cETH.getAddress();
  console.log(`      cETH  → ${cETHAddress}`);

  // ─── 2. ConfidentialDebt (cUSDC) ────────────────────────────────────────────
  console.log("\n[2/4] Deploying ConfidentialDebt (cUSDC)...");
  const ConfidentialDebt = await ethers.getContractFactory("ConfidentialDebt");
  const cUSDC = await ConfidentialDebt.deploy(predictedVaultAddress);
  await cUSDC.waitForDeployment();
  const cUSDCAddress = await cUSDC.getAddress();
  console.log(`      cUSDC → ${cUSDCAddress}`);

  // ─── 3. ConfidentialVault ────────────────────────────────────────────────────
  // Mock USDC on Sepolia (Zama's public faucet token)
  const MOCK_USDC = "0x9b5Cd13b8eFbB58Dc25A05CF411D8056058aDFfF";
  console.log("\n[3/4] Deploying ConfidentialVault...");
  const ConfidentialVault = await ethers.getContractFactory("ConfidentialVault");
  const vault = await ConfidentialVault.deploy(cETHAddress, cUSDCAddress, MOCK_USDC);
  await vault.waitForDeployment();
  const vaultAddress = await vault.getAddress();
  console.log(`      Vault → ${vaultAddress}`);

  if (vaultAddress.toLowerCase() !== predictedVaultAddress.toLowerCase()) {
    throw new Error(
      `Vault address mismatch!\n  Predicted: ${predictedVaultAddress}\n  Actual:    ${vaultAddress}`
    );
  }
  console.log("      ✓ Address matches prediction");

  // ─── 4. DutchAuction ─────────────────────────────────────────────────────────
  console.log("\n[4/4] Deploying DutchAuction...");
  const DutchAuction = await ethers.getContractFactory("DutchAuction");
  const auction = await DutchAuction.deploy(vaultAddress);
  await auction.waitForDeployment();
  const auctionAddress = await auction.getAddress();
  console.log(`      Auction → ${auctionAddress}`);

  // ─── Wire Vault → Auction ─────────────────────────────────────────────────────
  console.log("\n[+] Wiring: vault.setAuctionContract()...");
  const wireTx = await vault.setAuctionContract(auctionAddress);
  await wireTx.wait();
  console.log(`      ✓ Auction registered in Vault`);

  // ─── Summary ─────────────────────────────────────────────────────────────────
  console.log("\n" + "=".repeat(60));
  console.log("  Deployment complete");
  console.log("=".repeat(60));
  console.log(`  cETH    : ${cETHAddress}`);
  console.log(`  cUSDC   : ${cUSDCAddress}`);
  console.log(`  Vault   : ${vaultAddress}`);
  console.log(`  Auction : ${auctionAddress}`);
  console.log("=".repeat(60));

  // ─── Write frontend/.env.local ───────────────────────────────────────────────
  const envPath = path.resolve(__dirname, "../frontend/.env.local");

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
  };

  const envContent =
    Object.entries(newVars)
      .map(([k, v]) => `${k}=${v}`)
      .join("\n") + "\n";

  fs.writeFileSync(envPath, envContent);
  console.log(`\n  ✓ Addresses written to frontend/.env.local`);

  // ─── Write agent/.env if it exists ───────────────────────────────────────────
  const agentEnvPath = path.resolve(__dirname, "../agent/.env");
  if (fs.existsSync(agentEnvPath)) {
    let agentExisting: Record<string, string> = {};
    const agentLines = fs.readFileSync(agentEnvPath, "utf8").split("\n");
    for (const line of agentLines) {
      const [key, ...rest] = line.split("=");
      if (key && rest.length) agentExisting[key.trim()] = rest.join("=").trim();
    }
    const agentVars = {
      ...agentExisting,
      VAULT_ADDRESS: vaultAddress,
      AUCTION_ADDRESS: auctionAddress,
    };
    fs.writeFileSync(
      agentEnvPath,
      Object.entries(agentVars).map(([k, v]) => `${k}=${v}`).join("\n") + "\n"
    );
    console.log(`  ✓ Addresses written to agent/.env`);
  }
}

main().catch((err) => {
  console.error("\n✗ Deployment failed:", err);
  process.exit(1);
});
