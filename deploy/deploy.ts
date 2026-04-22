import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();
  const { deploy } = hre.deployments;

  console.log("\n--- Deploying ARGEN × ZAMA Core Contracts ---");
  console.log("Deployer:", deployer);

  const wallet = await hre.ethers.getSigner(deployer);
  const nonce = await wallet.getNonce();

  // Predict vault address to break the circular dependency:
  // nonce+0 = cETH, nonce+1 = cUSDC, nonce+2 = Vault
  const predictedVaultAddress = hre.ethers.getContractAddress({
    from: deployer,
    nonce: nonce + 2,
  });
  console.log("Predicted Vault address:", predictedVaultAddress);

  // 1. Confidential Collateral (cETH)
  const cETH = await deploy("ConfidentialCollateral", {
    from: deployer,
    args: [predictedVaultAddress],
    log: true,
  });

  // 2. Confidential Debt (cUSDC)
  const cUSDC = await deploy("ConfidentialDebt", {
    from: deployer,
    args: [predictedVaultAddress],
    log: true,
  });

  // 3. Confidential Vault
  const vault = await deploy("ConfidentialVault", {
    from: deployer,
    args: [cETH.address, cUSDC.address],
    log: true,
  });

  console.log("\n--- Deployment complete ---");
  console.log("cETH:  ", cETH.address);
  console.log("cUSDC: ", cUSDC.address);
  console.log("Vault: ", vault.address);
};

export default func;
func.id = "deploy_argen_zama_core";
func.tags = ["ArgenZama"];
