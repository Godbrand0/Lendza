"use client";

import React from "react";
import {
  ShieldCheck,
  Activity,
  Users,
  Lock,
  RefreshCw,
  Loader2,
  TrendingUp,
  Eye,
} from "lucide-react";
// ArrowUpRight used in MyPositionRow below
import { useState } from "react";
import { useProtocolStats } from "@/hooks/useProtocolStats";
import { useVaultPosition } from "@/hooks/useVaultPosition";

const ETH_PRICE_USD = 3000;

export default function Dashboard() {
  const stats = useProtocolStats();
  const position = useVaultPosition();
  const [decryptingLend, setDecryptingLend] = useState(false);
  const [decryptingDebt, setDecryptingDebt] = useState(false);

  const totalCollateralUsd = stats.totalCollateralEth * ETH_PRICE_USD;

  return (
    <div className="p-8 space-y-8 animate-in fade-in duration-700">
      {/* Hero Stats */}
      <section className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <StatCard
          icon={<ShieldCheck className="text-green-400" />}
          label="Total Collateral Locked"
          value={stats.loading ? "…" : `${stats.totalCollateralEth.toFixed(4)} ETH`}
          sub={stats.loading ? "" : `≈ $${totalCollateralUsd.toLocaleString("en-US", { maximumFractionDigits: 0 })}`}
        />
        <StatCard
          icon={<Activity className="text-brand-cyan" />}
          label="Active Borrowers"
          value={stats.loading ? "…" : String(stats.activeBorrowers)}
          sub="Open borrow positions"
        />
        <StatCard
          icon={<Users className="text-brand-blue" />}
          label="Total Lenders"
          value={stats.loading ? "…" : String(stats.totalLenders)}
          sub="USDC amounts encrypted"
        />
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Main Content */}
        <div className="lg:col-span-2 space-y-8">
          <div className="glass p-8">
            <div className="space-y-6">
              <div className="flex justify-between items-center">
                <h3 className="text-xl font-semibold">Active Positions</h3>
                <button
                  onClick={position.refresh}
                  className="text-gray-400 hover:text-white transition-colors flex items-center gap-2 text-sm"
                >
                  <RefreshCw size={14} /> Refresh
                </button>
              </div>

              {position.loading ? (
                <div className="flex items-center justify-center py-16 text-gray-500">
                  <Loader2 size={24} className="animate-spin" />
                </div>
              ) : (
                <>
                  <table className="w-full text-left">
                    <thead>
                      <tr className="text-gray-500 text-xs border-b border-white/10">
                        <th className="pb-4 font-medium uppercase tracking-wider">Address</th>
                        <th className="pb-4 font-medium uppercase tracking-wider">Collateral</th>
                        <th className="pb-4 font-medium uppercase tracking-wider">Debt (cUSDC)</th>
                        <th className="pb-4 font-medium uppercase tracking-wider">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5">
                      {position.hasCollateral || position.loan?.isActive ? (
                        <MyPositionRow position={position} />
                      ) : (
                        <tr>
                          <td colSpan={4} className="py-12 text-center text-gray-500 text-sm">
                            No open positions. Deposit collateral to get started.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>

                  <p className="text-[10px] text-gray-600 text-center pt-2">
                    Only your own position is visible. Other borrowers' amounts stay private.
                  </p>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Borrower position */}
          {position.hasCollateral && (
            <div className="glass p-6 space-y-4 border-brand-cyan/20 bg-brand-cyan/5">
              <h3 className="font-semibold text-sm flex items-center gap-2">
                <TrendingUp size={16} className="text-brand-cyan" />
                My Borrow Position
              </h3>
              <div className="space-y-3 text-xs">
                <Row label="Collateral" value={`${position.collateralEth.toFixed(4)} ETH`} />
                <Row label="USD Value" value={`$${position.collateralUsd.toFixed(2)}`} />
                <Row label="Max Borrow" value={`$${position.maxBorrowUsdc.toFixed(2)} USDC`} />
                <Row label="Loan Active" value={position.loan.isActive ? "Yes" : "No"} highlight={position.loan.isActive} />
                {position.loan.isActive && (
                  <div className="flex items-center justify-between pt-1">
                    <span className="text-gray-500">Debt (cUSDC)</span>
                    {position.debtUsdc !== null ? (
                      <span className="font-mono text-brand-cyan">${position.debtUsdc.toFixed(2)}</span>
                    ) : (
                      <button
                        onClick={async () => { setDecryptingDebt(true); await position.decryptDebt(); setDecryptingDebt(false); }}
                        disabled={decryptingDebt}
                        className="flex items-center gap-1 text-brand-cyan text-[10px] font-bold hover:opacity-80 disabled:opacity-40"
                      >
                        {decryptingDebt ? <Loader2 size={10} className="animate-spin" /> : <Eye size={10} />}
                        {decryptingDebt ? "…" : "Reveal"}
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Lender position */}
          {position.isLender && (
            <div className="glass p-6 space-y-4 border-brand-blue/20 bg-brand-blue/5">
              <h3 className="font-semibold text-sm flex items-center gap-2">
                <TrendingUp size={16} className="text-brand-blue" />
                My Lend Position
              </h3>
              <div className="space-y-3 text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-gray-500">Deposited (USDC)</span>
                  {position.lenderUsdc !== null ? (
                    <span className="font-mono text-brand-blue font-bold">${position.lenderUsdc.toFixed(2)}</span>
                  ) : (
                    <button
                      onClick={async () => { setDecryptingLend(true); await position.decryptLenderBalance(); setDecryptingLend(false); }}
                      disabled={decryptingLend}
                      className="flex items-center gap-1 text-brand-blue text-[10px] font-bold hover:opacity-80 disabled:opacity-40"
                    >
                      {decryptingLend ? <Loader2 size={10} className="animate-spin" /> : <Eye size={10} />}
                      {decryptingLend ? "Decrypting…" : "Reveal balance"}
                    </button>
                  )}
                </div>
                <Row label="Status" value="Active lender" highlight />
              </div>
            </div>
          )}

          <div className="glass p-6 bg-brand-blue/5 border-brand-blue/20">
            <h4 className="font-medium text-xs mb-3 text-brand-blue uppercase tracking-widest flex items-center gap-2">
              <Lock size={12} /> Privacy Model
            </h4>
            <p className="text-[10px] text-gray-400 leading-relaxed">
              Individual USDC borrow and lend amounts are FHE-encrypted. Only protocol-level collateral totals are public. Amounts are only visible to the position holder via re-encryption.
            </p>
          </div>

          <div className="glass p-6 space-y-4">
            <h4 className="font-semibold text-xs uppercase tracking-wider text-gray-400">Protocol Summary</h4>
            <div className="space-y-3 text-xs">
              <Row label="Total ETH locked" value={`${stats.totalCollateralEth.toFixed(4)} ETH`} />
              <Row label="Collateral value" value={`$${totalCollateralUsd.toLocaleString("en-US", { maximumFractionDigits: 0 })}`} />
              <Row label="Active borrowers" value={String(stats.activeBorrowers)} />
              <Row label="Total lenders" value={String(stats.totalLenders)} />
              <div className="pt-1 border-t border-white/5 text-gray-600">
                <p>USDC totals: <span className="text-brand-cyan font-mono">encrypted</span></p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function MyPositionRow({ position }: { position: ReturnType<typeof useVaultPosition> }) {
  const shortAddr = "You";
  return (
    <tr className="hover:bg-white/5 transition-colors">
      <td className="py-4 font-mono text-xs text-brand-cyan">{shortAddr}</td>
      <td className="py-4 font-semibold text-sm">
        {position.collateralEth.toFixed(4)} <span className="text-gray-500 font-normal">ETH</span>
      </td>
      <td className="py-4 text-sm">
        <span className="flex items-center gap-1.5 text-gray-400 font-mono text-xs">
          <Lock size={10} className="text-brand-cyan" /> Encrypted
        </span>
      </td>
      <td className="py-4">
        {position.loan?.isActive ? (
          <span className="text-brand-cyan text-xs font-mono font-bold">Active</span>
        ) : position.hasCollateral ? (
          <span className="text-yellow-400 text-xs font-mono">Collateral only</span>
        ) : (
          <span className="text-gray-500 text-xs">—</span>
        )}
      </td>
    </tr>
  );
}

function StatCard({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: string; sub?: string }) {
  return (
    <div className="glass p-6 space-y-3 relative overflow-hidden group hover:border-white/20 transition-all shadow-xl">
      <div className="absolute -right-4 -top-4 w-24 h-24 bg-brand-blue/10 blur-3xl opacity-0 group-hover:opacity-100 transition-opacity" />
      <div className="flex items-center gap-2 text-xs text-gray-400 uppercase tracking-widest font-medium">
        {icon} {label}
      </div>
      <p className="text-2xl font-bold tracking-tight">{value}</p>
      {sub && <p className="text-[10px] text-gray-500 font-mono">{sub}</p>}
    </div>
  );
}

function Row({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="flex justify-between">
      <span className="text-gray-500">{label}</span>
      <span className={`font-mono ${highlight ? "text-brand-cyan" : "text-gray-300"}`}>{value}</span>
    </div>
  );
}

