/**
 * verify.ts — On-chain payment verification
 *
 * Checks that a given tx hash represents a confirmed USDC transfer
 * to the server's payment address for at least the required fee amount.
 */

import { ethers } from "ethers";

const ERC20_TRANSFER_TOPIC = ethers.id("Transfer(address,address,uint256)");

export interface VerifyResult {
  ok: boolean;
  reason?: string;
  from?: string;
  amount?: bigint;
}

/**
 * Verify that `txHash` is a confirmed token transfer where:
 *  - token contract == expectedToken
 *  - recipient == expectedPayTo
 *  - amount >= expectedAmount
 */
export async function verifyPayment(
  provider: ethers.JsonRpcProvider,
  txHash: string,
  expectedToken: string,
  expectedPayTo: string,
  expectedAmount: bigint
): Promise<VerifyResult> {
  // 1. Fetch receipt — null means tx not yet mined
  const receipt = await provider.getTransactionReceipt(txHash);
  if (!receipt) {
    return { ok: false, reason: "Transaction not yet mined. Try again shortly." };
  }

  if (receipt.status !== 1) {
    return { ok: false, reason: "Transaction reverted on-chain." };
  }

  // 2. Scan logs for a matching ERC-20 Transfer event
  const tokenAddr = expectedToken.toLowerCase();
  const payToAddr = expectedPayTo.toLowerCase();

  for (const log of receipt.logs) {
    // Must come from the expected token contract
    if (log.address.toLowerCase() !== tokenAddr) continue;

    // Must be a Transfer event
    if (log.topics[0] !== ERC20_TRANSFER_TOPIC) continue;

    // topics[2] = to address (zero-padded)
    if (log.topics.length < 3) continue;
    const to = "0x" + log.topics[2].slice(26); // strip 12 bytes of padding
    if (to.toLowerCase() !== payToAddr) continue;

    // Decode amount from data
    const amount = BigInt(log.data);
    if (amount < expectedAmount) {
      return {
        ok: false,
        reason: `Insufficient payment: sent ${amount}, required ${expectedAmount}.`,
      };
    }

    // Decode sender from topics[1]
    const from = "0x" + log.topics[1].slice(26);
    return { ok: true, from, amount };
  }

  return {
    ok: false,
    reason: "No matching USDC transfer found in transaction logs.",
  };
}
