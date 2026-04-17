"use client";

import React, { useState } from "react";
import {
  Terminal,
  Code2,
  Zap,
  Shield,
  Copy,
  Check,
  Activity,
  DollarSign,
  BookOpen,
  ChevronRight,
  AlertTriangle,
  CreditCard,
  Lock,
  Server,
} from "lucide-react";

// ─── Code Snippets ────────────────────────────────────────────────────────────

const ENV_TEMPLATE = `# Network
RPC_URL=https://devnet.zama.ai   # Zama devnet or your Sepolia RPC

# Contract Addresses
VAULT_ADDRESS=<ConfidentialVault address>
AUCTION_ADDRESS=<DutchAuction address>
CUSDC_ADDRESS=<ConfidentialDebt (cUSDC) address>

# Agent Wallets (use separate funded keys per role)
MONITOR_PRIVATE_KEY=0x...
BIDDER_PRIVATE_KEY=0x...

# x402 Payment Server — run locally or point to hosted instance
X402_SERVER_URL=http://localhost:3001
X402_FEE_USDC=10000000   # 10 USDC in 6-decimal units (server-defined)`;

const INSTALL_CMD = `npm install ethers @zama-fhe/relayer-sdk dotenv`;

const MONITOR_CODE = `// monitor.ts — Liquidation Scout
// Earn a 1% trigger fee every time you flag an unhealthy position.
import { ethers } from "ethers";
import * as dotenv from "dotenv";
dotenv.config();

const VAULT_ABI = [
  "function getActivePositions() external view returns (address[])",
  "function requestLiquidationCheck(address borrower) external",
  "event HealthCheckResolved(address indexed borrower, bool isUnhealthy)",
  "event LiquidationStarted(address indexed borrower)",
];

async function main() {
  const provider = new ethers.JsonRpcProvider(process.env.RPC_URL!);
  const wallet   = new ethers.Wallet(process.env.MONITOR_PRIVATE_KEY!, provider);
  const vault    = new ethers.Contract(process.env.VAULT_ADDRESS!, VAULT_ABI, wallet);

  // Track earnings from trigger fees
  vault.on("LiquidationStarted", (borrower: string) => {
    console.log(\`[+] Liquidation triggered for \${borrower} — 1% trigger fee earned\`);
  });

  vault.on("HealthCheckResolved", (borrower: string, isUnhealthy: boolean) => {
    console.log(\`[i] \${borrower} resolved — unhealthy: \${isUnhealthy}\`);
  });

  // Scan every 60 seconds
  setInterval(async () => {
    const positions: string[] = await vault.getActivePositions();
    console.log(\`[Scan] \${positions.length} active positions found\`);

    for (const borrower of positions) {
      try {
        const tx = await vault.requestLiquidationCheck(borrower);
        await tx.wait();
        console.log(\`[Check] Health check submitted for \${borrower}\`);
      } catch (e: any) {
        // Skip positions that already have a pending check in-flight
        if (!e.message?.includes("AlreadyPendingCheck")) {
          console.error(\`[Error] \${borrower}: \${e.message}\`);
        }
      }
    }
  }, 60_000);
}

main().catch(console.error);`;

const BIDDER_CODE = `// bidder.ts — Auction Bidder
// Buy liquidated collateral at a discount via encrypted Dutch auction.
import { ethers } from "ethers";
import { createInstance } from "@zama-fhe/relayer-sdk";
import * as dotenv from "dotenv";
dotenv.config();

const AUCTION_ABI = [
  "function getActiveAuctions() external view returns (uint256[])",
  "function getCurrentPrice(uint256 auctionId) public view returns (uint256)",
  "function submitBid(uint256 auctionId, bytes32 encMaxBid, bytes inputProof) external payable",
  "function requestBidResolution(uint256 auctionId, address bidder) external",
  "event AuctionStarted(uint256 indexed auctionId, address indexed borrower, uint256 startPrice)",
  "event AuctionSettled(uint256 indexed auctionId, address indexed winner, uint256 pricePaid)",
  "event BidRefunded(uint256 indexed auctionId, address indexed bidder)",
];

// Your maximum bid ceiling in gwei (e.g. 1.5 ETH = 1_500_000_000 gwei)
const MAX_BID_GWEI = 1_500_000_000n;

async function bid(
  auction: ethers.Contract,
  fhe: Awaited<ReturnType<typeof createInstance>>,
  wallet: ethers.Wallet,
  auctionId: bigint
) {
  const currentPrice: bigint = await auction.getCurrentPrice(auctionId);
  console.log(\`[Bid] Auction #\${auctionId} — current price: \${ethers.formatEther(currentPrice)} ETH\`);

  // Encrypt max bid ceiling using Zama FHE SDK
  const input = fhe.createEncryptedInput(process.env.AUCTION_ADDRESS!, wallet.address);
  input.add64(MAX_BID_GWEI);
  const { handles, inputProof } = await input.encrypt();

  // Deposit ETH equal to the current price (refunded if you lose)
  const tx = await auction.submitBid(auctionId, handles[0], inputProof, {
    value: currentPrice,
  });
  await tx.wait();
  console.log(\`[Bid] Encrypted bid submitted for auction #\${auctionId}\`);

  // Trigger FHE resolution — relayer decrypts & compares bid vs price on-chain
  const resTx = await auction.requestBidResolution(auctionId, wallet.address);
  await resTx.wait();
  console.log(\`[Bid] Resolution requested for auction #\${auctionId}\`);
}

async function main() {
  const provider = new ethers.JsonRpcProvider(process.env.RPC_URL!);
  const wallet   = new ethers.Wallet(process.env.BIDDER_PRIVATE_KEY!, provider);
  const auction  = new ethers.Contract(process.env.AUCTION_ADDRESS!, AUCTION_ABI, wallet);
  const fhe      = await createInstance({ network: provider });

  auction.on("AuctionSettled", (id: bigint, winner: string, price: bigint) => {
    const won = winner.toLowerCase() === wallet.address.toLowerCase();
    console.log(\`[\${won ? "WIN" : "---"}] Auction #\${id} settled at \${ethers.formatEther(price)} ETH\`);
  });

  auction.on("BidRefunded", (id: bigint, bidder: string) => {
    if (bidder.toLowerCase() === wallet.address.toLowerCase()) {
      console.log(\`[Refund] Deposit returned for auction #\${id}\`);
    }
  });

  // Watch for new auctions in real time
  auction.on("AuctionStarted", async (auctionId: bigint, borrower: string, startPrice: bigint) => {
    console.log(\`[New] Auction #\${auctionId} for \${borrower} — start: \${ethers.formatEther(startPrice)} ETH\`);
    await bid(auction, fhe, wallet, auctionId).catch(console.error);
  });

  // Also attempt bids on any auctions already live at startup
  const active: bigint[] = await auction.getActiveAuctions();
  console.log(\`[Start] \${active.length} active auctions found\`);
  for (const id of active) {
    await bid(auction, fhe, wallet, id).catch(console.error);
  }
}

main().catch(console.error);`;

const X402_CLIENT_CODE = `// x402-auth.ts — Purchase FHE read access via x402 payment wall
// The x402 server gates access to encrypted position handles.
// After payment it calls vault.grantAgentAccess(borrower, agentAddress)
// which allows your agent to read the FHE ciphertext handles on-chain.
import { ethers } from "ethers";
import * as dotenv from "dotenv";
dotenv.config();

const SERVER  = process.env.X402_SERVER_URL!;       // e.g. http://localhost:3001
const USDC_ABI = [
  "function transfer(address to, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
];
const VAULT_ABI = [
  "event AgentAccessGranted(address indexed account, address indexed agent)",
];

// ── Step 1: Probe the x402 server to get payment requirements ────────────────
async function probeAccess(agentAddress: string, borrowerAddress: string) {
  const res = await fetch(\`\${SERVER}/v1/alpha\`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ agentAddress, borrowerAddress }),
  });

  if (res.status === 200) {
    console.log("[x402] Access already granted for this borrower.");
    return null; // already have access
  }

  if (res.status === 402) {
    // Server returns payment details in the body
    // (mirrors the HTTP 402 x402 standard: payTo, amount, currency, network)
    const requirements = await res.json();
    console.log("[x402] Payment required:", requirements);
    return requirements as {
      payTo: string;      // address to send USDC to
      amount: number;     // in smallest unit (e.g. 10_000_000 = 10 USDC)
      currency: string;   // "USDC"
      network: string;    // "sepolia" / "zama-devnet"
    };
  }

  throw new Error(\`[x402] Unexpected status \${res.status}: \${await res.text()}\`);
}

// ── Step 2: Pay USDC to the facilitator ─────────────────────────────────────
async function payFee(
  wallet: ethers.Wallet,
  payTo: string,
  amount: number
): Promise<string> {
  const usdc = new ethers.Contract(process.env.CUSDC_ADDRESS!, USDC_ABI, wallet);
  const tx   = await usdc.transfer(payTo, amount);
  const receipt = await tx.wait();
  console.log(\`[x402] Payment tx: \${receipt.hash}\`);
  return receipt.hash;
}

// ── Step 3: Submit payment proof — server verifies & grants on-chain access ──
async function confirmPayment(
  agentAddress: string,
  borrowerAddress: string,
  txHash: string
) {
  const res = await fetch(\`\${SERVER}/v1/alpha/confirm\`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ agentAddress, borrowerAddress, txHash }),
  });

  if (!res.ok) throw new Error(\`[x402] Confirmation failed: \${res.statusText}\`);

  const { granted, onChainTx } = await res.json();
  console.log(\`[x402] Access granted: \${granted}  (vault tx: \${onChainTx})\`);
  // The server has called vault.grantAgentAccess(borrowerAddress, agentAddress)
  // Your agent wallet can now read FHE handles for this borrower.
}

// ── Step 4: Watch for the on-chain confirmation ──────────────────────────────
async function waitForGrant(
  provider: ethers.Provider,
  agentAddress: string
): Promise<void> {
  const vault = new ethers.Contract(
    process.env.VAULT_ADDRESS!,
    VAULT_ABI,
    provider
  );
  return new Promise((resolve) => {
    vault.on("AgentAccessGranted", (_account: string, agent: string) => {
      if (agent.toLowerCase() === agentAddress.toLowerCase()) {
        console.log("[x402] On-chain AgentAccessGranted confirmed.");
        vault.removeAllListeners();
        resolve();
      }
    });
  });
}

// ── Full flow ────────────────────────────────────────────────────────────────
async function purchaseAccess(borrowerAddress: string) {
  const provider = new ethers.JsonRpcProvider(process.env.RPC_URL!);
  const wallet   = new ethers.Wallet(process.env.BIDDER_PRIVATE_KEY!, provider);

  const requirements = await probeAccess(wallet.address, borrowerAddress);
  if (!requirements) return; // already granted

  const txHash = await payFee(wallet, requirements.payTo, requirements.amount);
  await confirmPayment(wallet.address, borrowerAddress, txHash);
  await waitForGrant(provider, wallet.address);

  console.log("[x402] Ready — you can now read encrypted position handles.");
}

// Run: purchaseAccess("<borrowerAddress>")
purchaseAccess(process.env.TARGET_BORROWER!).catch(console.error);`;

const X402_HANDLES_CODE = `// After access is granted, read & use FHE handles ─────────────────────────
const VAULT_READ_ABI = [
  "function getPositionHandles(address borrower) external view returns (bytes32 encCollateral, bytes32 encDebt)",
];

async function readHandles(wallet: ethers.Wallet, borrower: string) {
  const vault = new ethers.Contract(process.env.VAULT_ADDRESS!, VAULT_READ_ABI, wallet);

  // These bytes32 values are FHE ciphertext handles.
  // They are only usable once grantAgentAccess has been called for your wallet.
  const { encCollateral, encDebt } = await vault.getPositionHandles(borrower);

  console.log("encCollateral handle:", encCollateral);
  console.log("encDebt handle:      ", encDebt);

  // You can pass these handles into further FHE operations, e.g.
  // submit them as part of an encrypted bid or health computation.
  return { encCollateral, encDebt };
}`;

// ─── Copy Button ──────────────────────────────────────────────────────────────

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <button
      onClick={copy}
      className="flex items-center gap-1 text-[10px] text-gray-500 hover:text-gray-300 transition-colors px-2 py-1 rounded-md hover:bg-white/5"
    >
      {copied ? <Check size={12} className="text-brand-cyan" /> : <Copy size={12} />}
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

// ─── Code Block ───────────────────────────────────────────────────────────────

function CodeBlock({ code, language = "typescript" }: { code: string; language?: string }) {
  return (
    <div className="relative group">
      <div className="flex items-center justify-between px-4 py-2 bg-black/60 border-b border-white/5 rounded-t-xl">
        <span className="text-[10px] text-gray-600 font-mono uppercase tracking-widest">{language}</span>
        <CopyButton text={code} />
      </div>
      <pre className="bg-black/40 p-5 rounded-b-xl text-[11px] font-mono text-gray-300 leading-relaxed overflow-x-auto custom-scrollbar whitespace-pre">
        {code}
      </pre>
    </div>
  );
}

// ─── Section Header ───────────────────────────────────────────────────────────

function SectionHeader({
  icon: Icon,
  label,
  color = "text-brand-cyan",
}: {
  icon: React.ElementType;
  label: string;
  color?: string;
}) {
  return (
    <div className="flex items-center gap-2 mb-4">
      <Icon size={16} className={color} />
      <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400">
        {label}
      </span>
    </div>
  );
}

// ─── Strategy Card ────────────────────────────────────────────────────────────

function StrategyCard({
  icon: Icon,
  title,
  earn,
  description,
  steps,
  accent,
  badge,
}: {
  icon: React.ElementType;
  title: string;
  earn: string;
  description: string;
  steps: string[];
  accent: string;
  badge?: string;
}) {
  return (
    <div className={`glass p-6 space-y-4 border-${accent}/20`}>
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className={`p-2 rounded-xl bg-${accent}/10`}>
            <Icon size={18} className={`text-${accent}`} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-bold text-base">{title}</h3>
              {badge && (
                <span className="text-[9px] px-2 py-0.5 rounded-full border border-yellow-500/30 text-yellow-400 bg-yellow-500/10 font-bold uppercase tracking-widest">
                  {badge}
                </span>
              )}
            </div>
            <p className="text-[11px] text-gray-500 mt-0.5">{description}</p>
          </div>
        </div>
        <div className="text-right shrink-0">
          <p className="text-[9px] text-gray-600 uppercase tracking-widest font-bold">Earn</p>
          <p className={`text-sm font-bold font-mono text-${accent}`}>{earn}</p>
        </div>
      </div>
      <ol className="space-y-1.5 pl-1">
        {steps.map((step, i) => (
          <li key={i} className="flex items-start gap-2 text-[11px] text-gray-400">
            <span className={`text-${accent} font-bold font-mono shrink-0`}>{i + 1}.</span>
            {step}
          </li>
        ))}
      </ol>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function AgentAccessPage() {
  const [activeTab, setActiveTab] = useState<"setup" | "monitor" | "bidder" | "x402">("setup");

  const tabs: { id: "setup" | "monitor" | "bidder" | "x402"; label: string }[] = [
    { id: "setup",   label: "Setup" },
    { id: "monitor", label: "Liquidation Monitor" },
    { id: "bidder",  label: "Auction Bidder" },
    { id: "x402",    label: "x402 Access" },
  ];

  return (
    <div className="p-8 max-w-screen-2xl mx-auto space-y-8 animate-in slide-in-from-bottom-4 duration-700">

      {/* ── Header ── */}
      <div className="space-y-2">
        <h2 className="text-3xl font-bold tracking-tight">
          Agent <span className="text-brand-cyan">Integration Guide</span>
        </h2>
        <p className="text-gray-400 text-sm max-w-2xl">
          Run your own on-chain agent to interact with the Lendza protocol — monitor positions
          for liquidation, bid on encrypted Dutch auctions, and purchase FHE read access via the
          x402 payment wall.
        </p>
      </div>

      {/* ── Strategy Overview ── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        <StrategyCard
          icon={Activity}
          title="Liquidation Monitor"
          earn="1% of collateral"
          description="Scan positions and trigger health checks"
          accent="brand-cyan"
          steps={[
            "Call getActivePositions() on the Vault.",
            "Call requestLiquidationCheck(borrower) for each.",
            "Zama relayer evaluates health in FHE ciphertext.",
            "Earn 1% of collateral ETH when position is liquidated.",
          ]}
        />
        <StrategyCard
          icon={DollarSign}
          title="Auction Bidder"
          earn="Buy at discount"
          description="Win collateral via encrypted Dutch auction"
          accent="brand-blue"
          steps={[
            "Listen for AuctionStarted events on DutchAuction.",
            "Price decays 100% → 70% over 1 hour.",
            "Encrypt your max bid and call submitBid().",
            "Win → receive collateral; lose → full refund.",
          ]}
        />
        <StrategyCard
          icon={Lock}
          title="x402 FHE Access"
          earn="Read encrypted data"
          description="Pay to unlock encrypted position handles"
          accent="brand-cyan"
          badge="requires server"
          steps={[
            "POST /v1/alpha to the x402 server.",
            "Server responds 402 with USDC payment details.",
            "Pay USDC, submit txHash as proof.",
            "Server calls grantAgentAccess() — read FHE handles.",
          ]}
        />
      </div>

      {/* ── Main Content + Sidebar ── */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">

        {/* ── Code Sections ── */}
        <div className="lg:col-span-8 space-y-6">

          {/* Tab bar */}
          <div className="flex flex-wrap gap-1 p-1 bg-white/3 rounded-xl border border-white/5 w-fit">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`px-4 py-2 rounded-lg text-xs font-semibold transition-all ${
                  activeTab === tab.id
                    ? "bg-white/10 text-white"
                    : "text-gray-500 hover:text-gray-300"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* ── Setup tab ── */}
          {activeTab === "setup" && (
            <div className="space-y-6">
              <div className="glass p-6 space-y-4">
                <SectionHeader icon={Terminal} label="1 — Install Dependencies" />
                <CodeBlock code={INSTALL_CMD} language="bash" />
              </div>

              <div className="glass p-6 space-y-4">
                <SectionHeader icon={Shield} label="2 — Environment Variables" />
                <p className="text-[11px] text-gray-500 leading-relaxed">
                  Create a <span className="font-mono text-gray-300">.env</span> file in your agent
                  directory. Use a separate funded wallet for each role — the monitor wallet needs
                  ETH for gas; the bidder wallet needs ETH to deposit as auction collateral.
                </p>
                <CodeBlock code={ENV_TEMPLATE} language="env" />
                <div className="flex items-start gap-2 p-3 bg-yellow-500/5 border border-yellow-500/20 rounded-xl">
                  <AlertTriangle size={14} className="text-yellow-500 shrink-0 mt-0.5" />
                  <p className="text-[11px] text-yellow-200/70 leading-relaxed">
                    Never expose private keys in source control. Use environment variables or a
                    secrets manager in production.
                  </p>
                </div>
              </div>

              <div className="glass p-6 space-y-4">
                <SectionHeader icon={Code2} label="3 — Choose Your Agent" color="text-brand-blue" />
                <p className="text-[11px] text-gray-500 leading-relaxed">
                  You can run all three roles from the same machine with separate wallets.
                  The <strong className="text-gray-300">x402 Access</strong> step is optional
                  for the monitor agent but required if you want to read raw FHE handles for
                  a borrower position.
                </p>
                <div className="flex flex-wrap gap-3">
                  <button onClick={() => setActiveTab("monitor")} className="flex items-center gap-2 px-4 py-2 rounded-xl bg-brand-cyan/10 border border-brand-cyan/20 text-brand-cyan text-xs font-bold hover:bg-brand-cyan/20 transition-all">
                    Liquidation Monitor <ChevronRight size={14} />
                  </button>
                  <button onClick={() => setActiveTab("bidder")} className="flex items-center gap-2 px-4 py-2 rounded-xl bg-brand-blue/10 border border-brand-blue/20 text-brand-blue text-xs font-bold hover:bg-brand-blue/20 transition-all">
                    Auction Bidder <ChevronRight size={14} />
                  </button>
                  <button onClick={() => setActiveTab("x402")} className="flex items-center gap-2 px-4 py-2 rounded-xl bg-yellow-500/10 border border-yellow-500/20 text-yellow-400 text-xs font-bold hover:bg-yellow-500/15 transition-all">
                    x402 FHE Access <ChevronRight size={14} />
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ── Monitor tab ── */}
          {activeTab === "monitor" && (
            <div className="space-y-6">
              <div className="glass p-6 space-y-3">
                <SectionHeader icon={Activity} label="How It Works" />
                <div className="space-y-3 text-[11px] text-gray-400 leading-relaxed">
                  <p>
                    Each borrower&apos;s collateral and debt are stored as{" "}
                    <span className="font-mono text-gray-300">euint64</span> encrypted values.
                    Health cannot be evaluated off-chain. You call{" "}
                    <span className="font-mono text-brand-cyan">requestLiquidationCheck(borrower)</span>{" "}
                    which submits an FHE health computation to the Zama coprocessor.
                  </p>
                  <p>
                    The coprocessor evaluates{" "}
                    <span className="font-mono text-gray-300">
                      (collateral × price × 100) &lt; (debt × 150,000)
                    </span>{" "}
                    in ciphertext. The Zama relayer calls{" "}
                    <span className="font-mono text-brand-cyan">resolveHealthCheck()</span> back on
                    the Vault with the result.
                  </p>
                  <p>
                    If unhealthy, the Vault emits{" "}
                    <span className="font-mono text-brand-cyan">LiquidationStarted</span>, pays you{" "}
                    <strong className="text-gray-300">1% of the collateral ETH</strong> (
                    <span className="font-mono">TRIGGER_FEE_BPS = 100</span>), and starts a Dutch
                    auction.
                  </p>
                </div>
              </div>
              <div className="glass p-6 space-y-4">
                <SectionHeader icon={Code2} label="Full Agent Code" />
                <CodeBlock code={MONITOR_CODE} />
              </div>
              <div className="glass p-6 space-y-3">
                <SectionHeader icon={Zap} label="Run the Agent" color="text-brand-blue" />
                <CodeBlock code={`npx ts-node monitor.ts`} language="bash" />
              </div>
            </div>
          )}

          {/* ── Bidder tab ── */}
          {activeTab === "bidder" && (
            <div className="space-y-6">
              <div className="glass p-6 space-y-3">
                <SectionHeader icon={DollarSign} label="How It Works" color="text-brand-blue" />
                <div className="space-y-3 text-[11px] text-gray-400 leading-relaxed">
                  <p>
                    When a position is liquidated the Vault calls{" "}
                    <span className="font-mono text-brand-blue">startAuction(borrower, collateralGwei)</span>{" "}
                    on DutchAuction. The price starts at 100% of collateral ETH value and decays
                    linearly to 70% (<span className="font-mono text-gray-300">FLOOR_BPS = 7000</span>)
                    over exactly 1 hour.
                  </p>
                  <p>
                    You encrypt your max bid in gwei with the Zama FHE SDK and call{" "}
                    <span className="font-mono text-brand-blue">submitBid()</span> with an ETH
                    deposit. Your bid ceiling stays hidden — other bidders cannot see it.
                  </p>
                  <p>
                    Calling{" "}
                    <span className="font-mono text-brand-blue">requestBidResolution()</span> asks
                    the Zama relayer to decrypt and compare your encrypted bid against the current
                    price. Win → you receive the collateral; lose → full deposit refunded.
                  </p>
                </div>
              </div>
              <div className="glass p-6 space-y-4">
                <SectionHeader icon={Code2} label="Full Agent Code" color="text-brand-blue" />
                <CodeBlock code={BIDDER_CODE} />
              </div>
              <div className="glass p-6 space-y-3">
                <SectionHeader icon={Zap} label="Run the Agent" color="text-brand-blue" />
                <CodeBlock code={`npx ts-node bidder.ts`} language="bash" />
              </div>
            </div>
          )}

          {/* ── x402 tab ── */}
          {activeTab === "x402" && (
            <div className="space-y-6">

              {/* Server not deployed warning */}
              <div className="flex items-start gap-3 p-4 bg-yellow-500/5 border border-yellow-500/20 rounded-xl">
                <Server size={16} className="text-yellow-400 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <p className="text-xs font-bold text-yellow-300">x402 Server Not Deployed</p>
                  <p className="text-[11px] text-yellow-200/60 leading-relaxed">
                    The x402 payment server needs to be running before this flow works. It is a
                    separate Node.js service (not part of the frontend) responsible for receiving
                    payment, verifying it on-chain, and calling{" "}
                    <span className="font-mono">vault.grantAgentAccess()</span>. Set{" "}
                    <span className="font-mono">X402_SERVER_URL</span> in your{" "}
                    <span className="font-mono">.env</span> once it is running.
                  </p>
                </div>
              </div>

              {/* What x402 unlocks */}
              <div className="glass p-6 space-y-3">
                <SectionHeader icon={Lock} label="What x402 Access Unlocks" color="text-yellow-400" />
                <div className="space-y-3 text-[11px] text-gray-400 leading-relaxed">
                  <p>
                    By default, encrypted position data (collateral and debt handles) is{" "}
                    <strong className="text-gray-300">not readable</strong> by external agents.
                    The FHE access control on the Vault only allows the borrower and the vault
                    itself to use the ciphertext handles.
                  </p>
                  <p>
                    When you pay the x402 fee, the server calls{" "}
                    <span className="font-mono text-brand-cyan">vault.grantAgentAccess(borrowerAddress, agentAddress)</span>.
                    This allows your wallet to call{" "}
                    <span className="font-mono text-brand-cyan">getPositionHandles(borrower)</span>{" "}
                    and receive the live <span className="font-mono">euint64</span> handles for
                    that position — enabling more informed bidding or position analysis.
                  </p>
                  <p>
                    The monitor agent works <strong className="text-gray-300">without</strong> x402
                    access (it triggers health checks blindly). The bidder agent benefits from
                    x402 access if you want to inspect handles before deciding whether to bid.
                  </p>
                </div>
              </div>

              {/* Payment flow diagram */}
              <div className="glass p-6 space-y-4">
                <SectionHeader icon={CreditCard} label="x402 Payment Flow" color="text-yellow-400" />
                <div className="space-y-2">
                  {[
                    { step: "1", label: "POST /v1/alpha",      desc: "Probe server with agentAddress + borrowerAddress" },
                    { step: "2", label: "← 402 Payment Req",   desc: "Server returns payTo address, USDC amount, network" },
                    { step: "3", label: "USDC transfer()",      desc: "Agent pays USDC to payTo address on-chain" },
                    { step: "4", label: "POST /v1/alpha/confirm", desc: "Submit txHash as payment proof" },
                    { step: "5", label: "← 200 OK",            desc: "Server verifies tx and calls grantAgentAccess()" },
                    { step: "6", label: "AgentAccessGranted",   desc: "On-chain event confirms FHE read permission granted" },
                  ].map(({ step, label, desc }) => (
                    <div key={step} className="flex items-start gap-3 py-2 border-b border-white/5 last:border-0">
                      <span className="text-[10px] font-mono font-bold text-yellow-400 w-4 shrink-0">{step}</span>
                      <span className="text-[11px] font-mono text-gray-300 w-40 shrink-0">{label}</span>
                      <span className="text-[11px] text-gray-500">{desc}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Client code */}
              <div className="glass p-6 space-y-4">
                <SectionHeader icon={Code2} label="Agent Client Code — Purchasing Access" color="text-yellow-400" />
                <CodeBlock code={X402_CLIENT_CODE} />
              </div>

              {/* Reading handles */}
              <div className="glass p-6 space-y-4">
                <SectionHeader icon={Code2} label="Reading FHE Handles After Access Is Granted" color="text-brand-cyan" />
                <CodeBlock code={X402_HANDLES_CODE} />
              </div>

              <div className="glass p-6 space-y-3">
                <SectionHeader icon={Zap} label="Run" color="text-brand-blue" />
                <CodeBlock code={`TARGET_BORROWER=0x... npx ts-node x402-auth.ts`} language="bash" />
              </div>
            </div>
          )}
        </div>

        {/* ── Sidebar ── */}
        <div className="lg:col-span-4 space-y-5">

          {/* Contract Addresses */}
          <div className="glass p-6 space-y-4">
            <SectionHeader icon={BookOpen} label="Contract Addresses" />
            <div className="space-y-3">
              <AddressRow label="ConfidentialVault" envKey="VAULT_ADDRESS" />
              <AddressRow label="DutchAuction"      envKey="AUCTION_ADDRESS" />
              <AddressRow label="cUSDC (debt token)" envKey="CUSDC_ADDRESS" />
              <AddressRow label="Zama Relayer"       value="0x5D8BD7...7478" />
              <AddressRow label="Mock USDC (Devnet)" value="0x9b5Cd1...FfF" />
            </div>
            <p className="text-[10px] text-gray-600 leading-relaxed">
              Deployed on Zama Devnet (Sepolia-based). Set contract addresses via environment
              variables — see Setup tab.
            </p>
          </div>

          {/* x402 Server Status */}
          <div className="glass p-6 space-y-4 border-yellow-500/10">
            <SectionHeader icon={Server} label="x402 Server Status" color="text-yellow-400" />
            <div className="flex items-center gap-2 p-3 bg-yellow-500/5 border border-yellow-500/15 rounded-xl">
              <span className="w-2 h-2 rounded-full bg-yellow-500 animate-pulse shrink-0" />
              <span className="text-[11px] text-yellow-300 font-medium">Not yet deployed</span>
            </div>
            <div className="space-y-2 text-[11px] text-gray-500 leading-relaxed">
              <p>The x402 server must be running before agents can purchase FHE access.</p>
              <p>
                It needs a wallet with permission to call{" "}
                <span className="font-mono text-gray-400">grantAgentAccess()</span> on the Vault,
                and a USDC receiving address for fee collection.
              </p>
              <p>Add to your agent <span className="font-mono text-gray-400">.env</span>:</p>
              <div className="font-mono text-[10px] bg-black/40 p-2 rounded-lg text-brand-cyan/80">
                X402_SERVER_URL=http://localhost:3001
              </div>
            </div>
          </div>

          {/* Key Events */}
          <div className="glass p-6 space-y-4">
            <SectionHeader icon={Activity} label="Events to Watch" color="text-brand-blue" />
            <div className="space-y-2">
              <EventRow name="LiquidationCheckRequested" contract="Vault"   desc="FHE health check submitted" />
              <EventRow name="HealthCheckResolved"        contract="Vault"   desc="Result returned by relayer" />
              <EventRow name="LiquidationStarted"         contract="Vault"   desc="Unhealthy → auction starts" />
              <EventRow name="AgentAccessGranted"         contract="Vault"   desc="x402 FHE read access granted" />
              <EventRow name="AuctionStarted"             contract="Auction" desc="New Dutch auction open for bids" />
              <EventRow name="BidSubmitted"               contract="Auction" desc="Encrypted bid recorded" />
              <EventRow name="AuctionSettled"             contract="Auction" desc="Winner paid, collateral sent" />
              <EventRow name="BidRefunded"                contract="Auction" desc="Deposit returned to losing bidder" />
            </div>
          </div>

          {/* Economic Model */}
          <div className="glass p-6 space-y-4">
            <SectionHeader icon={DollarSign} label="Economic Model" color="text-brand-cyan" />
            <div className="space-y-3 text-[11px] text-gray-400 leading-relaxed">
              <div className="p-3 bg-brand-cyan/5 border border-brand-cyan/15 rounded-xl space-y-1">
                <p className="text-brand-cyan font-bold text-[10px] uppercase tracking-widest">Monitor Fee</p>
                <p><span className="font-mono text-gray-200">TRIGGER_FEE_BPS = 100</span><br />= 1% of collateral ETH, paid on <span className="font-mono">LiquidationStarted</span>.</p>
              </div>
              <div className="p-3 bg-brand-blue/5 border border-brand-blue/15 rounded-xl space-y-1">
                <p className="text-brand-blue font-bold text-[10px] uppercase tracking-widest">Auction Spread</p>
                <p>Price decays <span className="font-mono text-gray-200">startPrice → ×0.70</span> in 3600 s. Your spread = market price − price paid.</p>
              </div>
              <div className="p-3 bg-yellow-500/5 border border-yellow-500/15 rounded-xl space-y-1">
                <p className="text-yellow-400 font-bold text-[10px] uppercase tracking-widest">x402 Fee</p>
                <p>Server-defined USDC fee per access grant. Paid once per (agent, borrower) pair. Enables reading FHE handles.</p>
              </div>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function AddressRow({ label, envKey, value }: { label: string; envKey?: string; value?: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] text-gray-600">{label}</span>
      <span className="text-[11px] font-mono text-gray-400 break-all">
        {value ?? <span className="text-brand-cyan/70">${`{${envKey}}`}</span>}
      </span>
    </div>
  );
}

function EventRow({
  name,
  contract,
  desc,
}: {
  name: string;
  contract: "Vault" | "Auction";
  desc: string;
}) {
  return (
    <div className="flex flex-col gap-0.5 py-1.5 border-b border-white/5 last:border-0">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-mono text-gray-300">{name}</span>
        <span className={`text-[9px] px-1.5 py-0.5 rounded font-bold uppercase ${contract === "Vault" ? "bg-brand-cyan/10 text-brand-cyan" : "bg-brand-blue/10 text-brand-blue"}`}>
          {contract}
        </span>
      </div>
      <span className="text-[11px] text-gray-500">{desc}</span>
    </div>
  );
}
