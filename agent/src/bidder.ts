import { ethers } from "ethers";
import * as dotenv from "dotenv";
import { getFhevmInstance } from "./fhe";

dotenv.config();

const AUCTION_ADDRESS = process.env.AUCTION_ADDRESS || "";
const VAULT_ADDRESS = process.env.VAULT_ADDRESS || "";
const RPC_URL = process.env.RPC_URL || "http://localhost:8545";
const PRIVATE_KEY = process.env.BIDDER_PRIVATE_KEY || "";

const AUCTION_ABI = [
  "function submitBid(uint256 auctionId, bytes32 encryptedMaxBid, bytes inputProof) external",
  "event AuctionStarted(uint256 indexed auctionId, address indexed borrower, uint256 startTime)",
  "function getAuctionPrice(uint256 auctionId) external view returns (uint256)"
];

async function main() {
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
  const auction = new ethers.Contract(AUCTION_ADDRESS, AUCTION_ABI, wallet);
  
  const fhevm = await getFhevmInstance(provider);

  console.log(`[Bidder] Starting autonomous buyer at ${AUCTION_ADDRESS}...`);

  // Listen for new auctions
  auction.on("AuctionStarted", async (auctionId, borrower, startTime) => {
    console.log(`[Bidder] NEW AUCTION DETECTED: #${auctionId} for borrower ${borrower}`);

    // LOGIC: 
    // 1. Check if we want to buy it.
    // In a real scenario, we'd call the x402 server here:
    // await axios.post(SERVER_URL + "/v1/alpha", { agentAddress: wallet.address, ... });

    // 2. Prepare an encrypted bid (e.g., $2500 max bid)
    console.log(`[Bidder] Preparing encrypted bid for auction #${auctionId}...`);
    
    const clearBid = 2500; // Plan to pay up to $2500
    const encryptedInput = await fhevm
      .createEncryptedInput(AUCTION_ADDRESS, wallet.address)
      .add64(clearBid)
      .encrypt();

    // 3. Submit Bid
    try {
      const tx = await auction.submitBid(
        auctionId,
        encryptedInput.handles[0],
        encryptedInput.inputProof
      );
      await tx.wait();
      console.log(`[Bidder] Bid submitted successfully for auction #${auctionId}`);
    } catch (error) {
      console.error(`[Bidder] Bid failed for auction #${auctionId}:`, error);
    }
  });
}

main().catch(console.error);
