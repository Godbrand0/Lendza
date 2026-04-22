import { Contract, JsonRpcSigner } from "ethers";

// ---------------------------------------------------------------------------
// Contract addresses — written automatically by scripts/deploy.ts
// Set manually in frontend/.env.local if needed:
//   NEXT_PUBLIC_VAULT_ADDRESS=0x...
//   NEXT_PUBLIC_AUCTION_ADDRESS=0x...
// ---------------------------------------------------------------------------
export const VAULT_ADDRESS = process.env.NEXT_PUBLIC_VAULT_ADDRESS ?? "";
export const AUCTION_ADDRESS = process.env.NEXT_PUBLIC_AUCTION_ADDRESS ?? "";
export const CETH_ADDRESS = process.env.NEXT_PUBLIC_CETH_ADDRESS ?? "";
export const CUSDC_ADDRESS = process.env.NEXT_PUBLIC_CUSDC_ADDRESS ?? "";

// Mock USDC underlying token on Sepolia — public mint(address, uint256) up to 1M per call.
// Source: https://docs.zama.ai/protocol — Confidential USDC (Mock) underlying token
export const MOCK_USDC_ADDRESS =
  "0x9b5Cd13b8eFbB58Dc25A05CF411D8056058aDFfF" as const;

// ---------------------------------------------------------------------------
// ABIs — generated from compiled artifacts (contracts/core/*.sol)
// FHE-specific types compile to bytes32 in the ABI:
//   externalEuint64 → bytes32
//   euint64         → bytes32
//   ebool           → bytes32
// ---------------------------------------------------------------------------

export const VAULT_ABI = [
  {
    "inputs": [
      { "internalType": "address", "name": "_cETH", "type": "address" },
      { "internalType": "address", "name": "_cUSDC", "type": "address" },
      { "internalType": "address", "name": "_mockUsdc", "type": "address" }
    ],
    "stateMutability": "nonpayable",
    "type": "constructor"
  },
  { "inputs": [], "name": "ActiveDebt", "type": "error" },
  { "inputs": [], "name": "AlreadyPendingCheck", "type": "error" },
  { "inputs": [], "name": "InvalidDuration", "type": "error" },
  { "inputs": [], "name": "InvalidKMSSignatures", "type": "error" },
  { "inputs": [], "name": "InsufficientPoolLiquidity", "type": "error" },
  { "inputs": [], "name": "LoanOverdue", "type": "error" },
  { "inputs": [], "name": "NoCollateral", "type": "error" },
  { "inputs": [], "name": "NoLenderDeposit", "type": "error" },
  { "inputs": [], "name": "NoPendingCheck", "type": "error" },
  { "inputs": [], "name": "OnlyAuction", "type": "error" },
  { "inputs": [], "name": "OnlyDecryptor", "type": "error" },
  { "inputs": [], "name": "OnlyOwner", "type": "error" },
  { "inputs": [], "name": "PositionActive", "type": "error" },
  { "inputs": [{ "internalType": "bytes32", "name": "handle", "type": "bytes32" }, { "internalType": "address", "name": "sender", "type": "address" }], "name": "SenderNotAllowedToUseHandle", "type": "error" },
  { "inputs": [], "name": "ZamaProtocolUnsupported", "type": "error" },
  { "inputs": [], "name": "ExceedsAvailableBalance", "type": "error" },
  { "inputs": [], "name": "ZeroAmount", "type": "error" },
  { "inputs": [], "name": "ZeroCollateral", "type": "error" },
  {
    "anonymous": false,
    "inputs": [{ "indexed": true, "internalType": "address", "name": "account", "type": "address" }, { "indexed": true, "internalType": "address", "name": "agent", "type": "address" }],
    "name": "AgentAccessGranted",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [{ "indexed": true, "internalType": "address", "name": "borrower", "type": "address" }, { "indexed": false, "internalType": "uint256", "name": "gweiAmount", "type": "uint256" }],
    "name": "CollateralDeposited",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [{ "indexed": true, "internalType": "address", "name": "borrower", "type": "address" }, { "indexed": false, "internalType": "uint256", "name": "gweiAmount", "type": "uint256" }],
    "name": "CollateralWithdrawn",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [{ "indexed": true, "internalType": "address", "name": "borrower", "type": "address" }],
    "name": "Borrowed",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [{ "indexed": true, "internalType": "address", "name": "borrower", "type": "address" }],
    "name": "Repaid",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [{ "indexed": true, "internalType": "address", "name": "lender", "type": "address" }],
    "name": "LiquidityDeposited",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [{ "indexed": true, "internalType": "address", "name": "lender", "type": "address" }],
    "name": "LiquidityWithdrawn",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [{ "indexed": true, "internalType": "address", "name": "borrower", "type": "address" }, { "indexed": false, "internalType": "bool", "name": "isUnhealthy", "type": "bool" }],
    "name": "HealthCheckResolved",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [{ "indexed": true, "internalType": "address", "name": "borrower", "type": "address" }, { "indexed": false, "internalType": "ebool", "name": "isUnhealthy", "type": "bytes32" }],
    "name": "LiquidationCheckRequested",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [{ "indexed": true, "internalType": "address", "name": "borrower", "type": "address" }],
    "name": "LiquidationStarted",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [{ "indexed": false, "internalType": "bytes32[]", "name": "handlesList", "type": "bytes32[]" }, { "indexed": false, "internalType": "bytes", "name": "abiEncodedCleartexts", "type": "bytes" }],
    "name": "PublicDecryptionVerified",
    "type": "event"
  },
  {
    "inputs": [],
    "name": "DECRYPTION_ADDRESS",
    "outputs": [{ "internalType": "address", "name": "", "type": "address" }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "HEALTH_MULTIPLIER",
    "outputs": [{ "internalType": "uint64", "name": "", "type": "uint64" }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "LIQUIDATION_THRESHOLD",
    "outputs": [{ "internalType": "uint64", "name": "", "type": "uint64" }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "TRIGGER_FEE_BPS",
    "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "auctionContract",
    "outputs": [{ "internalType": "address", "name": "", "type": "address" }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "depositCollateral",
    "outputs": [],
    "stateMutability": "payable",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "withdrawCollateral",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [{ "internalType": "address", "name": "", "type": "address" }],
    "name": "hasCollateral",
    "outputs": [{ "internalType": "bool", "name": "", "type": "bool" }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [{ "internalType": "address", "name": "", "type": "address" }],
    "name": "isLender",
    "outputs": [{ "internalType": "bool", "name": "", "type": "bool" }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      { "internalType": "externalEuint64", "name": "encBorrowAmount", "type": "bytes32" },
      { "internalType": "bytes", "name": "inputProof", "type": "bytes" },
      { "internalType": "uint256", "name": "borrowAmountPlain", "type": "uint256" },
      { "internalType": "uint256", "name": "durationMinutes", "type": "uint256" }
    ],
    "name": "borrow",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "totalLenderDeposits",
    "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "totalInterestAccrued",
    "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "getMyTotalDue",
    "outputs": [
      { "internalType": "uint256", "name": "totalDue", "type": "uint256" },
      { "internalType": "uint256", "name": "principal", "type": "uint256" },
      { "internalType": "uint256", "name": "interest", "type": "uint256" }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "getMyLenderInfo",
    "outputs": [
      { "internalType": "uint256", "name": "deposit", "type": "uint256" },
      { "internalType": "uint256", "name": "interestShare", "type": "uint256" },
      { "internalType": "uint256", "name": "totalPayout", "type": "uint256" }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "cETH",
    "outputs": [{ "internalType": "contract ConfidentialCollateral", "name": "", "type": "address" }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "cUSDC",
    "outputs": [{ "internalType": "contract ConfidentialDebt", "name": "", "type": "address" }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [{ "internalType": "address", "name": "", "type": "address" }],
    "name": "collateralGwei",
    "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "confidentialProtocolId",
    "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      { "internalType": "externalEuint64", "name": "encAmount", "type": "bytes32" },
      { "internalType": "bytes", "name": "inputProof", "type": "bytes" },
      { "internalType": "uint256", "name": "amountPlain", "type": "uint256" }
    ],
    "name": "depositLiquidity",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [{ "internalType": "uint256", "name": "amount", "type": "uint256" }],
    "name": "withdrawLiquidity",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "getActivePositions",
    "outputs": [{ "internalType": "address[]", "name": "", "type": "address[]" }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [{ "internalType": "address", "name": "borrower", "type": "address" }],
    "name": "getPositionHandles",
    "outputs": [{ "internalType": "euint64", "name": "encCollateral", "type": "bytes32" }, { "internalType": "euint64", "name": "encDebt", "type": "bytes32" }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "getProtocolStats",
    "outputs": [
      { "internalType": "uint256", "name": "totalCollateral", "type": "uint256" },
      { "internalType": "uint256", "name": "activeBorrowers", "type": "uint256" },
      { "internalType": "uint256", "name": "totalLenders", "type": "uint256" }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [{ "internalType": "address", "name": "account", "type": "address" }],
    "name": "getLenderBalanceHandle",
    "outputs": [{ "internalType": "euint64", "name": "", "type": "bytes32" }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "totalCollateralGwei",
    "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [{ "internalType": "address", "name": "borrower", "type": "address" }],
    "name": "getLoanInfo",
    "outputs": [
      { "internalType": "uint256", "name": "startTime", "type": "uint256" },
      { "internalType": "uint256", "name": "termSeconds", "type": "uint256" },
      { "internalType": "uint256", "name": "dueTime", "type": "uint256" },
      { "internalType": "bool", "name": "isOverdue", "type": "bool" },
      { "internalType": "bool", "name": "isActive", "type": "bool" }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [{ "internalType": "address", "name": "", "type": "address" }],
    "name": "loanStartTime",
    "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [{ "internalType": "address", "name": "", "type": "address" }],
    "name": "loanTermSeconds",
    "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [{ "internalType": "address", "name": "account", "type": "address" }, { "internalType": "address", "name": "agent", "type": "address" }],
    "name": "grantAgentAccess",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "protocolEthEarnings",
    "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "owner",
    "outputs": [{ "internalType": "address", "name": "", "type": "address" }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "repay",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [{ "internalType": "address", "name": "borrower", "type": "address" }],
    "name": "requestLiquidationCheck",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [{ "internalType": "address", "name": "borrower", "type": "address" }, { "internalType": "bytes", "name": "abiEncodedClearResult", "type": "bytes" }, { "internalType": "bytes", "name": "decryptionProof", "type": "bytes" }],
    "name": "resolveHealthCheck",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [{ "internalType": "address", "name": "_auction", "type": "address" }],
    "name": "setAuctionContract",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [{ "internalType": "address", "name": "borrower", "type": "address" }, { "internalType": "address", "name": "bidder", "type": "address" }, { "internalType": "uint256", "name": "ethPaid", "type": "uint256" }],
    "name": "settleLiquidation",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  { "stateMutability": "payable", "type": "receive" }
] as const;

export const AUCTION_ABI = [
  {
    "inputs": [{ "internalType": "address", "name": "_vault", "type": "address" }],
    "stateMutability": "nonpayable",
    "type": "constructor"
  },
  { "inputs": [], "name": "AuctionAlreadySettled", "type": "error" },
  { "inputs": [], "name": "AuctionExpired", "type": "error" },
  { "inputs": [], "name": "AuctionNotActive", "type": "error" },
  { "inputs": [], "name": "AuctionNotExpired", "type": "error" },
  { "inputs": [], "name": "BidAlreadySubmitted", "type": "error" },
  { "inputs": [], "name": "ETHTransferFailed", "type": "error" },
  { "inputs": [{ "internalType": "uint256", "name": "required", "type": "uint256" }, { "internalType": "uint256", "name": "provided", "type": "uint256" }], "name": "InsufficientDeposit", "type": "error" },
  { "inputs": [], "name": "InvalidKMSSignatures", "type": "error" },
  { "inputs": [], "name": "NoBidFound", "type": "error" },
  { "inputs": [], "name": "NoResolutionPending", "type": "error" },
  { "inputs": [], "name": "OnlyDecryptor", "type": "error" },
  { "inputs": [], "name": "OnlyVault", "type": "error" },
  { "inputs": [], "name": "ResolutionAlreadyPending", "type": "error" },
  { "inputs": [{ "internalType": "bytes32", "name": "handle", "type": "bytes32" }, { "internalType": "address", "name": "sender", "type": "address" }], "name": "SenderNotAllowedToUseHandle", "type": "error" },
  { "inputs": [], "name": "ZamaProtocolUnsupported", "type": "error" },
  {
    "anonymous": false,
    "inputs": [{ "indexed": true, "internalType": "uint256", "name": "auctionId", "type": "uint256" }, { "indexed": true, "internalType": "address", "name": "winner", "type": "address" }, { "indexed": false, "internalType": "uint256", "name": "pricePaid", "type": "uint256" }],
    "name": "AuctionSettled",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [{ "indexed": true, "internalType": "uint256", "name": "auctionId", "type": "uint256" }, { "indexed": true, "internalType": "address", "name": "borrower", "type": "address" }, { "indexed": false, "internalType": "uint256", "name": "startPrice", "type": "uint256" }],
    "name": "AuctionStarted",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [{ "indexed": true, "internalType": "uint256", "name": "auctionId", "type": "uint256" }, { "indexed": true, "internalType": "address", "name": "bidder", "type": "address" }],
    "name": "BidRefunded",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [{ "indexed": true, "internalType": "uint256", "name": "auctionId", "type": "uint256" }, { "indexed": true, "internalType": "address", "name": "bidder", "type": "address" }, { "indexed": false, "internalType": "ebool", "name": "validHandle", "type": "bytes32" }],
    "name": "BidResolutionRequested",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [{ "indexed": true, "internalType": "uint256", "name": "auctionId", "type": "uint256" }, { "indexed": true, "internalType": "address", "name": "bidder", "type": "address" }],
    "name": "BidSubmitted",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [{ "indexed": false, "internalType": "bytes32[]", "name": "handlesList", "type": "bytes32[]" }, { "indexed": false, "internalType": "bytes", "name": "abiEncodedCleartexts", "type": "bytes" }],
    "name": "PublicDecryptionVerified",
    "type": "event"
  },
  {
    "inputs": [],
    "name": "AUCTION_DURATION",
    "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "DECRYPTION_ADDRESS",
    "outputs": [{ "internalType": "address", "name": "", "type": "address" }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "FLOOR_BPS",
    "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }],
    "name": "auctions",
    "outputs": [{ "internalType": "address", "name": "borrower", "type": "address" }, { "internalType": "uint256", "name": "startPrice", "type": "uint256" }, { "internalType": "uint256", "name": "floorPrice", "type": "uint256" }, { "internalType": "uint256", "name": "startTime", "type": "uint256" }, { "internalType": "bool", "name": "settled", "type": "bool" }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [{ "internalType": "uint256", "name": "auctionId", "type": "uint256" }],
    "name": "cancelExpiredAuction",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "confidentialProtocolId",
    "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "getActiveAuctions",
    "outputs": [{ "internalType": "uint256[]", "name": "", "type": "uint256[]" }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [{ "internalType": "uint256", "name": "auctionId", "type": "uint256" }],
    "name": "getCurrentPrice",
    "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [{ "internalType": "uint256", "name": "auctionId", "type": "uint256" }, { "internalType": "address", "name": "bidder", "type": "address" }],
    "name": "requestBidResolution",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [{ "internalType": "uint256", "name": "auctionId", "type": "uint256" }, { "internalType": "address", "name": "bidder", "type": "address" }, { "internalType": "bytes", "name": "abiEncodedClearResult", "type": "bytes" }, { "internalType": "bytes", "name": "decryptionProof", "type": "bytes" }],
    "name": "resolveBid",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [{ "internalType": "address", "name": "borrower", "type": "address" }, { "internalType": "uint256", "name": "collateralGwei", "type": "uint256" }],
    "name": "startAuction",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [{ "internalType": "uint256", "name": "auctionId", "type": "uint256" }, { "internalType": "externalEuint64", "name": "encMaxBid", "type": "bytes32" }, { "internalType": "bytes", "name": "inputProof", "type": "bytes" }],
    "name": "submitBid",
    "outputs": [],
    "stateMutability": "payable",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "vault",
    "outputs": [{ "internalType": "address", "name": "", "type": "address" }],
    "stateMutability": "view",
    "type": "function"
  },
  { "stateMutability": "payable", "type": "receive" }
] as const;

// Minimal ABI for cETH and cUSDC — only what's needed for re-encryption handles.
export const TOKEN_ABI = [
  {
    "inputs": [{ "internalType": "address", "name": "account", "type": "address" }],
    "name": "confidentialBalanceOf",
    "outputs": [{ "internalType": "euint64", "name": "", "type": "bytes32" }],
    "stateMutability": "view",
    "type": "function"
  }
] as const;

// ---------------------------------------------------------------------------
// Contract factory helpers
// ---------------------------------------------------------------------------

// Minimal ERC-20 ABI for mock USDC interactions (approve + balanceOf).
export const MOCK_USDC_ABI = [
  {
    "inputs": [{ "internalType": "address", "name": "spender", "type": "address" }, { "internalType": "uint256", "name": "amount", "type": "uint256" }],
    "name": "approve",
    "outputs": [{ "internalType": "bool", "name": "", "type": "bool" }],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [{ "internalType": "address", "name": "account", "type": "address" }],
    "name": "balanceOf",
    "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [{ "internalType": "address", "name": "to", "type": "address" }, { "internalType": "uint256", "name": "amount", "type": "uint256" }],
    "name": "mint",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  }
] as const;

export function vaultContract(signer: JsonRpcSigner) {
  return new Contract(VAULT_ADDRESS, VAULT_ABI, signer);
}

export function auctionContract(signer: JsonRpcSigner) {
  return new Contract(AUCTION_ADDRESS, AUCTION_ABI, signer);
}

export function mockUsdcContract(signer: JsonRpcSigner) {
  return new Contract(MOCK_USDC_ADDRESS, MOCK_USDC_ABI, signer);
}
