import dotenv from "dotenv";
import { ethers } from "ethers";

dotenv.config();

export const config = {
  rpcUrl: process.env.RPC_URL || "http://localhost:8545",
  
  // Addresses
  vaultAddress: process.env.VAULT_ADDRESS || "",
  auctionAddress: process.env.AUCTION_ADDRESS || "",
  paymentAddress: process.env.PROTOCOL_PAYMENT_ADDRESS || "",

  // Private Keys
  monitorKey: process.env.MONITOR_PRIVATE_KEY || "",
  bidderKey: process.env.BIDDER_PRIVATE_KEY || "",
  adminKey: process.env.ADMIN_PRIVATE_KEY || "",

  // Server
  port: parseInt(process.env.SERVER_PORT || "3001"),
};

export const provider = new ethers.JsonRpcProvider(config.rpcUrl);
export const monitorWallet = new ethers.Wallet(config.monitorKey, provider);
export const bidderWallet = new ethers.Wallet(config.bidderKey, provider);
export const adminWallet = new ethers.Wallet(config.adminKey, provider);
