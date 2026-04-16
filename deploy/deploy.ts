import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();
  const { deploy } = hre.deployments;

  console.log("\n--- Deploying ARGEN × ZAMA Suite ---");

  // 1. Mock Price Feed (Sepolia/Hardhat)
  const mockPriceFeed = await deploy("MockPriceFeed", {
    from: deployer,
    args: [300000000000], // $3,000 ETH price (8 decimals)
    log: true,
  });

  // 2. Price Oracle
  const oracle = await deploy("PriceOracle", {
    from: deployer,
    args: [mockPriceFeed.address],
    log: true,
  });

  // 3. Predict Vault Address to break circular dependency
  // Using ethers v6 (getNonce + getContractAddress)
  const wallet = await hre.ethers.getSigner(deployer);
  const nonce = await wallet.getNonce();
  const vaultAddress = hre.ethers.getContractAddress({
    from: deployer,
    nonce: nonce + 2, // oracle(0), cETH(1), cUSDC(2) -> NO, let's be careful
  });
  
  // Actually, let's just deploy oracle, then tokens (with predicted vault), then vault.
  const predictedVaultAddress = hre.ethers.getContractAddress({
    from: deployer,
    nonce: nonce + 3 // 0: oracle, 1: cETH, 2: cUSDC, 3: Vault
  });

  // 4. Confidential Collateral (cETH)
  const cETH = await deploy("ConfidentialCollateral", {
    from: deployer,
    args: [predictedVaultAddress],
    log: true,
  });

  // 5. Confidential Debt (cUSDC)
  const cUSDC = await deploy("ConfidentialDebt", {
    from: deployer,
    args: [predictedVaultAddress],
    log: true,
  });

  // 6. Confidential Vault
  const vaultDeploy = await deploy("ConfidentialVault", {
    from: deployer,
    args: [oracle.address, cETH.address, cUSDC.address],
    log: true,
  });

  // 7. Dutch Auction
  const auction = await deploy("DutchAuction", {
    from: deployer,
    args: [vaultDeploy.address],
    log: true,
  });

  // --- Wiring ---
  console.log("\n--- Wiring Components ---");
  const vaultContract = await hre.ethers.getContractAt("ConfidentialVault", vaultDeploy.address);
  await vaultContract.setAuctionContract(auction.address);
  
  console.log("ARGEN × ZAMA Suite deployment and wiring complete.");
};
export default func;
func.id = "deploy_fheCounter"; // id required to prevent reexecution
func.tags = ["FHECounter"];
