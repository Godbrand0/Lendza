"use client";

import React, { useState } from "react";
import {
  User, Settings, CreditCard, Wallet, Lock,
  Eye, Loader2, Timer, ShieldCheck, TrendingDown, TrendingUp,
  AlertCircle, History, RefreshCw, ExternalLink,
} from "lucide-react";
import { useAccount, useBalance } from "wagmi";
import { useVaultPosition } from "@/hooks/useVaultPosition";
import { useTransactionHistory, type HistoryEvent } from "@/hooks/useTransactionHistory";

function formatCountdown(secondsLeft: number) {
  if (secondsLeft <= 0) return "Overdue";
  const m = Math.floor(secondsLeft / 60);
  const s = secondsLeft % 60;
  return `${m}m ${s.toString().padStart(2, "0")}s`;
}

function formatDate(timestamp?: number) {
  if (!timestamp) return "—";
  return new Date(timestamp * 1000).toLocaleString("en-US", {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

function shortHash(hash: string) {
  return `${hash.slice(0, 8)}…${hash.slice(-6)}`;
}

const ACTION_STYLES: Record<string, string> = {
  "Collateral Deposited": "text-green-400",
  "Collateral Withdrawn": "text-yellow-400",
  "Borrowed": "text-brand-cyan",
  "Repaid": "text-blue-400",
  "Liquidity Deposited": "text-brand-blue",
  "Liquidated": "text-red-400",
};

function HistoryTable({ events, loading, error, emptyMsg }: {
  events: HistoryEvent[];
  loading: boolean;
  error: string | null;
  emptyMsg: string;
}) {
  if (loading) {
    return (
      <div className="flex items-center justify-center py-10 text-gray-500">
        <Loader2 size={18} className="animate-spin mr-2" /> Loading history…
      </div>
    );
  }
  if (error) {
    return <p className="text-xs text-red-400 py-4 text-center">{error}</p>;
  }
  if (events.length === 0) {
    return <p className="text-xs text-gray-500 py-6 text-center">{emptyMsg}</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-xs">
        <thead>
          <tr className="text-gray-500 border-b border-white/10">
            <th className="pb-3 font-medium uppercase tracking-wider">Date</th>
            <th className="pb-3 font-medium uppercase tracking-wider">Action</th>
            <th className="pb-3 font-medium uppercase tracking-wider">Amount</th>
            <th className="pb-3 font-medium uppercase tracking-wider">Tx</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-white/5">
          {events.map((e, i) => (
            <tr key={i} className="hover:bg-white/5 transition-colors">
              <td className="py-3 text-gray-400 font-mono">{formatDate(e.timestamp)}</td>
              <td className={`py-3 font-semibold ${ACTION_STYLES[e.action] ?? "text-gray-300"}`}>
                {e.action}
              </td>
              <td className="py-3 font-mono text-gray-300">
                {e.ethAmount !== undefined
                  ? `${e.ethAmount.toFixed(4)} ETH`
                  : <span className="flex items-center gap-1 text-gray-500"><Lock size={10} /> Encrypted</span>}
              </td>
              <td className="py-3">
                <a
                  href={`https://sepolia.etherscan.io/tx/${e.txHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 text-brand-cyan/70 hover:text-brand-cyan transition-colors font-mono"
                >
                  {shortHash(e.txHash)}
                  <ExternalLink size={10} />
                </a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

type Tab = "current" | "history";

function TabBar({ active, onChange, historyCount }: {
  active: Tab;
  onChange: (t: Tab) => void;
  historyCount: number;
}) {
  return (
    <div className="flex gap-1 bg-white/5 p-1 rounded-lg w-fit">
      <button
        onClick={() => onChange("current")}
        className={`px-3 py-1 rounded-md text-xs font-semibold transition-all ${
          active === "current"
            ? "bg-white/10 text-white"
            : "text-gray-500 hover:text-gray-300"
        }`}
      >
        Current
      </button>
      <button
        onClick={() => onChange("history")}
        className={`px-3 py-1 rounded-md text-xs font-semibold transition-all flex items-center gap-1.5 ${
          active === "history"
            ? "bg-white/10 text-white"
            : "text-gray-500 hover:text-gray-300"
        }`}
      >
        <History size={11} />
        History
        {historyCount > 0 && (
          <span className="bg-white/10 text-gray-400 rounded-full px-1.5 py-0 text-[10px] font-mono">
            {historyCount}
          </span>
        )}
      </button>
    </div>
  );
}

export default function ProfilePage() {
  const { address, isConnected } = useAccount();
  const { data: ethBalance } = useBalance({ address });
  const position = useVaultPosition();
  const history = useTransactionHistory();

  const [decryptingDebt, setDecryptingDebt] = useState(false);
  const [decryptingLend, setDecryptingLend] = useState(false);
  const [borrowTab, setBorrowTab] = useState<Tab>("current");
  const [lendTab, setLendTab] = useState<Tab>("current");

  const [, forceRender] = React.useReducer((x: number) => x + 1, 0);
  React.useEffect(() => {
    if (!position.loan?.isActive) return;
    const id = setInterval(forceRender, 1000);
    return () => clearInterval(id);
  }, [position.loan?.isActive]);

  const secondsLeft = position.loan?.dueTime
    ? position.loan.dueTime - Math.floor(Date.now() / 1000)
    : null;

  const shortAddr = address ? `${address.slice(0, 6)}…${address.slice(-4)}` : "Not connected";

  const isBorrower = position.hasCollateral || position.loan?.isActive;

  async function handleRevealDebt() {
    setDecryptingDebt(true);
    try { await position.decryptDebt(); } finally { setDecryptingDebt(false); }
  }

  async function handleRevealLend() {
    setDecryptingLend(true);
    try { await position.decryptLenderBalance(); } finally { setDecryptingLend(false); }
  }

  return (
    <div className="p-8 max-w-6xl mx-auto space-y-8 animate-in slide-in-from-bottom-4 duration-700">
      {/* Header */}
      <div className="flex items-center gap-6 mb-4">
        <div className="w-20 h-20 rounded-3xl bg-white/5 border border-white/10 flex items-center justify-center relative group">
          <User size={32} className="text-gray-400 group-hover:text-white transition-colors" />
          {isConnected && (
            <div className="absolute -bottom-1 -right-1 w-6 h-6 bg-green-500 border-4 border-background rounded-full" />
          )}
        </div>
        <div className="space-y-1">
          <h2 className="text-3xl font-bold tracking-tight font-mono">{shortAddr}</h2>
          <div className="flex gap-3 flex-wrap">
            <span className="text-[10px] bg-brand-cyan/10 text-brand-cyan px-2 py-0.5 rounded border border-brand-cyan/20 font-mono uppercase">
              {isConnected ? "Connected" : "Not Connected"}
            </span>
            <span className="text-[10px] bg-white/5 text-gray-500 px-2 py-0.5 rounded border border-white/10 font-mono uppercase tracking-widest">
              Sepolia
            </span>
            {isBorrower && (
              <span className="text-[10px] bg-yellow-500/10 text-yellow-400 px-2 py-0.5 rounded border border-yellow-500/20 font-mono uppercase">
                Borrower
              </span>
            )}
            {position.lenderUsdc !== null && (
              <span className="text-[10px] bg-brand-blue/10 text-brand-blue px-2 py-0.5 rounded border border-brand-blue/20 font-mono uppercase">
                Lender
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-6">

          {/* Wallet balances */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="glass p-6 space-y-3">
              <div className="flex justify-between items-start">
                <span className="text-xs text-gray-400 font-medium uppercase tracking-widest">Wallet ETH</span>
                <Wallet className="text-brand-blue" size={18} />
              </div>
              <p className="text-2xl font-bold font-mono">
                {ethBalance
                  ? (Number(ethBalance.value) / 1e18).toLocaleString("en-US", { maximumFractionDigits: 4 })
                  : "—"} ETH
              </p>
            </div>

            <div className="glass p-6 space-y-3">
              <div className="flex justify-between items-start">
                <span className="text-xs text-gray-400 font-medium uppercase tracking-widest">Collateral Locked</span>
                <ShieldCheck className="text-green-400" size={18} />
              </div>
              <p className="text-2xl font-bold font-mono">
                {position.collateralEth > 0
                  ? `${position.collateralEth.toFixed(4)} ETH`
                  : "—"}
              </p>
              {position.collateralUsd > 0 && (
                <p className="text-xs text-gray-500">≈ ${position.collateralUsd.toFixed(2)} · Max borrow: ${position.maxBorrowUsdc.toFixed(2)} USDC</p>
              )}
            </div>
          </div>

          {/* Borrow Position */}
          <div className="glass p-8 space-y-5">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold flex items-center gap-2">
                <TrendingDown size={18} className="text-brand-cyan" />
                Borrow Position
              </h3>
              <div className="flex items-center gap-2">
                {borrowTab === "history" && (
                  <button
                    onClick={history.refresh}
                    disabled={history.loading}
                    className="text-gray-500 hover:text-gray-300 transition-colors"
                    title="Refresh history"
                  >
                    <RefreshCw size={13} className={history.loading ? "animate-spin" : ""} />
                  </button>
                )}
                <TabBar
                  active={borrowTab}
                  onChange={setBorrowTab}
                  historyCount={history.borrowEvents.length}
                />
              </div>
            </div>

            {borrowTab === "current" ? (
              !position.hasCollateral ? (
                <p className="text-sm text-gray-500">No active borrow position.</p>
              ) : (
                <div className="space-y-4">
                  {position.loan?.isActive && secondsLeft !== null && (
                    <div className={`flex items-center gap-3 p-4 rounded-xl ${position.loan.isOverdue ? "bg-red-500/10 border border-red-500/20" : "bg-brand-cyan/10 border border-brand-cyan/20"}`}>
                      <Timer size={20} className={position.loan.isOverdue ? "text-red-400" : "text-brand-cyan"} />
                      <div>
                        <p className="text-xs text-gray-400 uppercase font-bold tracking-wider">Time remaining</p>
                        <p className={`text-xl font-mono font-bold ${position.loan.isOverdue ? "text-red-400" : "text-brand-cyan"}`}>
                          {formatCountdown(secondsLeft)}
                        </p>
                      </div>
                      <div className="ml-auto text-right text-xs text-gray-500">
                        <p>Due: {new Date(position.loan.dueTime * 1000).toLocaleTimeString()}</p>
                      </div>
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <InfoRow label="Collateral" value={`${position.collateralEth.toFixed(4)} ETH`} />
                    <InfoRow label="Collateral value" value={`$${position.collateralUsd.toFixed(2)}`} />
                    <InfoRow label="Max borrowable" value={`$${position.maxBorrowUsdc.toFixed(2)} USDC`} />
                    <InfoRow label="Loan status" value={position.loan?.isActive ? "Active" : "No debt"} />
                  </div>

                  {position.loan?.isActive && (
                    <div className="flex items-center justify-between p-4 bg-white/5 rounded-xl border border-white/10">
                      <div>
                        <p className="text-xs text-gray-400 uppercase font-bold tracking-wider mb-1">Debt (cUSDC)</p>
                        {position.debtUsdc !== null ? (
                          <p className="text-lg font-mono font-bold text-brand-cyan">
                            ${position.debtUsdc.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDC
                          </p>
                        ) : (
                          <p className="text-sm text-gray-500 flex items-center gap-1.5">
                            <Lock size={12} className="text-brand-cyan" /> FHE Encrypted
                          </p>
                        )}
                      </div>
                      <button onClick={handleRevealDebt} disabled={decryptingDebt}
                        className="flex items-center gap-2 px-3 py-2 rounded-xl bg-brand-cyan/10 border border-brand-cyan/20 text-brand-cyan text-xs font-bold hover:bg-brand-cyan/20 transition-all disabled:opacity-40">
                        {decryptingDebt ? <Loader2 size={12} className="animate-spin" /> : <Eye size={12} />}
                        {decryptingDebt ? "Decrypting…" : "Reveal"}
                      </button>
                    </div>
                  )}
                </div>
              )
            ) : (
              <HistoryTable
                events={history.borrowEvents}
                loading={history.loading}
                error={history.error}
                emptyMsg="No borrow history found."
              />
            )}
          </div>

          {/* Lend Position */}
          <div className="glass p-8 space-y-5">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold flex items-center gap-2">
                <TrendingUp size={18} className="text-brand-blue" />
                Lend Position
              </h3>
              <div className="flex items-center gap-2">
                {lendTab === "history" && (
                  <button
                    onClick={history.refresh}
                    disabled={history.loading}
                    className="text-gray-500 hover:text-gray-300 transition-colors"
                    title="Refresh history"
                  >
                    <RefreshCw size={13} className={history.loading ? "animate-spin" : ""} />
                  </button>
                )}
                <TabBar
                  active={lendTab}
                  onChange={setLendTab}
                  historyCount={history.lendEvents.length}
                />
              </div>
            </div>

            {lendTab === "current" ? (
              <div className="flex items-center justify-between p-4 bg-white/5 rounded-xl border border-white/10">
                <div>
                  <p className="text-xs text-gray-400 uppercase font-bold tracking-wider mb-1">Deposited (Zama USDC)</p>
                  {position.lenderUsdc !== null ? (
                    <p className="text-lg font-mono font-bold text-brand-blue">
                      ${position.lenderUsdc.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDC
                    </p>
                  ) : (
                    <p className="text-sm text-gray-500 flex items-center gap-1.5">
                      <Lock size={12} className="text-brand-blue" /> FHE Encrypted — click to reveal
                    </p>
                  )}
                </div>
                <button onClick={handleRevealLend} disabled={decryptingLend || !isConnected}
                  className="flex items-center gap-2 px-3 py-2 rounded-xl bg-brand-blue/10 border border-brand-blue/20 text-brand-blue text-xs font-bold hover:bg-brand-blue/20 transition-all disabled:opacity-40">
                  {decryptingLend ? <Loader2 size={12} className="animate-spin" /> : <Eye size={12} />}
                  {decryptingLend ? "Decrypting…" : "Reveal"}
                </button>
              </div>
            ) : (
              <HistoryTable
                events={history.lendEvents}
                loading={history.loading}
                error={history.error}
                emptyMsg="No lend history found."
              />
            )}

            {lendTab === "current" && position.lenderUsdc !== null && position.lenderUsdc > 0 && (
              <div className="text-xs text-gray-500 flex items-center gap-1.5">
                <AlertCircle size={11} />
                APY is dynamic based on protocol utilization. Check the Lend page for current rate.
              </div>
            )}
          </div>
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          <div className="glass p-6 space-y-6">
            <h4 className="font-semibold text-sm flex items-center gap-2">
              <Settings size={18} className="text-gray-400" />
              Account Settings
            </h4>
            <div className="space-y-2">
              <SettingsToggle label="Health Notifications" active />
              <SettingsToggle label="Auto x402 Agent Access" active />
              <SettingsToggle label="Privacy Shield" />
            </div>
          </div>

          <div className="glass p-6 bg-brand-cyan/5 border-brand-cyan/20">
            <h4 className="font-medium text-xs mb-2 text-brand-cyan uppercase tracking-widest flex items-center gap-2">
              <CreditCard size={12} /> Gas Station
            </h4>
            <p className="text-[10px] text-gray-400 leading-relaxed">
              Keep your Sepolia ETH topped up. The relayer needs gas to process health checks and liquidations.
            </p>
          </div>

          <div className="glass p-6 bg-white/2 space-y-3 text-xs">
            <p className="text-gray-400 uppercase font-bold tracking-wider text-[10px]">Privacy Note</p>
            <p className="text-gray-500 leading-relaxed">
              Your USDC borrow and lend amounts are FHE-encrypted on Zama&apos;s coprocessor. Only you can decrypt them using your wallet signature. Click <span className="text-brand-cyan">Reveal</span> on any encrypted field to view your balance.
            </p>
            <p className="text-gray-600 text-[10px] leading-relaxed">
              Transaction history shows on-chain events. ETH collateral amounts are visible; USDC amounts remain encrypted.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-1">
      <p className="text-[10px] text-gray-500 uppercase tracking-wider">{label}</p>
      <p className="font-mono font-bold">{value}</p>
    </div>
  );
}

function SettingsToggle({ label, active }: { label: string; active?: boolean }) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-white/5 last:border-0">
      <span className="text-xs text-gray-400">{label}</span>
      <div className={`w-8 h-4 rounded-full p-0.5 transition-colors cursor-pointer ${active ? "bg-brand-cyan" : "bg-white/10"}`}>
        <div className={`w-3 h-3 rounded-full bg-white transition-transform ${active ? "translate-x-4" : "translate-x-0"}`} />
      </div>
    </div>
  );
}
