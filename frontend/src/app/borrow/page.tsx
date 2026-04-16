"use client";

import React, { useState } from "react";
import {
  TrendingDown,
  Lock,
  AlertCircle,
  ArrowRight,
  ShieldQuestion,
  Loader2,
  CheckCircle,
  XCircle,
} from "lucide-react";
import { parseEther } from "ethers";
import { useFhe } from "@/context/FheContext";
import { vaultContract, VAULT_ADDRESS } from "@/lib/contracts";

type TxStatus = "idle" | "encrypting" | "pending" | "success" | "error";

export default function BorrowPage() {
  const { instance, account, signer } = useFhe();

  const [collateral, setCollateral] = useState("");
  const [borrowAmt, setBorrowAmt] = useState("");
  const [status, setStatus] = useState<TxStatus>("idle");
  const [txHash, setTxHash] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Derive LTV preview (plaintext only — for UI display, not on-chain logic)
  const ltv = (() => {
    const c = parseFloat(collateral);
    const b = parseFloat(borrowAmt);
    if (!c || !b || c === 0) return null;
    const ethUsd = 3000; // display-only estimate
    return ((b / (c * ethUsd)) * 100).toFixed(1);
  })();

  const canSubmit =
    !!instance && !!account && !!signer &&
    !!VAULT_ADDRESS &&
    !!collateral && !!borrowAmt &&
    status === "idle";

  async function handleBorrow() {
    if (!canSubmit || !instance || !signer || !account) return;

    setStatus("encrypting");
    setErrorMsg(null);
    setTxHash(null);

    try {
      // Step 1 — Encrypt the borrow amount (USDC, 6 decimals)
      const usdcUnits = BigInt(Math.round(parseFloat(borrowAmt) * 1e6));
      const input = instance.createEncryptedInput(VAULT_ADDRESS, account);
      input.add64(usdcUnits);
      const { handles, inputProof } = await input.encrypt();

      // Step 2 — Send transaction
      setStatus("pending");
      const vault = vaultContract(signer);
      const tx = await vault.borrow(handles[0], inputProof, {
        value: parseEther(collateral),
      });

      setTxHash(tx.hash);
      await tx.wait();
      setStatus("success");
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setErrorMsg(msg);
      setStatus("error");
    }
  }

  const notConnected = !account || !instance;

  return (
    <div className="p-8 max-w-4xl mx-auto space-y-8 animate-in slide-in-from-bottom-4 duration-700">
      <div className="space-y-2">
        <h2 className="text-3xl font-bold tracking-tight">
          Confidential <span className="text-brand-cyan">Borrowing</span>
        </h2>
        <p className="text-gray-400 text-sm">
          Initiate loans inside the Zama FHE coprocessor. Your metrics remain private.
        </p>
      </div>

      {notConnected && (
        <div className="glass p-4 border-yellow-500/20 bg-yellow-500/5 rounded-2xl text-xs text-yellow-300 flex items-center gap-2">
          <AlertCircle size={14} className="text-yellow-400 shrink-0" />
          Connect your wallet to enable encrypted borrowing.
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        {/* Borrow Form */}
        <div className="glass p-8 space-y-6">
          <InputGroup
            label="Deposit Collateral (ETH)"
            placeholder="2.0"
            value={collateral}
            onChange={setCollateral}
            unit="ETH"
          />
          <div className="flex justify-center -my-2 text-gray-600">
            <ArrowRight size={20} className="rotate-90" />
          </div>
          <InputGroup
            label="Borrow Amount (USDC)"
            placeholder="5000"
            value={borrowAmt}
            onChange={setBorrowAmt}
            unit="USDC"
            isEncrypted
          />

          {/* LTV bar */}
          <div className="space-y-4 pt-4">
            <div className="flex justify-between text-xs">
              <span className="text-gray-500">Loan-to-Value (LTV)</span>
              <span className="text-brand-cyan font-mono">
                {ltv ? `~${ltv}%` : "—"}
              </span>
            </div>
            <div className="w-full bg-white/5 h-1.5 rounded-full overflow-hidden">
              <div
                className="bg-brand-cyan h-full glow-shadow transition-all"
                style={{ width: ltv ? `${Math.min(parseFloat(ltv), 100)}%` : "0%" }}
              />
            </div>
          </div>

          <StatusBanner status={status} txHash={txHash} errorMsg={errorMsg} />

          <button
            onClick={handleBorrow}
            disabled={!canSubmit || status !== "idle"}
            className="w-full py-4 rounded-2xl bg-white text-black font-bold text-lg hover:shadow-[0_0_30px_rgba(255,255,255,0.2)] transition-all mt-6 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {status === "encrypting" && <><Loader2 size={18} className="animate-spin" /> Encrypting…</>}
            {status === "pending"    && <><Loader2 size={18} className="animate-spin" /> Awaiting confirmation…</>}
            {(status === "idle" || status === "success" || status === "error") && "Execute FHE Borrow"}
          </button>
        </div>

        {/* Info Sidebar */}
        <div className="space-y-6">
          <div className="glass p-6 bg-yellow-500/5 border-yellow-500/20 space-y-4">
            <div className="flex items-center gap-3 text-yellow-500">
              <AlertCircle size={20} />
              <h4 className="font-semibold text-sm">Privacy Advisory</h4>
            </div>
            <p className="text-xs text-yellow-200/70 leading-relaxed">
              Borrowing amounts are encrypted before they hit the mempool. The
              Argen protocol sees only your encrypted "handle," ensuring your
              debt levels are never public.
            </p>
          </div>

          <div className="glass p-6 space-y-4">
            <h4 className="font-semibold text-sm flex items-center gap-2">
              <ShieldQuestion size={18} className="text-brand-blue" />
              How it works
            </h4>
            <ul className="space-y-3">
              <StepItem number="1" text="Deposit native ETH collateral into the vault." />
              <StepItem number="2" text="relayer-sdk encrypts your USDC borrow amount client-side (add64 → inputProof)." />
              <StepItem number="3" text="Protocol calculates health factor natively inside FHEVM — amounts never leave ciphertext." />
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function InputGroup({
  label, placeholder, value, onChange, unit, isEncrypted,
}: {
  label: string;
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
  unit: string;
  isEncrypted?: boolean;
}) {
  return (
    <div className="space-y-2">
      <div className="flex justify-between items-center px-1">
        <label className="text-xs font-medium text-gray-400 uppercase tracking-wider">{label}</label>
        {isEncrypted && (
          <span className="text-[9px] text-brand-cyan flex items-center gap-1 font-mono uppercase font-bold">
            <Lock size={10} /> Encrypted
          </span>
        )}
      </div>
      <div className="relative">
        <input
          type="number"
          min="0"
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full bg-white/5 border border-white/10 rounded-2xl px-6 py-4 focus:outline-none focus:border-brand-blue transition-all font-mono text-lg"
        />
        <div className="absolute right-6 top-1/2 -translate-y-1/2 text-xs text-gray-500 font-mono">
          {unit}
        </div>
      </div>
    </div>
  );
}

function StepItem({ number, text }: { number: string; text: string }) {
  return (
    <li className="flex gap-3 items-start">
      <span className="w-5 h-5 rounded-full bg-white/10 flex items-center justify-center text-[10px] font-bold shrink-0 mt-0.5">
        {number}
      </span>
      <p className="text-[11px] text-gray-400 leading-normal">{text}</p>
    </li>
  );
}

function StatusBanner({
  status, txHash, errorMsg,
}: {
  status: TxStatus;
  txHash: string | null;
  errorMsg: string | null;
}) {
  if (status === "idle") return null;

  if (status === "success") {
    return (
      <div className="flex items-start gap-2 text-green-400 text-xs bg-green-400/5 border border-green-400/20 rounded-xl p-3">
        <CheckCircle size={14} className="shrink-0 mt-0.5" />
        <span>
          Borrow confirmed!{" "}
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
    );
  }

  if (status === "error") {
    return (
      <div className="flex items-start gap-2 text-red-400 text-xs bg-red-400/5 border border-red-400/20 rounded-xl p-3">
        <XCircle size={14} className="shrink-0 mt-0.5" />
        <span className="break-all">{errorMsg}</span>
      </div>
    );
  }

  return null;
}
