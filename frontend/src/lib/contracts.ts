import { Contract, JsonRpcSigner } from "ethers";

// ---------------------------------------------------------------------------
// Contract addresses — set via environment variables.
// In development, add these to frontend/.env.local:
//   NEXT_PUBLIC_VAULT_ADDRESS=0x...
// ---------------------------------------------------------------------------
export const VAULT_ADDRESS =
  process.env.NEXT_PUBLIC_VAULT_ADDRESS ?? "";

// ---------------------------------------------------------------------------
// Minimal ABIs — only the functions the frontend actually calls.
// externalEuint64 compiles to bytes32 in the ABI.
// ---------------------------------------------------------------------------

export const VAULT_ABI = [
  // Borrower: open position (payable — sends ETH collateral)
  "function borrow(bytes32 encBorrowAmount, bytes calldata inputProof) external payable",

  // Borrower: close position
  "function repay(bytes32 encRepayAmount, bytes calldata inputProof) external",

  // Lender: supply USDC liquidity
  "function depositLiquidity(bytes32 encAmount, bytes calldata inputProof) external",

  // Views
  "function getActivePositions() external view returns (address[])",
  "function collateralGwei(address) external view returns (uint256)",
] as const;

export function vaultContract(signer: JsonRpcSigner) {
  return new Contract(VAULT_ADDRESS, VAULT_ABI, signer);
}
