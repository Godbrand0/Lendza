"use client";

import React, { useState } from "react";
import {
  ShieldCheck, TrendingUp, PieChart, Coins,
  Loader2, CheckCircle, XCircle, AlertCircle, Lock, Eye,
} from "lucide-react";
import { useFhe } from "@/context/FheContext";
import { vaultContract, VAULT_ADDRESS } from "@/lib/contracts";
import { useVaultPosition } from "@/hooks/useVaultPosition";
import { useProtocolStats } from "@/hooks/useProtocolStats";

type TxStatus = "idle" | "encrypting" | "pending" | "success" | "error";

// Static APY model: base 2.8% + utilization-scaled bonus up to 4.2%
const BASE_APY = 2.8;
const MAX_BONUS = 1.4;
const MAX_BORROWERS = 20; // expected max for demo

export default function LendPage() {
  const { instance, account, signer } = useFhe();
  const position = useVaultPosition();
  const stats = useProtocolStats();

  const [supplyAmt, setSupplyAmt] = useState("");
  const [status, setStatus] = useState<TxStatus>("idle");
  const [txHash, setTxHash] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isDecrypting, setIsDecrypting] = useState(false);

  const notConnected = !account || !instance;

  // Dynamic APY based on utilization (borrowers / expected max)
  const utilization = Math.min(stats.activeBorrowers / Math.max(MAX_BORROWERS, 1), 1);
  const apy = BASE_APY + MAX_BONUS * utilization;

  const canSubmit =
    !!instance && !!account && !!signer && !!VAULT_ADDRESS &&
    !!supplyAmt && parseFloat(supplyAmt) > 0 && status === "idle";

  async function handleSupply() {
    if (!canSubmit || !instance || !signer || !account) return;
    setStatus("encrypting");
    setErrorMsg(null);
    setTxHash(null);
    try {
      const usdcUnits = BigInt(Math.round(parseFloat(supplyAmt) * 1e6));
      const input = instance.createEncryptedInput(VAULT_ADDRESS, account);
      input.add64(usdcUnits);
      const { handles, inputProof } = await input.encrypt();

      setStatus("pending");
      const vault = vaultContract(signer);
      const tx = await vault.depositLiquidity(handles[0], inputProof);
      setTxHash(tx.hash);
      await tx.wait();
      setStatus("success");
      setSupplyAmt("");
      // Clear stale cached balance, refresh plaintext state, then auto-decrypt
      // so the updated total shows immediately without needing another click.
      position.clearDecrypted();
      await position.refresh();
      setIsDecrypting(true);
      try {
        await position.decryptLenderBalance();
      } finally {
        setIsDecrypting(false);
      }
    } catch (e: unknown) {
      setErrorMsg(e instanceof Error ? e.message : String(e));
      setStatus("error");
    }
  }

  async function handleRevealBalance() {
    setIsDecrypting(true);
    try {
      await position.decryptLenderBalance();
    } finally {
      setIsDecrypting(false);
    }
  }

  return (
    <div className="p-8 max-w-5xl mx-auto space-y-8 animate-in slide-in-from-bottom-4 duration-700">
      <div className="space-y-2">
        <h2 className="text-3xl font-bold tracking-tight">
          Protocol <span className="text-brand-blue">Liquidity</span>
        </h2>
        <p className="text-gray-400 text-sm">
          Supply Zama confidential USDC. Borrowers draw from your deposit — amounts stay encrypted end-to-end.
        </p>
      </div>

      {notConnected && (
        <div className="glass p-4 border-yellow-500/20 bg-yellow-500/5 rounded-2xl text-xs text-yellow-300 flex items-center gap-2">
          <AlertCircle size={14} className="text-yellow-400 shrink-0" />
          Connect your wallet to supply liquidity.
        </div>
      )}

      {/* My deposit banner */}
      {account && (
        <div className="glass p-5 rounded-2xl border-brand-blue/20 bg-brand-blue/5 flex items-center gap-4">
          <ShieldCheck size={28} className="text-brand-blue shrink-0" />
          <div className="flex-1 space-y-1">
            <p className="text-xs text-gray-400 uppercase tracking-wider font-bold">Your Deposited Balance</p>
            {position.lenderUsdc !== null ? (
              <p className="text-2xl font-bold font-mono text-brand-blue">
                ${position.lenderUsdc.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDC
              </p>
            ) : (
              <p className="text-sm text-gray-500 flex items-center gap-2">
                <Lock size={12} className="text-brand-blue" /> Encrypted — click reveal to view
              </p>
            )}
          </div>
          <button
            onClick={handleRevealBalance}
            disabled={isDecrypting || !instance || !signer}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-brand-blue/20 border border-brand-blue/30 text-brand-blue text-xs font-bold hover:bg-brand-blue/30 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {isDecrypting ? <Loader2 size={14} className="animate-spin" /> : <Eye size={14} />}
            {isDecrypting ? "Decrypting…" : "Reveal"}
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Market card */}
        <div className="glass p-8 flex flex-col items-center justify-center space-y-4 border-brand-blue/30 bg-brand-blue/5 shadow-2xl">
          <div className="w-16 h-16 rounded-full bg-white/10 flex items-center justify-center">
            <Coins size={32} className="text-brand-blue" />
          </div>
          <div className="text-center">
            <h3 className="text-2xl font-bold">USDC</h3>
            <p className="text-[10px] text-gray-500 uppercase tracking-widest">Zama cUSDC Pool</p>
          </div>
          <div className="text-center">
            <p className="text-4xl font-extrabold text-brand-blue">{apy.toFixed(2)}%</p>
            <p className="text-[10px] text-gray-500 uppercase font-bold mt-1">Current APY</p>
          </div>
          <div className="w-full text-center text-[10px] text-gray-600">
            {stats.activeBorrowers} active borrower{stats.activeBorrowers !== 1 ? "s" : ""}
          </div>
        </div>

        {/* Supply form */}
        <div className="glass p-8 md:col-span-2 space-y-6 flex flex-col justify-center">
          <div className="flex justify-between items-center px-1">
            <label className="text-xs font-medium text-gray-400 uppercase tracking-wider">
              Supply Amount (Zama USDC)
            </label>
            <span className="text-[10px] text-brand-blue font-mono font-bold uppercase tracking-wide flex items-center gap-1">
              <Lock size={9} /> FHE Encrypted
            </span>
          </div>

          <div className="relative">
            <input
              type="number" min="0" placeholder="1000.00"
              value={supplyAmt}
              onChange={(e) => setSupplyAmt(e.target.value)}
              className="w-full bg-white/5 border border-white/10 rounded-2xl px-6 py-5 focus:outline-none focus:border-brand-blue transition-all font-mono text-2xl"
            />
            <span className="text-sm font-bold text-brand-blue absolute right-6 top-1/2 -translate-y-1/2">USDC</span>
          </div>

          {/* Yield preview */}
          {parseFloat(supplyAmt) > 0 && (
            <div className="bg-white/3 border border-white/5 rounded-xl p-4 space-y-2 text-xs">
              <div className="flex justify-between">
                <span className="text-gray-500">Supply</span>
                <span className="font-mono text-gray-300">${parseFloat(supplyAmt).toLocaleString()} USDC</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">APY</span>
                <span className="font-mono text-brand-blue">{apy.toFixed(2)}%</span>
              </div>
              <div className="border-t border-white/5 pt-2 flex justify-between font-bold">
                <span className="text-gray-300">Est. yearly yield</span>
                <span className="text-brand-blue font-mono">
                  ${(parseFloat(supplyAmt) * apy / 100).toFixed(2)}
                </span>
              </div>
            </div>
          )}

          {status === "success" && (
            <div className="flex items-start gap-2 text-green-400 text-xs bg-green-400/5 border border-green-400/20 rounded-xl p-3">
              <CheckCircle size={14} className="shrink-0 mt-0.5" />
              <span>
                Liquidity supplied!{" "}
                {txHash && <a href={`https://sepolia.etherscan.io/tx/${txHash}`} target="_blank" rel="noopener noreferrer" className="underline">View on Etherscan</a>}
              </span>
            </div>
          )}
          {status === "error" && (
            <div className="flex items-start gap-2 text-red-400 text-xs bg-red-400/5 border border-red-400/20 rounded-xl p-3">
              <XCircle size={14} className="shrink-0 mt-0.5" />
              <span className="break-all">{errorMsg}</span>
            </div>
          )}

          <button onClick={handleSupply} disabled={!canSubmit}
            className="w-full py-5 rounded-2xl bg-linear-to-r from-brand-blue to-brand-cyan text-black font-extrabold text-lg hover:opacity-90 transition-all shadow-[0_0_40px_rgba(79,172,254,0.1)] disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2">
            {status === "encrypting" && <><Loader2 size={18} className="animate-spin" /> Encrypting…</>}
            {status === "pending" && <><Loader2 size={18} className="animate-spin" /> Confirming…</>}
            {(status === "idle" || status === "success" || status === "error") && "Supply Liquidity"}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div className="glass p-8 space-y-6">
          <h3 className="font-semibold flex items-center gap-2">
            <TrendingUp size={18} className="text-brand-blue" />
            Reward Breakdown
          </h3>
          <div className="space-y-4">
            <RewardItem label="Base Lending APY" value={`${BASE_APY.toFixed(2)}%`} />
            <RewardItem label="Utilization Bonus" value={`+${(MAX_BONUS * utilization).toFixed(2)}%`} color="text-brand-cyan" />
            <div className="pt-2 border-t border-white/5 flex justify-between items-center text-lg font-bold">
              <span>Total APY</span>
              <span className="text-brand-blue">{apy.toFixed(2)}%</span>
            </div>
          </div>
        </div>

        <div className="glass p-8 space-y-6 bg-brand-blue/5 border-brand-blue/20">
          <div className="flex items-center gap-3">
            <PieChart size={24} className="text-brand-blue" />
            <h3 className="font-semibold">Pool Status</h3>
          </div>
          <div className="space-y-4 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-400">Total ETH collateral</span>
              <span className="font-mono">{stats.totalCollateralEth.toFixed(4)} ETH</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-400">Active borrowers</span>
              <span className="font-mono">{stats.activeBorrowers}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-400">Total lenders</span>
              <span className="font-mono">{stats.totalLenders}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-400">USDC totals</span>
              <span className="flex items-center gap-1 text-brand-cyan text-xs font-mono">
                <Lock size={10} /> FHE encrypted
              </span>
            </div>
            <div className="pt-2 space-y-2">
              <div className="flex justify-between text-[10px] uppercase font-bold text-gray-500">
                <span>Utilization</span>
                <span>{(utilization * 100).toFixed(1)}%</span>
              </div>
              <div className="w-full bg-white/5 h-2 rounded-full">
                <div className="bg-brand-blue h-full rounded-full shadow-[0_0_15px_rgba(79,172,254,0.3)] transition-all"
                  style={{ width: `${utilization * 100}%` }} />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function RewardItem({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="flex justify-between items-center text-sm">
      <span className="text-gray-400 text-xs">{label}</span>
      <span className={`font-mono font-bold ${color ?? ""}`}>{value}</span>
    </div>
  );
}
