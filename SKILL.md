# SKILL: Zama FHEVM — Confidential Smart Contracts

> Production-ready AI agent skill for writing, testing, and deploying confidential smart contracts
> on the Zama Protocol using Fully Homomorphic Encryption (FHEVM).
>
> Covers: encrypted types · FHE operations · access control · input proofs ·
>         decryption patterns · frontend integration · testing · anti-patterns

---

## 1. What Is FHEVM?

FHEVM (Fully Homomorphic Encryption VM) lets Solidity contracts perform arithmetic and logic on
**encrypted state** without ever decrypting it on-chain. Computations happen inside a ZK coprocessor.
Results stay encrypted until an authorised party requests decryption through the Zama Gateway.

**Key insight for AI agents:** FHEVM is NOT zero-knowledge proofs. There is no Circom, no
SnarkJS, no proof generation client-side. The contract calls `FHE.*` functions just like normal
Solidity. The coprocessor does the heavy lifting off-chain and posts results back.

---

## 2. Package Setup

```bash
npm install @fhevm/solidity @fhevm/hardhat-plugin @fhevm/mock-utils
```

`hardhat.config.ts` must import the plugin:

```typescript
import "@fhevm/hardhat-plugin";
```

---

## 3. Contract Configuration — The One Rule

**Every contract that touches encrypted state MUST inherit from `ZamaEthereumConfig`.**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {FHE, euint64, externalEuint64} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";

contract MyContract is ZamaEthereumConfig {
    // constructor calls FHE.setCoprocessor() automatically — no manual setup needed
}
```

`ZamaEthereumConfig` configures the ACL, FHEVMExecutor, KMSVerifier, and InputVerifier
addresses for Sepolia. For local Hardhat tests the plugin handles this automatically.

---

## 4. Encrypted Types

| Solidity type | Meaning | Max value |
|---|---|---|
| `ebool` | Encrypted boolean | — |
| `euint8` | Encrypted uint8 | 255 |
| `euint16` | Encrypted uint16 | 65,535 |
| `euint32` | Encrypted uint32 | ~4.3 × 10⁹ |
| `euint64` | Encrypted uint64 | ~1.8 × 10¹⁹ |
| `euint128` | Encrypted uint128 | ~3.4 × 10³⁸ |
| `euint256` | Encrypted uint256 | 2²⁵⁶ − 1 |
| `eaddress` | Encrypted address | — |

**External input types** (used in function parameters to receive encrypted values from clients):

| Type | Use |
|---|---|
| `externalEuint64` | Encrypted uint64 sent from browser via fhevmjs |
| `externalEuint32` | Encrypted uint32 |
| *(same pattern for all sizes)* | |

---

## 5. Receiving Encrypted Inputs

The user encrypts a value in the browser with `fhevmjs`. The contract receives two arguments:
the ciphertext (`externalEuintX`) and a validity proof (`bytes`).

```solidity
import {FHE, euint64, externalEuint64} from "@fhevm/solidity/lib/FHE.sol";

function deposit(externalEuint64 encAmount, bytes calldata inputProof) external {
    // Validate ciphertext + proof, return a usable euint64 handle.
    euint64 amount = FHE.fromExternal(encAmount, inputProof);

    // `amount` is now owned by this contract and can be used in FHE ops.
    _balances[msg.sender] = FHE.add(_balances[msg.sender], amount);
    FHE.allowThis(_balances[msg.sender]);
    FHE.allow(_balances[msg.sender], msg.sender);
}
```

**Never** pass a raw `externalEuintX` directly into FHE operations — always call
`FHE.fromExternal()` first to validate the proof.

---

## 6. FHE Operations

### Arithmetic (euint64 examples — same API for other sizes)

```solidity
euint64 sum  = FHE.add(a, b);
euint64 diff = FHE.sub(a, b);   // wraps on underflow — add range checks in production
euint64 prod = FHE.mul(a, b);
```

### Comparison — returns `ebool`

```solidity
ebool lt  = FHE.lt(a, b);   // a < b
ebool le  = FHE.le(a, b);   // a ≤ b
ebool gt  = FHE.gt(a, b);   // a > b
ebool ge  = FHE.ge(a, b);   // a ≥ b
ebool eq  = FHE.eq(a, b);   // a == b
ebool neq = FHE.ne(a, b);   // a != b
```

### Conditional select — branching without revealing the condition

```solidity
// Returns `trueVal` if `condition` is encrypted-true, else `falseVal`.
// This is how you implement if/else over encrypted state.
euint64 result = FHE.select(condition, trueVal, falseVal);
```

### Trivial encryption — wrap a public constant into an encrypted type

```solidity
euint64 zero    = FHE.asEuint64(0);
euint64 hundred = FHE.asEuint64(100);
eaddress enc    = FHE.asEaddress(msg.sender);
```

### Type checking

```solidity
bool initialised = FHE.isInitialized(someHandle);  // false for zero-value handles
```

### Handle → bytes32 (needed for decryption)

```solidity
bytes32 handleBytes = FHE.toBytes32(someHandle);  // works for any encrypted type
```

---

## 7. Access Control (ACL)

Encrypted handles are **useless without an explicit allow grant**. A contract that creates a
handle must grant access to every address (or contract) that will ever read or compute with it.

### Persistent grants

```solidity
FHE.allowThis(handle);          // this contract retains access
FHE.allow(handle, userAddress); // user can reencrypt to view
FHE.allow(handle, otherContract); // another contract can use in FHE ops
```

### Transient grant — one-transaction permission to another contract

```solidity
// Before calling another contract's function that receives an encrypted handle:
FHE.allowTransient(handle, address(otherContract));
otherContract.doSomethingWith(handle);
// Grant expires at end of transaction — does NOT persist.
```

### Pattern: after every FHE computation, refresh access

```solidity
// Always call these after writing to a stored handle:
FHE.allowThis(result);
FHE.allow(result, ownerAddress);
FHE.allow(result, vaultAddress); // any contract that needs to read it later
```

---

## 8. Decryption Patterns

FHEVM decryption is **asynchronous**. The Zama relayer decrypts and calls back your contract.

### Step 1 — mark handle for public decryption and store it

```solidity
ebool isUnhealthy = FHE.lt(collateralValue, debtThreshold);
_pendingCheck[user] = isUnhealthy;
FHE.allowThis(isUnhealthy);
FHE.makePubliclyDecryptable(isUnhealthy); // signals the Zama relayer
emit CheckRequested(user, isUnhealthy);  // relayer watches for this event
```

### Step 2 — relayer calls back with result + proof

```solidity
function resolveCheck(
    address user,
    bytes calldata abiEncodedClearResult,
    bytes calldata decryptionProof
) external {
    ebool pending = _pendingCheck[user];
    require(FHE.isInitialized(pending), "No pending check");

    // Verify the KMS signature over the decrypted result.
    bytes32[] memory cts = new bytes32[](1);
    cts[0] = FHE.toBytes32(pending);
    FHE.checkSignatures(cts, abiEncodedClearResult, decryptionProof);

    bool result = abi.decode(abiEncodedClearResult, (bool));
    delete _pendingCheck[user];

    if (result) { _handleUnhealthy(user); }
}
```

### Decoding multiple values

```solidity
// If you decrypted (euint64, ebool) together:
(uint64 amount, bool flag) = abi.decode(abiEncodedClearResult, (uint64, bool));
```

---

## 9. Cross-Contract Encrypted Transfers

When Contract A creates an encrypted handle and needs to pass it to Contract B:

```solidity
// Contract A (e.g. Vault):
euint64 handle = FHE.fromExternal(encInput, proof); // A owns handle
FHE.allowTransient(handle, address(tokenContract)); // temporary permission
tokenContract.mint(recipient, handle);              // B can now use it

// Contract B (e.g. Token):
function mint(address to, euint64 amount) external onlyVault {
    // amount is accessible here because of allowTransient above
    _balances[to] = FHE.isInitialized(_balances[to])
        ? FHE.add(_balances[to], amount)
        : amount;
    FHE.allowThis(_balances[to]);
    FHE.allow(_balances[to], to);
}
```

---

## 10. Health Factor Pattern (Lending Protocols)

For a 150% collateralization ratio with `euint64`:

```
unhealthy = (collateral_gwei × price_int × 100) < (debt_usdc × 150_000)
```

Where:
- `collateral_gwei` = ETH collateral in gwei (divide ETH amount by 1e9)
- `price_int` = Chainlink 8-decimal price divided by 1e8 (integer USD, e.g. 3000)
- `debt_usdc` = USDC debt in 6-decimal units

**Why this scaling avoids overflow** (euint64 max ≈ 1.8 × 10¹⁹):
- LHS max: 1.8 × 10¹⁰ gwei × 100,000 USD × 100 = 1.8 × 10¹⁷ ✓
- RHS max: 1.2 × 10¹³ USDC units × 150,000 = 1.8 × 10¹⁸ ✓

```solidity
uint64 price = oracle.getEthUsdPrice(); // e.g. 3000
euint64 collateralValue = FHE.mul(encCollateral, FHE.asEuint64(price * 100));
euint64 debtThreshold   = FHE.mul(encDebt,       FHE.asEuint64(150_000));
ebool isUnhealthy = FHE.lt(collateralValue, debtThreshold);
```

---

## 11. Full Contract Template

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {FHE, euint64, externalEuint64, ebool} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";

contract ConfidentialCounter is ZamaEthereumConfig {
    mapping(address => euint64) private _counts;

    function increment(externalEuint64 encValue, bytes calldata proof) external {
        euint64 value = FHE.fromExternal(encValue, proof);

        _counts[msg.sender] = FHE.isInitialized(_counts[msg.sender])
            ? FHE.add(_counts[msg.sender], value)
            : value;

        FHE.allowThis(_counts[msg.sender]);
        FHE.allow(_counts[msg.sender], msg.sender);
    }

    function getCount() external view returns (euint64) {
        return _counts[msg.sender];
    }
}
```

---

## 12. Frontend Integration (@zama-fhe/relayer-sdk)

> **Do not use `fhevmjs`** — it is deprecated. Use `@zama-fhe/relayer-sdk` instead.
>
> ```bash
> npm install @zama-fhe/relayer-sdk
> ```
>
> For Next.js / browser apps, always import from the `/bundle` sub-path so WASM
> is pre-bundled and no Node.js polyfills are needed.

### Step 1 — Load WASM once (call before anything else)

```typescript
import { initSDK } from "@zama-fhe/relayer-sdk/bundle";

await initSDK(); // loads TFHE + TKMS WASM
```

### Step 2 — Create an instance (after wallet connects)

```typescript
import { initSDK, createInstance, SepoliaConfig } from "@zama-fhe/relayer-sdk/bundle";
import { BrowserProvider } from "ethers";

await initSDK();

const config = { ...SepoliaConfig, network: window.ethereum };
const instance = await createInstance(config);
```

### Step 3 — Encrypt inputs and call the contract

```typescript
// externalEuint64 → bytes32 in the ABI, inputProof → bytes
const input = instance.createEncryptedInput(contractAddress, userAddress);
input.add64(BigInt(borrowAmountUSDC)); // 6-decimal USDC units
const { handles, inputProof } = await input.encrypt();

// handles[0] is Uint8Array (32 bytes) — ethers encodes it as bytes32
// inputProof  is Uint8Array              — ethers encodes it as bytes
await vault.borrow(handles[0], inputProof, { value: parseEther("1") });
```

### Step 4 — Reencrypt (user reads their own encrypted value)

```typescript
const { publicKey, privateKey } = instance.generateKeypair();
const eip712 = instance.createEIP712(publicKey, contractAddress);
const signature = await signer.signTypedData(
  eip712.domain, eip712.types, eip712.message
);

const encHandle = await contract.confidentialBalanceOf(userAddress);
const balance = await instance.reencrypt(
  encHandle,
  privateKey,
  publicKey,
  signature,
  contractAddress,
  userAddress
);
console.log("Balance:", balance); // plaintext bigint
```

### Next.js WASM configuration (next.config.ts)

```typescript
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  webpack: (config, { isServer }) => {
    config.experiments = { ...config.experiments, asyncWebAssembly: true };
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false, net: false, tls: false, crypto: false,
      };
    }
    return config;
  },
};
export default nextConfig;
```

### React context pattern (wallet + FHE instance lifecycle)

```typescript
// Only call initSDK() once; only call createInstance() after wallet connects.
// Gate all contract calls on both `instance` and `signer` being non-null.

const { instance, account, signer, connect } = useFhe();

// In a form submit handler:
const input = instance.createEncryptedInput(VAULT_ADDRESS, account);
input.add64(usdcUnits);
const { handles, inputProof } = await input.encrypt();
const tx = await vaultContract(signer).borrow(handles[0], inputProof, { value });
await tx.wait();
```

---

## 13. Testing (Hardhat + mock-utils)

```typescript
import { createInstances } from "@fhevm/mock-utils";
import { ethers } from "hardhat";

describe("ConfidentialVault", () => {
  it("should borrow encrypted amount", async () => {
    const [deployer, borrower] = await ethers.getSigners();
    const instances = await createInstances(deployer.address);

    const Vault = await ethers.deployContract("ConfidentialVault", [...]);
    const borrowerInstance = await createInstances(borrower.address);

    // Encrypt 1000 USDC (6 decimals) as a borrow amount
    const { handles, inputProof } = borrowerInstance
      .createEncryptedInput(await Vault.getAddress(), borrower.address)
      .add64(1_000_000_000n) // 1000 USDC
      .encrypt();

    await Vault.connect(borrower).borrow(handles[0], inputProof, {
      value: ethers.parseEther("1"),
    });

    // Reencrypt to verify
    const encDebt = await Vault.getPositionHandles(borrower.address);
    const debtPlaintext = borrowerInstance.decrypt(
      await Vault.getAddress(),
      encDebt.encDebt
    );
    expect(debtPlaintext).to.equal(1_000_000_000n);
  });
});
```

---

## 14. Common Anti-Patterns (Do Not Do These)

### ❌ Using encrypted values in `require()` directly

```solidity
// WRONG — encrypted booleans cannot be used in Solidity conditionals
require(FHE.lt(balance, limit), "Over limit");

// CORRECT — use FHE.select() to conditionally compute, or decrypt asynchronously
euint64 safeAmount = FHE.select(FHE.lt(amount, balance), amount, balance);
```

### ❌ Forgetting `FHE.allowThis()` after computation

```solidity
// WRONG — contract loses access to `result` after the transaction
euint64 result = FHE.add(a, b);

// CORRECT
euint64 result = FHE.add(a, b);
FHE.allowThis(result); // contract retains access in future txns
```

### ❌ Passing encrypted handle to another contract without allowTransient

```solidity
// WRONG — other contract cannot use `handle`
token.mint(user, handle);

// CORRECT
FHE.allowTransient(handle, address(token));
token.mint(user, handle);
```

### ❌ Not calling FHE.fromExternal() on user inputs

```solidity
// WRONG — raw external input has no validated handle
function foo(externalEuint64 raw, bytes calldata proof) external {
    _balances[msg.sender] = FHE.add(_balances[msg.sender], raw); // type error + unsafe
}

// CORRECT
function foo(externalEuint64 raw, bytes calldata proof) external {
    euint64 validated = FHE.fromExternal(raw, proof);
    _balances[msg.sender] = FHE.add(_balances[msg.sender], validated);
}
```

### ❌ euint64 overflow in health factor math

```solidity
// WRONG — overflows for any real ETH position
euint64 value = FHE.mul(encCollateral_wei, FHE.asEuint64(price_8dec));
// collateral in wei (1e18) × price (1e11) = 1e29 → overflows euint64

// CORRECT — use gwei (1e9) for collateral and strip Chainlink decimals
euint64 value = FHE.mul(encCollateral_gwei, FHE.asEuint64(price_int * 100));
```

### ❌ Using tx.origin for access control

```solidity
// WRONG — phishing attack vector
require(tx.origin == owner, "Not owner");

// OK only for fee attribution (not access control), as documented in ARGEN README
_triggerAgent[borrower] = tx.origin; // captures EOA that paid gas for fee payout only
```

### ❌ Storing decrypted values on-chain after resolution

```solidity
// WRONG — defeats the entire point of FHE
bool public isUnhealthy;
function resolveCheck(bytes calldata result, ...) external {
    isUnhealthy = abi.decode(result, (bool)); // now everyone can read it
}

// CORRECT — act on the result immediately, don't store the plaintext
function resolveCheck(bytes calldata result, ...) external {
    bool unhealthy = abi.decode(result, (bool));
    if (unhealthy) { _startLiquidation(borrower); } // act, don't store
}
```

---

## 15. Sepolia Infrastructure Addresses

These addresses are for Ethereum Sepolia. `ZamaEthereumConfig` configures the first five
automatically — you do **not** hardcode them. The one you DO use explicitly is `DECRYPTION_ADDRESS`.

| Name | Address | Who uses it |
|---|---|---|
| `FHEVM_EXECUTOR_CONTRACT` | `0x92C920834Ec8941d2C77D188936E1f7A6f49c127` | Auto via `ZamaEthereumConfig` |
| `ACL_CONTRACT` | `0xf0Ffdc93b7E186bC2f8CB3dAA75D86d1930A433D` | Auto via `ZamaEthereumConfig` |
| `HCU_LIMIT_CONTRACT` | `0xa10998783c8CF88D886Bc30307e631D6686F0A22` | Auto via `ZamaEthereumConfig` |
| `KMS_VERIFIER_CONTRACT` | `0xbE0E383937d564D7FF0BC3b46c51f0bF8d5C311A` | Auto via `ZamaEthereumConfig` |
| `INPUT_VERIFIER_CONTRACT` | `0xBBC1fFCdc7C316aAAd72E807D9b0272BE8F84DA0` | Auto via `ZamaEthereumConfig` |
| `DECRYPTION_ADDRESS` | `0x5D8BD78e2ea6bbE41f26dFe9fdaEAa349e077478` | **Your contract** — gate callbacks to this |
| `INPUT_VERIFICATION_ADDRESS` | `0x483b9dE06E4E4C7D35CCf5837A1668487406D955` | Auto via `FHE.fromExternal()` |
| `RELAYER_URL` | `https://relayer.testnet.zama.org` | `.env` / relayer SDK config |
| `GATEWAY_CHAIN_ID` | `10901` | `.env` / relayer SDK config |

### Gating decryption callbacks to DECRYPTION_ADDRESS

```solidity
address public constant DECRYPTION_ADDRESS = 0x5D8BD78e2ea6bbE41f26dFe9fdaEAa349e077478;

error OnlyDecryptor();

modifier onlyDecryptor() {
    if (msg.sender != DECRYPTION_ADDRESS) revert OnlyDecryptor();
    _;
}

/// @notice Zama relayer calls this after decrypting the FHE result.
function resolveHealthCheck(
    address borrower,
    bytes calldata abiEncodedClearResult,
    bytes calldata decryptionProof
) external onlyDecryptor {
    // FHE.checkSignatures() still runs for cryptographic verification
    bytes32[] memory cts = new bytes32[](1);
    cts[0] = FHE.toBytes32(_pendingCheck[borrower]);
    FHE.checkSignatures(cts, abiEncodedClearResult, decryptionProof);
    // ...
}
```

> **Note for tests:** On local Hardhat (mock environment), skip the `onlyDecryptor` guard
> or override `DECRYPTION_ADDRESS` to a test signer. The mock environment does not use the
> real relayer.

---

## 16. Deployment Checklist

```
□ All contracts inherit ZamaEthereumConfig
□ Decryption callbacks gated with onlyDecryptor (DECRYPTION_ADDRESS = 0x5D8B...)
□ Every FHE.add/sub/mul result has FHE.allowThis() + FHE.allow(owner)
□ Every cross-contract handle transfer uses FHE.allowTransient()
□ Every FHE.fromExternal() validates the inputProof
□ Decryption callbacks verify FHE.checkSignatures() before trusting plaintext
□ euint64 arithmetic checked for overflow at max realistic values
□ No require() on encrypted booleans — use FHE.select() instead
□ Health factor constants use gwei-scale collateral (not wei)
□ Chainlink price stripped to integer USD (divide by 1e8)
□ Contracts compiled with solidity ≥ 0.8.24, evmVersion: "cancun"
□ Network: Ethereum Sepolia (Zama FHEVM coprocessor deployed there)
```

---

## 16. Key Imports Reference

```solidity
// Core FHE library — types and operations
import {FHE, euint64, externalEuint64, ebool, eaddress} from "@fhevm/solidity/lib/FHE.sol";

// Sepolia coprocessor configuration — inherit in every contract
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";
```

---

## 17. Architecture Summary (ARGEN × ZAMA Reference)

```
Browser (@zama-fhe/relayer-sdk)
  └─ encrypt(amount)  →  externalEuint64 + inputProof
        │
        ▼
ConfidentialVault (ZamaEthereumConfig)
  ├─ FHE.fromExternal(encInput, proof)   → euint64 handle
  ├─ FHE.allowTransient(handle, cETH)
  ├─ cETH.mint(user, handle)             → encrypted balance stored
  │
  ├─ requestLiquidationCheck()
  │    FHE.lt(collateral, debt)          → ebool isUnhealthy
  │    FHE.makePubliclyDecryptable()     → Zama relayer picks up
  │
  └─ resolveHealthCheck() ← relayer callback
       FHE.checkSignatures()
       if unhealthy → DutchAuction.startAuction()

DutchAuction (ZamaEthereumConfig)
  ├─ submitBid(encMaxBid, proof)
  │    FHE.ge(encMaxBid, currentPublicPrice) → ebool valid
  │    FHE.makePubliclyDecryptable(valid)
  │
  └─ resolveBid() ← relayer callback
       FHE.checkSignatures()
       if valid → vault.settleLiquidation()
```

---

*Built for the Zama Protocol AI Agent Skills Challenge.*
*Reference implementation: ARGEN × ZAMA confidential lending protocol.*
