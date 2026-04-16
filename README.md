# ARGEN × ZAMA

> Autonomous Confidential Lending Protocol — Full Homomorphic Encryption on Ethereum Sepolia

ARGEN × ZAMA is a confidential DeFi lending protocol that uses Zama's Fully Homomorphic Encryption VM (FHEVM) to keep all position data encrypted on-chain. Liquidation eligibility is computed homomorphically — no off-chain ZK circuits, no Circom, no SnarkJS. Autonomous TypeScript agents monitor positions and compete in encrypted Dutch auctions.

---

## How It Works

1. **Borrowers** deposit ETH as collateral and receive encrypted cETH (ERC-7984). They borrow cUSDC with an amount that is FHE-encrypted before it ever leaves their browser.
2. **Lenders** deposit cUSDC and receive encrypted receipt tokens.
3. **Health factors** are computed on-chain using FHEVM arithmetic over encrypted state. No ZK proofs are generated — the contract runs `TFHE.lt()` natively.
4. **Monitor agents** call `requestLiquidationCheck()` on the Vault. The Zama Gateway decrypts the result asynchronously (~2–3s) and fires a callback.
5. **Dutch auctions** start when a position is found unhealthy. Bid amounts are encrypted — competitors cannot see each other's max prices.
6. **The x402 server** sells `TFHE.allow()` decryption grants, not raw data. Payment is cryptographically enforced — without an on-chain grant, encrypted state is unreadable.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Ethereum Sepolia                             │
│                                                                     │
│  ConfidentialCollateral (ERC-7984 cETH)                             │
│  ConfidentialDebt       (ERC-7984 cUSDC)                            │
│  PriceOracle            (Chainlink adapter)                         │
│  ConfidentialVault      ◄─── core: deposits, borrows, health check  │
│  DutchAuction           ◄─── encrypted bid settlement               │
│                                                                     │
│  Zama Gateway  ◄─── async decryption callbacks                      │
└─────────────────────────────────────────────────────────────────────┘
         ▲                          ▲
         │                          │
  Monitor Agent              Bidder Agent
  (polls positions)          (watches auctions)
         │                          │
         └────────── x402 Server ───┘
                  (sells FHE grants)
```

---

## Repository Structure

```
argen-zama/
├── contracts/
│   ├── tokens/
│   │   ├── ConfidentialCollateral.sol   # ERC-7984 cETH
│   │   └── ConfidentialDebt.sol         # ERC-7984 cUSDC
│   ├── core/
│   │   ├── ConfidentialVault.sol        # Deposits, borrows, health factor
│   │   ├── DutchAuction.sol             # Encrypted Dutch auction engine
│   │   └── PriceOracle.sol              # Chainlink price feed adapter
│   ├── interfaces/
│   └── mocks/
│       └── MockPriceFeed.sol
├── agent/
│   ├── src/
│   │   ├── monitor.ts                   # Scans positions, triggers liquidations
│   │   ├── bidder.ts                    # Watches auctions, places encrypted bids
│   │   ├── fhe.ts                       # fhevmjs encryption helpers
│   │   ├── contracts.ts                 # ABI + ethers clients
│   │   └── config.ts                    # Env-driven config
│   └── server/
│       ├── index.ts                     # x402 Express server
│       ├── middleware/x402.ts           # Payment verification
│       └── routes/opportunities.ts     # /opportunities endpoint
├── frontend/
│   ├── app/
│   │   ├── page.tsx                     # Dashboard
│   │   ├── borrow/page.tsx              # Borrow flow
│   │   ├── lend/page.tsx                # Lend/deposit flow
│   │   └── agents/page.tsx             # Live agent monitor
│   ├── components/
│   │   ├── PositionCard.tsx             # Reencrypt + reveal own position
│   │   ├── HealthMeter.tsx
│   │   ├── AuctionFeed.tsx
│   │   └── AgentStatus.tsx
│   └── lib/
│       ├── fhevm.ts                     # Client-side fhevmjs setup
│       └── contracts.ts
├── scripts/
│   ├── deploy.ts
│   ├── verify.ts
│   └── seed.ts
├── hardhat.config.ts
└── .env.example
```

---

## Tech Stack

| Layer | Tech |
|---|---|
| Chain | Ethereum Sepolia (Zama FHEVM) |
| Contracts | Solidity 0.8.24 + Hardhat |
| FHE SDK | `@zama-ai/fhevmjs` |
| Token Standard | ERC-7984 (Zama confidential tokens) |
| Agents | TypeScript + ethers.js |
| API | Express + x402 payment protocol |
| Frontend | Next.js 14 (App Router) |

---

## Prerequisites

- Node >= 20
- pnpm >= 9
- A funded Sepolia wallet (deployer + two agent wallets)
- Sepolia RPC URL (Alchemy, Infura, or public)

---

## Setup

### 1. Install dependencies

```bash
# Contracts
pnpm add -D @zama-ai/hardhat-zama @nomicfoundation/hardhat-toolbox
pnpm add @zama-ai/fhevmjs @openzeppelin/contracts

# Agent
cd agent && pnpm install

# Frontend
cd frontend && pnpm install
```

### 2. Configure environment

```bash
cp .env.example .env
```

Fill in `.env`:

```
SEPOLIA_RPC_URL=
DEPLOYER_PRIVATE_KEY=
MONITOR_AGENT_PRIVATE_KEY=
BIDDER_AGENT_PRIVATE_KEY=
PROTOCOL_WALLET_ADDRESS=
CHAINLINK_ETH_USD_FEED=0x694AA1769357215DE4FAC081bf1f309aDC325306
VAULT_CONTRACT_ADDRESS=
AUCTION_CONTRACT_ADDRESS=
COLLATERAL_TOKEN_ADDRESS=
DEBT_TOKEN_ADDRESS=
CUSDC_TOKEN_ADDRESS=
X402_PRICE_USD=0.05
MIN_PROFIT_THRESHOLD_BPS=200
TRIGGER_FEE_BPS=100
NEXT_PUBLIC_VAULT_ADDRESS=
NEXT_PUBLIC_CHAIN_ID=11155111
```

### 3. Deploy contracts

```bash
pnpm hardhat run scripts/deploy.ts --network sepolia
```

The script deploys all contracts in dependency order, wires them together, and prints the addresses to copy into `.env`.

### 4. Run agents

```bash
# Terminal 1 — Monitor agent
cd agent && pnpm ts-node src/monitor.ts

# Terminal 2 — Bidder agent
cd agent && pnpm ts-node src/bidder.ts

# Terminal 3 — x402 API server
cd agent && pnpm ts-node server/index.ts
```

### 5. Run frontend

```bash
cd frontend && pnpm dev
```

---

## Core Contracts

### ConfidentialVault

The central contract. Manages encrypted deposits, encrypted debt, and on-chain FHE health factor computation.

**Key functions:**

| Function | Description |
|---|---|
| `borrow(einput, bytes)` | Open a position. ETH collateral + encrypted borrow amount. |
| `repay(einput, bytes)` | Repay encrypted debt. |
| `depositLiquidity(einput, bytes)` | Lender deposits cUSDC. |
| `requestLiquidationCheck(address)` | Agent submits position for async FHE health check. |
| `grantAgentAccess(address, address)` | x402 server grants FHE read access to a paying agent. |
| `getActivePositions()` | Returns active position addresses. Amounts remain encrypted. |
| `getPositionHandles(address)` | Returns raw encrypted handles for reencryption. |

**Health factor formula (on-chain FHE):**

```
unhealthy = (collateral_gwei × ethPrice × 100) < (debt_usdc × 150)
```

This runs natively as `TFHE.lt()` over encrypted values. No Circom. No SnarkJS. No proof generation.

### DutchAuction

Encrypted Dutch auction engine. Price descent is public (bidders need it). Bid amounts are encrypted (competitors cannot see your max price).

**Key functions:**

| Function | Description |
|---|---|
| `startAuction(...)` | Called by Vault on unhealthy position. |
| `getCurrentPrice(uint256)` | Public price curve. Linear descent over 1 hour to 70% floor. |
| `submitBid(uint256, einput, bytes)` | Submit encrypted max bid. Gateway resolves win/loss. |
| `getActiveAuctions()` | Returns unsettled auction IDs. |

---

## Agent System

### Monitor Agent

Polls `getActivePositions()` every 15 seconds. For each position, calls `requestLiquidationCheck()`. The Zama Gateway decrypts the result (~2–3s) and fires `_onHealthCheckDecrypted()` back on-chain. If unhealthy, the Vault starts an auction and awards a 1% trigger fee to the agent.

No local computation. No proof generation. The agent is a simple on-chain trigger.

### Bidder Agent

Polls `getActiveAuctions()` every 3 seconds. Calculates current discount vs start price. When discount exceeds `MIN_PROFIT_THRESHOLD_BPS` (default 200bps = 2%), encrypts its max bid client-side and calls `submitBid()`. The Gateway resolves win/loss; first valid bid wins.

### x402 Server

Sells `TFHE.allow()` grants at `$0.05` per request. The payment is enforced cryptographically: without an on-chain grant, agents cannot call `fhevmjs.reencrypt()` to read position data. The API endpoint `/opportunities` returns position addresses, auction IDs, and executes grants for each position atomically.

**Endpoints:**

| Endpoint | Auth | Description |
|---|---|---|
| `GET /opportunities` | x402 payment required | Positions + auction IDs + FHE grants |
| `GET /auctions/:id/price` | None | Current auction price |
| `GET /health` | None | Server health check |

---

## Frontend

### Borrow Flow

User enters ETH collateral and USDC borrow amount. The borrow amount is FHE-encrypted in the browser using `fhevmjs` before the transaction is sent. The plaintext never appears on-chain or in transaction calldata.

### Reveal Position

Users sign an EIP-712 message to prove ownership, then call `fhevmjs.reencrypt()`. The Gateway reencrypts their values under a user-generated ephemeral keypair. The browser decrypts locally. Other users and contracts cannot read the values.

### Agent Dashboard

Live view of active positions being monitored and running auctions with descending price curves. Polls every 10 seconds.

---

## FHE Design Notes

### Why FHEVM over Circom ZK

| Argen v1 (Circom) | Argen × Zama (FHEVM) |
|---|---|
| Off-chain proof generation | On-chain FHE arithmetic |
| `health_factor.wasm` + SnarkJS | `TFHE.lt()` in contract |
| Agent generates proof before submitting | Agent calls contract; contract does math |
| Proof size ~200KB | No proof — just a tx |
| ~5s local prover time | ~2–3s Gateway async callback |

### `euint64` Scaling

- **Collateral** is stored in gwei units (divide ETH by `1e9`) — fits comfortably in `euint64` range (~18.4 ETH max per position). Use `euint128` for larger positions.
- **Debt** is stored in 6-decimal USDC units.
- **Price** from Chainlink (8 decimals) is divided by 100 → scaled to `1e6` to fit `uint64` arithmetic.

### Access Control Model

`TFHE.allow(handle, address)` is the primitive. Only addresses with an explicit allow can reencrypt a value. The x402 payment wall is therefore cryptographic — there is no way to bypass it by reading chain data.

---

## Tests

```bash
pnpm hardhat test
```

Tests run against the local Zama Hardhat network (mock FHE environment). The `getFhevmInstance()` helper from `@zama-ai/hardhat-zama` provides a mock instance that encrypts/decrypts synchronously in test context.

---

## Security Notes

- `tx.origin` is used in `requestLiquidationCheck` to capture the triggering agent for fee attribution. This is intentional and acceptable here — the fee recipient is the EOA that paid gas, which is the correct entity to reward. Do not use `tx.origin` for access control.
- The `LIQUIDATION_THRESHOLD` (150%) and fee constants are hardcoded. These should be governable in a production deployment.
- The x402 middleware in this reference implementation does not verify the payment `txHash` on-chain. Production deployments should use the OpenZeppelin Facilitator contract for on-chain payment verification.
- `euint64` overflow is a risk if collateral × price exceeds `2^64`. Add overflow guards or use `euint128` for production.

---

## License

MIT
