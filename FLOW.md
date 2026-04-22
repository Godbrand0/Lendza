# ARGEN × ZAMA — Application Flow

A confidential DeFi lending protocol on Sepolia, powered by Zama's FHE coprocessor. All individual deposit and borrow amounts are encrypted end-to-end using Fully Homomorphic Encryption (FHE). Only aggregate plaintext stats (total ETH locked, borrower/lender counts) are readable on-chain without user consent.

---

## Token Architecture

There are two types of "USDC" and "ETH" in this system — real assets and encrypted receipt tokens. They are not the same thing.

### Real Assets
- **Sepolia ETH** — sent as `msg.value` when a borrower calls `depositCollateral()`. Held in the vault contract.
- **Zama USDC** (`0x1c7D4B196...`) — Circle's Sepolia USDC. Lenders supply this to the pool via `depositLiquidity()`. Borrowers receive this when they call `borrow()`.

### Encrypted Receipt / Debt Tokens
- **cETH (ConfidentialCollateral)** — an FHE-encrypted receipt token minted to a borrower when they deposit ETH collateral. It tracks how much ETH each borrower has locked, but the amount is encrypted on-chain. This is what makes collateral amounts private.
- **cUSDC (ConfidentialDebt)** — an FHE-encrypted debt token minted to a borrower when they take out a loan. When the frontend calls `decryptDebt()`, it reads `cUSDC.confidentialBalanceOf(account)` via the Zama re-encryption flow to reveal the borrowed amount only to the borrower.

Both are deeply wired into the vault — `depositCollateral`, `borrow`, `repay`, and liquidation all mint/burn them. They cannot be removed without gutting the FHE privacy model.

```
Real ETH (collateral)  →  vault holds it  →  mints cETH  (encrypted receipt)
Zama USDC (lender pool) →  vault holds it  →  mints cUSDC (encrypted debt to borrower)
```

---

## Contract Architecture

```
ConfidentialCollateral (cETH)
         ↕  mint / burn
ConfidentialVault  ←→  ConfidentialDebt (cUSDC)
         ↕
   (holds ETH + USDC)
```

The vault is the only contract that can mint or burn cETH/cUSDC. Both token contracts are deployed with the vault's predicted address as their sole authorized minter, resolving the circular constructor dependency via nonce prediction.

---

## Lender Flow

1. **Connect wallet** — Wallet must be connected and FHEVM coprocessor must be ready (WASM loaded).
2. **Supply USDC** — Lender enters an amount on the Lend page. The amount is FHE-encrypted in the browser using `instance.createEncryptedInput()` before being sent on-chain.
3. **`depositLiquidity(encAmount, inputProof)`** — Vault stores the encrypted balance in `_lenderBalance[msg.sender]` (a private `euint64`). The lender is registered in `_lenderAddresses[]` and `isLender[msg.sender]` is set to `true`.
4. **Reveal balance** — The lender clicks "Reveal" to trigger the Zama re-encryption flow:
   - Browser generates a throwaway keypair
   - Signs an EIP-712 authorisation with their wallet
   - Zama KMS re-encrypts the ciphertext under the throwaway public key
   - Browser decrypts locally and displays the plaintext balance

---

## Borrower Flow

### Step 1 — Deposit Collateral

1. **Connect wallet** — ETH required in wallet.
2. **Deposit ETH** — Borrower sends ETH via `depositCollateral()` (payable).
   - `collateralGwei[msg.sender] += gweiDeposited` (plaintext, additive — can top up)
   - `hasCollateral[msg.sender] = true`
   - `totalCollateralGwei += gweiDeposited`
   - cETH minted to borrower (encrypted amount)
3. **Top-up** — Borrower can call `depositCollateral()` again at any time to add more collateral. The balance is additive.

### Step 2 — Borrow USDC

4. **Select amount** — Frontend enforces a 66% LTV cap:
   ```
   maxBorrowUsdc = collateralEth × $3,000 × 0.66
   ```
   Borrower picks 25 / 50 / 75 / 100% of max, or types a custom amount.
5. **Select duration** — Loan term in minutes (5 / 10 / 30 / 60 min for demo). Interest rate: 1% per minute.
6. **`borrow(encAmount, inputProof, durationMinutes)`** — Vault:
   - Verifies `hasCollateral[msg.sender]`
   - Sets `loanStartTime` and `loanTermSeconds`
   - Mints cUSDC debt token to borrower (encrypted)
   - Transfers USDC from pool to borrower's wallet
7. **Active loan** — Borrow page shows a countdown timer. Loan summary shows principal, interest due, and total repayment.

### Step 3 — Repay

8. **`repay(encAmount, inputProof)`** — Burns cUSDC debt, releases ETH collateral (withdrawable after repay).
9. **Reveal debt** — At any point the borrower can click "Reveal Debt" to decrypt their outstanding cUSDC balance via the Zama re-encryption flow.

---

## FHE Re-encryption Flow (Reveal Buttons)

Used on the Lend page (lender balance), Borrow page (debt), and Profile page.

```
1. instance.generateKeypair()
      → { publicKey, privateKey }  (BytesHexNo0x — no 0x prefix)

2. instance.createEIP712(0x+publicKey, [contractAddress], timestamp, durationDays)
      → eip712 object with domain, types, message
      NOTE: strip EIP712Domain from types before calling signTypedData
            (Ethers v6 throws if EIP712Domain is present)

3. signer.signTypedData(domain, typesWithoutEIP712Domain, message)
      → signature

4. instance.userDecrypt([{ handle, contractAddress }], privateKey, 0x+publicKey,
                         signature, [contractAddress], account, timestamp, durationDays)
      → { handleHex: plaintextBigInt }

5. Display plaintext / 1e6  (USDC has 6 decimals)
```

---

## Dashboard Stats

Only plaintext aggregates are surfaced publicly:

| Stat | Source |
|------|--------|
| Total ETH collateral | `totalCollateralGwei` (public) |
| Active borrowers | `_activePositions.length` via `getProtocolStats()` |
| Total lenders | `_lenderAddresses.length` via `getProtocolStats()` |
| Total USDC deposited / borrowed | Hidden — FHE encrypted, not summable on-chain |

---

## Deployed Contracts (Sepolia)

| Contract | Address |
|----------|---------|
| ConfidentialVault | `0x7c1cCbC898b3140874F019bDBbA344B624334Df0` |
| ConfidentialCollateral (cETH) | `0x37e6e74d746DfA059C0713b514187266Dc316F44` |
| ConfidentialDebt (cUSDC) | `0xDdf3EF88095e216FE22d4ac4EA6B45B56424D8dA` |
| Zama USDC | `0x9b5Cd13b8eFbB58Dc25A05CF411D8056058aDFfF` |

---

## Why Three Deployments?

The deploy script only needs **3 transactions**:

1. Deploy `ConfidentialCollateral` (cETH) — constructor takes predicted vault address
2. Deploy `ConfidentialDebt` (cUSDC) — constructor takes predicted vault address
3. Deploy `ConfidentialVault` — constructor takes cETH and cUSDC addresses

The vault address is predicted before deployment using nonce arithmetic (`ethers.getCreateAddress({ from, nonce: currentNonce + 2 })`), breaking the circular dependency without any proxy patterns.

Oracle and auction contracts are not deployed — ETH price is hardcoded at `$3,000` in the vault constant `ETH_PRICE_USD`, and liquidation is disabled for the demo.
