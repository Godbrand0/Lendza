"use client";

import React, { useState } from "react";
import {
  ShieldCheck,
  TrendingUp,
  PieChart,
  Coins,
  Loader2,
  CheckCircle,
  XCircle,
  AlertCircle,
} from "lucide-react";
import { useFhe } from "@/context/FheContext";
import { vaultContract, VAULT_ADDRESS } from "@/lib/contracts";

type TxStatus = "idle" | "encrypting" | "pending" | "success" | "error";

export default function LendPage() {
  const { instance, account, signer } = useFhe();

  const [supplyAmt, setSupplyAmt] = useState("");
  const [status, setStatus] = useState<TxStatus>("idle");
  const [txHash, setTxHash] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const notConnected = !account || !instance;

  const canSubmit =
    !!instance && !!account && !!signer &&
    !!VAULT_ADDRESS &&
    !!supplyAmt && parseFloat(supplyAmt) > 0 &&
    status === "idle";

  async function handleSupply() {
    if (!canSubmit || !instance || !signer || !account) return;

    setStatus("encrypting");
    setErrorMsg(null);
    setTxHash(null);

    try {
      // Step 1 — Encrypt supply amount (USDC, 6 decimals)
      const usdcUnits = BigInt(Math.round(parseFloat(supplyAmt) * 1e6));
      const input = instance.createEncryptedInput(VAULT_ADDRESS, account);
      input.add64(usdcUnits);
      const { handles, inputProof } = await input.encrypt();

      // Step 2 — Send transaction
      setStatus("pending");
      const vault = vaultContract(signer);
      const tx = await vault.depositLiquidity(handles[0], inputProof);

      setTxHash(tx.hash);
      await tx.wait();
      setStatus("success");
      setSupplyAmt("");
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setErrorMsg(msg);
      setStatus("error");
    }
  }

  function handleMax() {
    setSupplyAmt("12450"); // placeholder wallet balance
  }

  return (
    <div className="p-8 max-w-5xl mx-auto space-y-8 animate-in slide-in-from-bottom-4 duration-700">
      <div className="space-y-2">
        <h2 className="text-3xl font-bold tracking-tight">
          Protocol <span className="text-brand-blue">Liquidity</span>
        </h2>
        <p className="text-gray-400 text-sm">
          Supply USDC to earn inflationary rewards and liquidation commissions.
        </p>
      </div>

      {notConnected && (
        <div className="glass p-4 border-yellow-500/20 bg-yellow-500/5 rounded-2xl text-xs text-yellow-300 flex items-center gap-2">
          <AlertCircle size={14} className="text-yellow-400 shrink-0" />
          Connect your wallet to supply liquidity.
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <MarketCard asset="USDC" apy="4.20%" totalApplied="2.4M" utilization="62%" />

        <div className="glass p-8 md:col-span-2 space-y-6 flex flex-col justify-center">
          <div className="flex justify-between items-center px-1">
            <label className="text-xs font-medium text-gray-400 uppercase tracking-wider">
              Supply Amount
            </label>
            <span className="text-[10px] text-gray-500 font-mono italic">
              Wallet Balance: 12,450 USDC
            </span>
          </div>

          <div className="relative">
            <input
              type="number"
              min="0"
              placeholder="1000.00"
              value={supplyAmt}
              onChange={(e) => setSupplyAmt(e.target.value)}
              className="w-full bg-white/5 border border-white/10 rounded-2xl px-6 py-5 focus:outline-none focus:border-brand-blue transition-all font-mono text-2xl"
            />
            <div className="absolute right-6 top-1/2 -translate-y-1/2 flex gap-2">
              <button
                onClick={handleMax}
                className="px-2 py-1 rounded bg-white/10 text-[10px] uppercase font-bold text-gray-400 hover:text-white transition-colors"
              >
                Max
              </button>
              <span className="text-sm font-bold text-brand-blue self-center">USDC</span>
            </div>
          </div>

          {/* Status feedback */}
          {status === "success" && (
            <div className="flex items-start gap-2 text-green-400 text-xs bg-green-400/5 border border-green-400/20 rounded-xl p-3">
              <CheckCircle size={14} className="shrink-0 mt-0.5" />
              <span>
                Liquidity supplied!{" "}
                {txHash && (
                  <a
                    href={`https://sepolia.etherscan.io/tx/${txHash}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline"
                  >
                    View on Etherscan
                  </a>
                )}
              </span>
            </div>
          )}
          {status === "error" && (
            <div className="flex items-start gap-2 text-red-400 text-xs bg-red-400/5 border border-red-400/20 rounded-xl p-3">
              <XCircle size={14} className="shrink-0 mt-0.5" />
              <span className="break-all">{errorMsg}</span>
            </div>
          )}

          <button
            onClick={handleSupply}
            disabled={!canSubmit}
            className="w-full py-5 rounded-2xl bg-linear-to-r from-brand-blue to-brand-cyan text-black font-extrabold text-lg hover:opacity-90 transition-all shadow-[0_0_40px_rgba(79,172,254,0.1)] disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {status === "encrypting" && <><Loader2 size={18} className="animate-spin" /> Encrypting…</>}
            {status === "pending"    && <><Loader2 size={18} className="animate-spin" /> Awaiting confirmation…</>}
            {(status === "idle" || status === "success" || status === "error") && "Supply Liquidity"}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div className="glass p-8 space-y-6">
          <h3 className="font-semibold flex items-center gap-2">
            <TrendingUp size={18} className="text-brand-blue" />
            Reward Multipliers
          </h3>
          <div className="space-y-4">
            <RewardItem label="Base Lending APY" value="2.80%" />
            <RewardItem label="Agent Participation Bonus" value="+1.10%" color="text-brand-cyan" />
            <RewardItem label="Governance Boost" value="+0.30%" color="text-brand-cyan" />
            <div className="pt-2 border-t border-white/5 flex justify-between items-center text-lg font-bold">
              <span>Total Projected Yield</span>
              <span className="text-brand-blue">4.20%</span>
            </div>
          </div>
        </div>

        <div className="glass p-8 space-y-6 bg-brand-blue/5 border-brand-blue/20">
          <div className="flex items-center gap-3">
            <PieChart size={24} className="text-brand-blue" />
            <h3 className="font-semibold">Pool Status</h3>
          </div>
          <div className="space-y-6">
            <div className="flex justify-between text-sm">
              <span className="text-gray-400">Total Value Locked (TVL)</span>
              <span className="font-mono">$4,821,000.00</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-400">Total Borrowed</span>
              <span className="font-mono">$2,989,020.00</span>
            </div>
            <div className="pt-4 space-y-2">
              <div className="flex justify-between text-[10px] uppercase font-bold text-gray-500">
                <span>Utilization Rate</span>
                <span>62.0%</span>
              </div>
              <div className="w-full bg-white/5 h-2 rounded-full">
                <div className="bg-brand-blue h-full w-[62%] rounded-full shadow-[0_0_15px_rgba(79,172,254,0.3)]" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function MarketCard({ asset, apy }: { asset: string; apy: string; totalApplied: string; utilization: string }) {
  return (
    <div className="glass p-8 flex flex-col items-center justify-center space-y-4 border-brand-blue/30 bg-brand-blue/5 shadow-2xl">
      <div className="w-16 h-16 rounded-full bg-white/10 flex items-center justify-center">
        <Coins size={32} className="text-brand-blue" />
      </div>
      <div className="text-center">
        <h3 className="text-2xl font-bold">{asset}</h3>
        <p className="text-[10px] text-gray-500 uppercase tracking-widest">Protocol Pool</p>
      </div>
      <div className="text-center">
        <p className="text-4xl font-extrabold text-brand-blue">{apy}</p>
        <p className="text-[10px] text-gray-500 uppercase font-bold mt-1">APY</p>
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
