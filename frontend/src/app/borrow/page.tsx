"use client";

import React, { useState, useEffect } from "react";
import {
  Lock, AlertCircle, Loader2, CheckCircle, XCircle,
  Clock, Timer, TrendingDown, ShieldCheck, ArrowRight, Info,
} from "lucide-react";
import { parseEther } from "ethers";
import { useFhe } from "@/context/FheContext";
import { vaultContract, mockUsdcContract, VAULT_ADDRESS } from "@/lib/contracts";
import { useVaultPosition } from "@/hooks/useVaultPosition";

type TxStatus = "idle" | "pending" | "encrypting" | "success" | "error";

const DURATION_OPTIONS = [
  { label: "5 min", value: 5 },
  { label: "10 min", value: 10 },
  { label: "30 min", value: 30 },
  { label: "1 hour", value: 60 },
];

const INTEREST_BPS_PER_MINUTE = 100; // 1%/min demo

function calcInterest(principal: number, durationMinutes: number) {
  return (principal * INTEREST_BPS_PER_MINUTE * durationMinutes) / 10_000;
}

function formatCountdown(secondsLeft: number) {
  if (secondsLeft <= 0) return "Overdue";
  const m = Math.floor(secondsLeft / 60);
  const s = secondsLeft % 60;
  return `${m}m ${s.toString().padStart(2, "0")}s`;
}

export default function BorrowPage() {
  const { instance, account, signer } = useFhe();
  const position = useVaultPosition();

  // Collateral step
  const [collateralEth, setCollateralEth] = useState("");
  const [collateralStatus, setCollateralStatus] = useState<TxStatus>("idle");
  const [collateralTxHash, setCollateralTxHash] = useState<string | null>(null);
  const [collateralError, setCollateralError] = useState<string | null>(null);

  // Borrow step
  const [borrowAmt, setBorrowAmt] = useState("");
  const [durationMinutes, setDurationMinutes] = useState(10);
  const [borrowStatus, setBorrowStatus] = useState<TxStatus>("idle");
  const [borrowTxHash, setBorrowTxHash] = useState<string | null>(null);
  const [borrowError, setBorrowError] = useState<string | null>(null);

  // Repay step
  const [repayStatus, setRepayStatus] = useState<TxStatus>("idle");
  const [repayTxHash, setRepayTxHash] = useState<string | null>(null);
  const [repayError, setRepayError] = useState<string | null>(null);

  // Countdown
  const [countdown, setCountdown] = useState<number | null>(null);

  useEffect(() => {
    if (collateralStatus === "success" || borrowStatus === "success" || repayStatus === "success") position.refresh();
  }, [collateralStatus, borrowStatus, repayStatus]); // eslint-disable-line

  useEffect(() => {
    if (!position.loan?.isActive || !position.loan.dueTime) { setCountdown(null); return; }
    const tick = () => setCountdown(position.loan!.dueTime - Math.floor(Date.now() / 1000));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [position.loan?.isActive, position.loan?.dueTime]); // eslint-disable-line

  // principal and totalDue come from getMyTotalDue() via signer (msg.sender scoped)
  const knownDebt = position.principal;
  const elapsedMinutes = position.loan?.isActive && position.loan.startTime
    ? Math.floor((Date.now() / 1000 - position.loan.startTime) / 60)
    : 0;
  // Use chain value when available; fall back to frontend estimate while loading.
  const totalDue = position.totalDue ?? (knownDebt !== null ? knownDebt + calcInterest(knownDebt, elapsedMinutes) : null);

  async function handleRepay() {
    if (!signer || !account || !VAULT_ADDRESS) return;
    setRepayStatus("encrypting"); // reuse state label for "approving"
    setRepayError(null);
    setRepayTxHash(null);
    try {
      // Re-fetch totalDue fresh at repay time — the stale page-load value may
      // be lower than what the contract will compute (interest accrues by minute).
      const vault = vaultContract(signer);
      const freshDue = await vault.getMyTotalDue();
      const freshPrincipal = Number(freshDue[1]);   // USDC units (6 decimals)
      const freshTotal     = Number(freshDue[0]);   // principal + current interest

      // Add 5 minutes of buffer so the approval covers the approve tx confirmation window.
      const INTEREST_PER_MIN_BPS = 100;
      const buffer = Math.ceil((freshPrincipal * INTEREST_PER_MIN_BPS * 5) / 10_000);
      const usdcUnits = BigInt(freshTotal + buffer);

      // Step 1: approve vault to spend totalDue + buffer USDC
      const usdc = mockUsdcContract(signer);
      const approveTx = await usdc.approve(VAULT_ADDRESS, usdcUnits);
      await approveTx.wait();

      // Step 2: repay — vault pulls USDC and releases ETH
      setRepayStatus("pending");
      const tx = await vault.repay();
      setRepayTxHash(tx.hash);
      await tx.wait();
      setRepayStatus("success");
      position.clearDecrypted();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setRepayError(msg.includes("LoanOverdue") ? "Loan is overdue — repay is locked. Position is eligible for liquidation." : msg);
      setRepayStatus("error");
    }
  }

  const canRepay = !!signer && !!account && position.loan?.isActive
    && !position.loan.isOverdue && repayStatus === "idle";

  // Derived
  const principal = parseFloat(borrowAmt) || 0;
  const interest = principal > 0 ? calcInterest(principal, durationMinutes) : 0;
  const totalRepay = principal + interest;
  const collateralUsdPreview = (parseFloat(collateralEth) || 0) * 3000;
  const maxBorrow = position.maxBorrowUsdc;
  const overLimit = principal > maxBorrow && maxBorrow > 0;
  const ltv = position.collateralUsd > 0 ? ((principal / position.collateralUsd) * 100).toFixed(1) : null;

  const notConnected = !account || !instance;
  const canDeposit = !!signer && !!collateralEth && parseFloat(collateralEth) > 0
    && collateralStatus === "idle";
  const canBorrow = !!signer && !!account && !!instance && position.hasCollateral
    && !position.loan?.isActive && principal > 0 && !overLimit && borrowStatus === "idle";

  async function handleDepositCollateral() {
    if (!signer || !collateralEth) return;
    setCollateralStatus("pending");
    setCollateralError(null);
    setCollateralTxHash(null);
    try {
      const vault = vaultContract(signer);
      const tx = await vault.depositCollateral({ value: parseEther(collateralEth) });
      setCollateralTxHash(tx.hash);
      await tx.wait();
      setCollateralStatus("success");
      setCollateralEth("");
    } catch (e: unknown) {
      setCollateralError(e instanceof Error ? e.message : String(e));
      setCollateralStatus("error");
    }
  }

  async function handleBorrow() {
    if (!signer || !account || !instance || !VAULT_ADDRESS || !borrowAmt) return;
    setBorrowStatus("encrypting");
    setBorrowError(null);
    setBorrowTxHash(null);
    try {
      const usdcUnits = BigInt(Math.round(principal * 1e6));

      // FHE-encrypt the borrow amount before it hits the chain
      const input = instance.createEncryptedInput(VAULT_ADDRESS, account);
      input.add64(usdcUnits);
      const { handles, inputProof } = await input.encrypt();

      setBorrowStatus("pending");
      const vault = vaultContract(signer);
      const tx = await vault.borrow(handles[0], inputProof, usdcUnits, BigInt(durationMinutes));
      setBorrowTxHash(tx.hash);
      await tx.wait();
      setBorrowStatus("success");
      position.clearDecrypted();
    } catch (e: unknown) {
      setBorrowError(e instanceof Error ? e.message : String(e));
      setBorrowStatus("error");
    }
  }

  return (
    <div className="p-8 max-w-4xl mx-auto space-y-8 animate-in slide-in-from-bottom-4 duration-700">
      <div className="space-y-2">
        <h2 className="text-3xl font-bold tracking-tight">
          Confidential <span className="text-brand-cyan">Borrowing</span>
        </h2>
        <p className="text-gray-400 text-sm">
          Deposit Sepolia ETH as collateral, then borrow encrypted USDC up to 66% LTV.
        </p>
      </div>

      {notConnected && (
        <div className="glass p-4 border-yellow-500/20 bg-yellow-500/5 rounded-2xl text-xs text-yellow-300 flex items-center gap-2">
          <AlertCircle size={14} className="text-yellow-400 shrink-0" />
          Connect your wallet to continue.
        </div>
      )}

      {/* Active loan countdown */}
      {position.loan?.isActive && countdown !== null && (
        <div className={`glass p-5 rounded-2xl flex items-center gap-4 ${position.loan.isOverdue ? "border-red-500/30 bg-red-500/5" : "border-brand-cyan/20 bg-brand-cyan/5"}`}>
          <Timer size={28} className={position.loan.isOverdue ? "text-red-400" : "text-brand-cyan"} />
          <div className="flex-1">
            <p className="text-xs text-gray-400 uppercase tracking-wider font-bold">Active Loan — Time Remaining</p>
            <p className={`text-2xl font-mono font-bold mt-1 ${position.loan.isOverdue ? "text-red-400" : "text-brand-cyan"}`}>
              {formatCountdown(countdown)}
            </p>
          </div>
          <div className="text-right text-xs space-y-1">
            <p className="text-gray-500">Collateral locked</p>
            <p className="font-mono text-white">{position.collateralEth.toFixed(4)} ETH</p>
            <p className="text-gray-600">Due {new Date(position.loan.dueTime * 1000).toLocaleTimeString()}</p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_1fr] gap-4 items-start">

        {/* ── Step 1: Deposit Collateral ── */}
        <div className="glass p-8 space-y-5 transition-all">
          <div className="flex items-center gap-3">
            <span className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-black shrink-0 ${position.hasCollateral ? "bg-green-500 text-black" : "bg-white/10 text-white"}`}>
              {position.hasCollateral ? <CheckCircle size={14} /> : "1"}
            </span>
            <h3 className="font-bold text-base">Deposit Collateral</h3>
          </div>

          {/* Current balance — always visible once deposited */}
          {position.hasCollateral && (
            <div className="flex items-center justify-between p-3 rounded-xl bg-green-500/10 border border-green-500/20">
              <div className="flex items-center gap-2">
                <ShieldCheck size={16} className="text-green-400 shrink-0" />
                <span className="text-xs text-gray-400">Locked</span>
              </div>
              <div className="text-right">
                <p className="font-mono font-bold text-green-400 text-sm">{position.collateralEth.toFixed(4)} ETH</p>
                <p className="text-[10px] text-gray-500">≈ ${position.collateralUsd.toFixed(2)}</p>
              </div>
            </div>
          )}

          {/* Deposit / top-up form — always shown */}
          <div className="space-y-2">
            <label className="text-xs text-gray-400 uppercase tracking-wider font-medium px-1 block">
              {position.hasCollateral ? "Add More ETH" : "Amount (Sepolia ETH)"}
            </label>
            <div className="relative">
              <input
                type="number" min="0" step="0.01" placeholder="0.05"
                value={collateralEth}
                onChange={(e) => setCollateralEth(e.target.value)}
                className="w-full bg-white/5 border border-white/10 rounded-2xl px-6 py-4 focus:outline-none focus:border-brand-cyan transition-all font-mono text-lg"
              />
              <span className="absolute right-6 top-1/2 -translate-y-1/2 text-xs text-gray-500 font-bold">ETH</span>
            </div>
            {collateralUsdPreview > 0 && (
              <p className="text-[10px] text-gray-500 px-1">
                {position.hasCollateral
                  ? <>New total: <span className="text-brand-cyan font-mono">{(position.collateralEth + parseFloat(collateralEth || "0")).toFixed(4)} ETH</span> · Max borrow: <span className="text-brand-cyan font-mono">${((position.collateralUsd + collateralUsdPreview) * 0.66).toFixed(2)}</span></>
                  : <>≈ ${collateralUsdPreview.toLocaleString()} · Max borrow: <span className="text-brand-cyan font-mono">${(collateralUsdPreview * 0.66).toFixed(2)}</span></>
                }
              </p>
            )}
          </div>
          <TxFeedback status={collateralStatus} txHash={collateralTxHash} errorMsg={collateralError} successMsg="Collateral deposited!" />
          <button onClick={handleDepositCollateral} disabled={!canDeposit}
            className="w-full py-4 rounded-2xl bg-white text-black font-bold text-sm hover:shadow-[0_0_30px_rgba(255,255,255,0.15)] transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2">
            {collateralStatus === "pending" ? <><Loader2 size={16} className="animate-spin" /> Confirming…</> : position.hasCollateral ? "Add Collateral" : "Deposit ETH"}
          </button>
        </div>

        {/* Divider */}
        <div className="hidden md:flex items-center justify-center pt-20">
          <ArrowRight size={20} className="text-gray-600" />
        </div>

        {/* ── Step 2: Borrow USDC ── */}
        <div className={`glass p-8 space-y-5 transition-all ${!position.hasCollateral ? "opacity-40 pointer-events-none" : ""}`}>
          <div className="flex items-center gap-3">
            <span className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-black shrink-0 ${position.loan?.isActive ? "bg-green-500 text-black" : "bg-white/10 text-white"}`}>
              {position.loan?.isActive ? <CheckCircle size={14} /> : "2"}
            </span>
            <h3 className="font-bold text-base">Borrow USDC</h3>
            {position.hasCollateral && !position.loan?.isActive && (
              <span className="text-[9px] text-brand-cyan flex items-center gap-1 font-mono uppercase font-bold ml-auto">
                <Lock size={9} /> Encrypted
              </span>
            )}
          </div>

          {position.loan?.isActive ? (
            <div className="text-center py-4 space-y-1">
              <CheckCircle size={32} className="mx-auto text-brand-cyan" />
              <p className="font-bold text-brand-cyan">Loan active</p>
              <p className="text-xs text-gray-500">Repay before the timer expires to reclaim your ETH</p>
            </div>
          ) : (
            <>
              {/* Max borrow info bar */}
              {position.hasCollateral && (
                <div className="flex items-center gap-2 bg-white/5 rounded-xl p-3 text-xs">
                  <Info size={12} className="text-brand-cyan shrink-0" />
                  <span className="text-gray-400">
                    Max borrowable: <span className="text-brand-cyan font-mono font-bold">${maxBorrow.toFixed(2)} USDC</span>
                    {" "}(66% of ${position.collateralUsd.toFixed(2)} collateral)
                  </span>
                </div>
              )}

              {/* Borrow amount */}
              <div className="space-y-2">
                <label className="text-xs text-gray-400 uppercase tracking-wider font-medium px-1 block">
                  Borrow Amount (USDC)
                </label>
                <div className="grid grid-cols-4 gap-2">
                  {[25, 50, 75, 100].map((pct) => {
                    const amt = Math.floor(maxBorrow * pct / 100);
                    return (
                      <button key={pct} onClick={() => setBorrowAmt(String(amt))}
                        disabled={maxBorrow === 0}
                        className={`py-2 rounded-xl text-xs font-bold transition-all border ${borrowAmt === String(amt) ? "bg-brand-cyan/20 border-brand-cyan text-brand-cyan" : "bg-white/5 border-white/10 text-gray-400 hover:border-white/30"} disabled:opacity-30`}>
                        {pct}%
                      </button>
                    );
                  })}
                </div>
                <div className="relative">
                  <input
                    type="number" min="0" placeholder="0"
                    value={borrowAmt}
                    onChange={(e) => setBorrowAmt(e.target.value)}
                    className={`w-full bg-white/5 border rounded-2xl px-6 py-4 focus:outline-none transition-all font-mono text-lg ${overLimit ? "border-red-500/50 focus:border-red-500" : "border-white/10 focus:border-brand-cyan"}`}
                  />
                  <span className="absolute right-6 top-1/2 -translate-y-1/2 text-xs text-gray-500 font-bold">USDC</span>
                </div>
                {overLimit && (
                  <p className="text-[10px] text-red-400 px-1 flex items-center gap-1">
                    <AlertCircle size={10} /> Exceeds max borrowable (${maxBorrow.toFixed(2)})
                  </p>
                )}
                {ltv && !overLimit && (
                  <div className="space-y-1 px-1">
                    <div className="flex justify-between text-[10px]">
                      <span className="text-gray-500">LTV</span>
                      <span className={`font-mono ${parseFloat(ltv) > 55 ? "text-yellow-400" : "text-brand-cyan"}`}>{ltv}%</span>
                    </div>
                    <div className="w-full bg-white/5 h-1 rounded-full overflow-hidden">
                      <div className={`h-full transition-all ${parseFloat(ltv) > 55 ? "bg-yellow-400" : "bg-brand-cyan"}`}
                        style={{ width: `${Math.min(parseFloat(ltv) / 66 * 100, 100)}%` }} />
                    </div>
                  </div>
                )}
              </div>

              {/* Duration */}
              <div className="space-y-2">
                <label className="text-xs text-gray-400 uppercase tracking-wider font-medium px-1 flex items-center gap-1.5">
                  <Clock size={11} /> Loan Duration
                </label>
                <div className="grid grid-cols-4 gap-2">
                  {DURATION_OPTIONS.map((opt) => (
                    <button key={opt.value} onClick={() => setDurationMinutes(opt.value)}
                      className={`py-2 rounded-xl text-xs font-bold transition-all border ${durationMinutes === opt.value ? "bg-brand-cyan/20 border-brand-cyan text-brand-cyan" : "bg-white/5 border-white/10 text-gray-400 hover:border-white/30"}`}>
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Loan summary */}
              {principal > 0 && !overLimit && (
                <div className="bg-white/3 rounded-xl p-4 space-y-2 text-xs border border-white/5">
                  <SummaryRow label="Principal" value={`$${principal.toLocaleString(undefined, { maximumFractionDigits: 2 })} USDC`} />
                  <SummaryRow label={`Interest (${durationMinutes}min × 1%/min)`} value={`+$${interest.toFixed(2)}`} highlight />
                  <div className="border-t border-white/5 pt-2 flex justify-between font-bold">
                    <span className="text-gray-300">Total to repay</span>
                    <span className="text-brand-cyan font-mono">${totalRepay.toFixed(2)} USDC</span>
                  </div>
                </div>
              )}

              <TxFeedback status={borrowStatus} txHash={borrowTxHash} errorMsg={borrowError} successMsg="Loan issued!" />

              <button onClick={handleBorrow} disabled={!canBorrow}
                className="w-full py-4 rounded-2xl bg-brand-cyan text-black font-bold text-sm hover:opacity-90 transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2">
                {borrowStatus === "encrypting" && <><Loader2 size={16} className="animate-spin" /> Encrypting…</>}
                {borrowStatus === "pending" && <><Loader2 size={16} className="animate-spin" /> Confirming…</>}
                {(borrowStatus === "idle" || borrowStatus === "success" || borrowStatus === "error") && (
                  <><TrendingDown size={16} /> Borrow USDC</>
                )}
              </button>
            </>
          )}
        </div>
      </div>

      {/* ── Repay Panel — shown when loan is active ── */}
      {position.loan?.isActive && (
        <div className={`glass p-8 space-y-5 ${position.loan.isOverdue ? "border-red-500/30 bg-red-500/5" : "border-brand-cyan/20 bg-brand-cyan/5"}`}>
          <div className="flex items-center gap-3">
            <ShieldCheck size={20} className={position.loan.isOverdue ? "text-red-400" : "text-brand-cyan"} />
            <h3 className="font-bold text-base">
              {position.loan.isOverdue ? "Loan Overdue — Repay Locked" : "Repay Loan"}
            </h3>
          </div>

          {position.loan.isOverdue ? (
            <div className="flex items-start gap-2 text-red-400 text-xs bg-red-400/5 border border-red-400/20 rounded-xl p-4">
              <AlertCircle size={14} className="shrink-0 mt-0.5" />
              <span>Your loan term has expired. Repay is blocked. A monitor agent may submit your position for liquidation — your collateral will be auctioned and the debt wiped.</span>
            </div>
          ) : (
            <>
              <div className="space-y-3 text-sm">
                {knownDebt === null ? (
                  <div className="flex items-center gap-2 p-3 rounded-xl bg-white/5 border border-white/10 text-xs text-gray-400">
                    <Loader2 size={12} className="animate-spin text-brand-cyan shrink-0" />
                    <span>Loading repayment amount…</span>
                  </div>
                ) : (
                  <div className="bg-white/3 rounded-xl p-4 space-y-2 text-xs border border-white/5">
                    <SummaryRow label="Principal borrowed" value={`$${knownDebt.toLocaleString(undefined, { maximumFractionDigits: 2 })} USDC`} />
                    <SummaryRow label={`Interest accrued (~${elapsedMinutes} min × 1%/min)`} value={`+$${calcInterest(knownDebt, elapsedMinutes).toFixed(2)}`} highlight />
                    <div className="border-t border-white/5 pt-2 flex justify-between font-bold">
                      <span className="text-gray-300">Total to repay</span>
                      <span className="text-brand-cyan font-mono">${totalDue!.toFixed(2)} USDC</span>
                    </div>
                  </div>
                )}

                <TxFeedback status={repayStatus} txHash={repayTxHash} errorMsg={repayError} successMsg="Loan repaid! Collateral released." />

                <div className="flex gap-3">
                  {knownDebt === null && (
                    <button
                      onClick={() => position.decryptDebt()}
                      disabled={!instance || !signer}
                      className="flex-1 py-4 rounded-2xl bg-white/10 border border-white/20 text-white font-bold text-sm hover:bg-white/15 transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                    >
                      <Lock size={16} /> Reveal Debt
                    </button>
                  )}
                  <button
                    onClick={handleRepay}
                    disabled={!canRepay}
                    className="flex-1 py-4 rounded-2xl bg-brand-cyan text-black font-bold text-sm hover:opacity-90 transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                  >
                    {repayStatus === "encrypting" && <><Loader2 size={16} className="animate-spin" /> Approving USDC…</>}
                    {repayStatus === "pending" && <><Loader2 size={16} className="animate-spin" /> Repaying…</>}
                    {(repayStatus === "idle" || repayStatus === "success" || repayStatus === "error") && <><ShieldCheck size={16} /> Repay & Reclaim ETH</>}
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* Steps */}
      <div className="glass p-6 grid grid-cols-1 sm:grid-cols-4 gap-4">
        {[
          "Deposit Sepolia ETH — locked as encrypted collateral in the vault.",
          "Select USDC amount up to 66% LTV. Presets calculate from your collateral.",
          "Borrow amount is FHE-encrypted before it hits the chain.",
          "Repay before the timer expires. Late positions can be liquidated.",
        ].map((t, i) => (
          <div key={i} className="flex gap-3 items-start">
            <span className="w-5 h-5 rounded-full bg-white/10 flex items-center justify-center text-[10px] font-bold shrink-0 mt-0.5">{i + 1}</span>
            <p className="text-[11px] text-gray-400 leading-normal">{t}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function SummaryRow({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="flex justify-between">
      <span className="text-gray-500">{label}</span>
      <span className={`font-mono ${highlight ? "text-yellow-400" : "text-gray-300"}`}>{value}</span>
    </div>
  );
}

function TxFeedback({ status, txHash, errorMsg, successMsg }: {
  status: TxStatus; txHash: string | null; errorMsg: string | null; successMsg: string;
}) {
  if (status === "idle") return null;
  if (status === "success") return (
    <div className="flex items-start gap-2 text-green-400 text-xs bg-green-400/5 border border-green-400/20 rounded-xl p-3">
      <CheckCircle size={14} className="shrink-0 mt-0.5" />
      <span>{successMsg}{" "}{txHash && <a href={`https://sepolia.etherscan.io/tx/${txHash}`} target="_blank" rel="noopener noreferrer" className="underline">View tx</a>}</span>
    </div>
  );
  if (status === "error") return (
    <div className="flex items-start gap-2 text-red-400 text-xs bg-red-400/5 border border-red-400/20 rounded-xl p-3">
      <XCircle size={14} className="shrink-0 mt-0.5" />
      <span className="break-all">{errorMsg}</span>
    </div>
  );
  return null;
}
