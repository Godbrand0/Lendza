import { ethers } from "ethers";
import { config, monitorWallet, bidderWallet } from "./config";

export const VAULT_ABI = [
  "function requestLiquidationCheck(address account) external",
  "function getActivePositions() external view returns (address[])",
  "function setAuctionContract(address _auction) external",
  "function grantAgentAccess(address agent, address position) external",
  "event HealthCheckResolved(address indexed account, bool isUnhealthy)",
  "event PositionUnhealthy(address indexed account)"
];

export const AUCTION_ABI = [
  "function submitBid(uint256 auctionId, bytes encryptedAmount) external",
  "function getActiveAuctions() external view returns (uint256[])",
  "function getCurrentPrice(uint256 auctionId) external view returns (uint256)",
  "event AuctionStarted(uint256 indexed auctionId, address indexed account)",
  "event AuctionSettled(uint256 indexed auctionId, address indexed winner, uint256 amount)"
];

export const vault = new ethers.Contract(config.vaultAddress, VAULT_ABI, monitorWallet);
export const bidderVault = new ethers.Contract(config.vaultAddress, VAULT_ABI, bidderWallet); // For grants
export const auction = new ethers.Contract(config.auctionAddress, AUCTION_ABI, bidderWallet);
