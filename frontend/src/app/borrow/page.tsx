"use client";

import React from "react";
import { 
  TrendingDown, 
  Lock, 
  AlertCircle,
  ArrowRight,
  ShieldQuestion
} from "lucide-react";

export default function BorrowPage() {
  return (
    <div className="p-8 max-w-4xl mx-auto space-y-8 animate-in slide-in-from-bottom-4 duration-700">
      <div className="space-y-2">
        <h2 className="text-3xl font-bold tracking-tight">Confidential <span className="text-brand-cyan">Borrowing</span></h2>
        <p className="text-gray-400 text-sm">Initiate loans inside the Zama FHE coprocessor. Your metrics remain private.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        {/* Borrow Form */}
        <div className="glass p-8 space-y-6">
          <InputGroup label="Deposit Collateral (ETH)" placeholder="2.0" />
          <div className="flex justify-center -my-2 text-gray-600">
            <ArrowRight size={20} className="rotate-90" />
          </div>
          <InputGroup label="Borrow Amount (USDC)" placeholder="5000" isEncrypted />
          
          <div className="space-y-4 pt-4">
            <div className="flex justify-between text-xs">
              <span className="text-gray-500">Loan-to-Value (LTV)</span>
              <span className="text-brand-cyan font-mono">~75.0%</span>
            </div>
            <div className="w-full bg-white/5 h-1.5 rounded-full overflow-hidden">
              <div className="bg-brand-cyan h-full w-[75%] glow-shadow"></div>
            </div>
          </div>

          <button className="w-full py-4 rounded-2xl bg-white text-black font-bold text-lg hover:shadow-[0_0_30px_rgba(255,255,255,0.2)] transition-all mt-6">
            Execute FHE Borrow
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
              Borrowing amounts are encrypted before they hit the mempool. The Argen protocol sees only your encrypted "handle," ensuring that your debt levels are never public.
            </p>
          </div>

          <div className="glass p-6 space-y-4">
            <h4 className="font-semibold text-sm flex items-center gap-2">
              <ShieldQuestion size={18} className="text-brand-blue" />
              How it works
            </h4>
            <ul className="space-y-3">
              <StepItem number="1" text="Deposit native ETH collateral into the vault." />
              <StepItem number="2" text="Enter desired USDC borrow amount (Encrypted)." />
              <StepItem number="3" text="Protocol calculates health natively inside FHEVM." />
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}

function InputGroup({ label, placeholder, isEncrypted }: { label: string, placeholder: string, isEncrypted?: boolean }) {
  return (
    <div className="space-y-2">
      <div className="flex justify-between items-center px-1">
        <label className="text-xs font-medium text-gray-400 uppercase tracking-wider">{label}</label>
        {isEncrypted && <span className="text-[9px] text-brand-cyan flex items-center gap-1 font-mono uppercase font-bold"><Lock size={10} /> Encrypted</span>}
      </div>
      <div className="relative">
        <input 
          type="text" 
          placeholder={placeholder}
          className="w-full bg-white/5 border border-white/10 rounded-2xl px-6 py-4 focus:outline-none focus:border-brand-blue transition-all font-mono text-lg"
        />
        <div className="absolute right-6 top-1/2 -translate-y-1/2 text-xs text-gray-500 font-mono">
          {label.includes("ETH") ? "ETH" : "USDC"}
        </div>
      </div>
    </div>
  );
}

function StepItem({ number, text }: { number: string, text: string }) {
  return (
    <li className="flex gap-3 items-start">
      <span className="w-5 h-5 rounded-full bg-white/10 flex items-center justify-center text-[10px] font-bold shrink-0 mt-0.5">{number}</span>
      <p className="text-[11px] text-gray-400 leading-normal">{text}</p>
    </li>
  );
}
