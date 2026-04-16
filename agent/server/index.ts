import express from "express";
import cors from "cors";
import { ethers } from "ethers";
import * as dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.SERVER_PORT || 3001;
const VAULT_ADDRESS = process.env.VAULT_ADDRESS || "";
const RPC_URL = process.env.RPC_URL || "http://localhost:8545";
const PRIVATE_KEY = process.env.ADMIN_PRIVATE_KEY || ""; // Wallet authorized to call grantAgentAccess
const PROTOCOL_PAYMENT_ADDRESS = process.env.PROTOCOL_PAYMENT_ADDRESS || "";
const ALPHA_PRICE = ethers.parseEther("0.01"); // Price to reveal alpha (in ETH for simplicity)

const VAULT_ABI = [
  "function grantAgentAccess(address account, address agent) external",
  "function getPositionEncryptedData(uint256 positionId) external view returns (bytes, bytes)", // Logic to fetch handles
  "function positions(uint256) external view returns (address borrower, uint256 collateral, uint256 debt)"
];

const provider = new ethers.JsonRpcProvider(RPC_URL);
const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
const vault = new ethers.Contract(VAULT_ADDRESS, VAULT_ABI, wallet);

/**
 * @api {post} /v1/alpha Buy Liquidation Alpha
 * @description Verifies a payment txHash and grants FHE read access to the requester.
 */
app.post("/v1/alpha", async (req, res) => {
  const { txHash, positionId, agentAddress } = req.body;

  if (!txHash || !positionId || !agentAddress) {
    return res.status(402).json({ error: "Payment required. Missing txHash or metadata." });
  }

  try {
    // 1. Verify Payment on-chain
    console.log(`[Server] Verifying payment for agent ${agentAddress}...`);
    const tx = await provider.getTransaction(txHash);
    
    if (!tx || tx.to?.toLowerCase() !== PROTOCOL_PAYMENT_ADDRESS.toLowerCase() || tx.value < ALPHA_PRICE) {
      return res.status(402).json({ error: "Invalid payment or insufficient amount." });
    }

    // 2. Grant Access in ConfidentialVault
    console.log(`[Server] Payment verified. Granting FHE access to position #${positionId}...`);
    
    // Fetch borrower for the position
    const pos = await vault.positions(positionId);
    const borrower = pos.borrower;

    const grantTx = await vault.grantAgentAccess(borrower, agentAddress);
    await grantTx.wait();

    // 3. Return Alpha (Encrypted Handles)
    // In actual FHEVM, the agent can now call viewing functions because they are granted.
    res.json({
      success: true,
      message: "Access granted. You may now call re-encryption functions on the Vault.",
      positionId: positionId
    });

  } catch (error) {
    console.error("[Server] Error:", error);
    res.status(500).json({ error: "Internal server error." });
  }
});

app.listen(PORT, () => {
  console.log(`[Server] x402 Facilitator running at http://localhost:${PORT}`);
});
