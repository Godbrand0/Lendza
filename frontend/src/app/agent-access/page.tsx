"use client";

import React from "react";
import { 
  Bot, 
  Lock, 
  Terminal, 
  Zap, 
  ShieldCheck,
  ChevronRight,
  Code2,
  Cpu
} from "lucide-react";

export default function AgentAccessPage() {
  return (
    <div className="p-8 max-w-6xl mx-auto space-y-8 animate-in slide-in-from-bottom-4 duration-700">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-6">
        <div className="space-y-2">
          <h2 className="text-3xl font-bold tracking-tight">Agent <span className="text-brand-cyan">Marketplace</span></h2>
          <p className="text-gray-400 text-sm">Join the Argen network as a validator or bidder. Purchase FHE alpha via x402.</p>
        </div>
        <div className="flex gap-4">
           <div className="glass px-4 py-2 flex flex-col items-center">
             <span className="text-[10px] text-gray-500 uppercase font-bold tracking-widest">Active Nodes</span>
             <span className="text-xl font-bold text-brand-cyan">142</span>
           </div>
           <div className="glass px-4 py-2 flex flex-col items-center">
             <span className="text-[10px] text-gray-500 uppercase font-bold tracking-widest">Network APY</span>
             <span className="text-xl font-bold text-brand-blue">12.5%</span>
           </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Marketplace Section */}
        <div className="lg:col-span-2 space-y-8">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <AccessPlan 
              title="Liquidation Scout" 
              price="5 USDC / hour" 
              features={["Real-time Health Ticker", "Encrypted Handles", "API Webhook Access"]} 
              isPopular
            />
            <AccessPlan 
              title="Market Arbitrageur" 
              price="25 USDC / hour" 
              features={["Full FHE Resolution", "Priority Bid Execution", "x402 Alpha Stream"]} 
            />
          </div>

          <div className="glass p-8 space-y-6 bg-brand-cyan/2">
            <h3 className="text-lg font-semibold flex items-center gap-2">
              <Terminal size={20} className="text-brand-cyan" />
              Live Alpha Stream (Encrypted)
            </h3>
            <div className="space-y-3 font-mono text-[10px] bg-black/40 p-6 rounded-2xl border border-white/5 h-[300px] overflow-y-auto custom-scrollbar">
               <AlphaLogItem type="DECRYPT_REQ" id="tx_0x9210...941" alpha="[FHE_CIPHERTEXT_HIDDEN]" />
               <AlphaLogItem type="HEALTH_CHECK" id="pos_#2582" alpha="[FHE_CIPHERTEXT_HIDDEN]" />
               <AlphaLogItem type="LIQ_TRIGGER" id="pos_#1105" alpha="[FHE_CIPHERTEXT_HIDDEN]" />
               <AlphaLogItem type="X402_GRANT" id="agent_0x42..." alpha="GRANTED_VIEW_ACCESS" isSpecial />
               <AlphaLogItem type="DECRYPT_REQ" id="tx_0x8211...211" alpha="[FHE_CIPHERTEXT_HIDDEN]" />
            </div>
          </div>
        </div>

        {/* Developer Integration */}
        <div className="space-y-6">
          <div className="glass p-8 space-y-6 border-brand-blue/20">
             <h4 className="font-semibold text-sm flex items-center gap-2">
               <Code2 size={18} className="text-brand-blue" />
               Integration Guide
             </h4>
             <div className="space-y-4">
               <section className="space-y-2">
                 <p className="text-[10px] text-gray-400 font-bold uppercase">1. Install SDK</p>
                 <div className="bg-black/50 p-3 rounded-lg text-[11px] font-mono text-brand-blue">
                   pnpm add @argen/agent-sdk
                 </div>
               </section>
               <section className="space-y-2">
                 <p className="text-[10px] text-gray-400 font-bold uppercase">2. Authenticate</p>
                 <p className="text-[11px] text-gray-400 leading-relaxed">
                   Submit a payment to the x402 Facilitator and pass the txHash to receive an ephemeral FHE decryption key.
                 </p>
               </section>
               <button className="w-full py-3 rounded-xl bg-brand-blue/10 border border-brand-blue/20 text-brand-blue text-xs font-bold hover:bg-brand-blue/20 transition-all flex items-center justify-center gap-2">
                  View Full Docs <ChevronRight size={14} />
               </button>
             </div>
          </div>

          <div className="glass p-8 space-y-4 bg-white/2 border-white/5">
             <h4 className="font-semibold text-xs flex items-center gap-2 uppercase tracking-widest">
               <Cpu size={14} className="text-gray-400" />
               System Status
             </h4>
             <div className="space-y-3">
               <StatusLine label="ZK Verifier" status="Optimal" />
               <StatusLine label="FHE Coprocessor" status="Latency: 12ms" />
               <StatusLine label="Bridge Liquidity" status="Deep" />
             </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function AccessPlan({ title, price, features, isPopular }: any) {
  return (
    <div className={`glass p-8 space-y-6 relative overflow-hidden transition-all hover:translate-y--1 ${isPopular ? 'border-brand-cyan/40 bg-brand-cyan/3 shadow-[0_0_50px_rgba(0,242,254,0.05)]' : ''}`}>
      {isPopular && <div className="absolute top-4 right--8 bg-brand-cyan text-black px-10 py-1 rotate-45 text-[9px] font-bold uppercase tracking-widest font-mono shadow-xl">Best Value</div>}
      <div>
        <h4 className="font-bold text-xl">{title}</h4>
        <p className="text-2xl font-mono text-brand-cyan mt-1">{price}</p>
      </div>
      <ul className="space-y-3">
        {features.map((f: string) => (
          <li key={f} className="flex items-center gap-2 text-xs text-gray-400 font-medium">
            <ShieldCheck size={14} className="text-brand-cyan" /> {f}
          </li>
        ))}
      </ul>
      <button className={`w-full py-4 rounded-xl font-extrabold text-sm transition-all ${isPopular ? 'bg-brand-cyan text-black' : 'bg-white/5 text-white hover:bg-white/10'}`}>
        Purchase Access
      </button>
    </div>
  );
}

function AlphaLogItem({ type, id, alpha, isSpecial }: any) {
  return (
    <div className={`flex justify-between items-center py-2 border-b border-white/5 last:border-0 ${isSpecial ? 'bg-brand-cyan/10 p-2 rounded-lg my-1 border-brand-cyan/20' : ''}`}>
      <div className="flex gap-4">
        <span className={`w-20 ${isSpecial ? 'text-brand-cyan' : 'text-gray-500'} font-bold`}>{type}</span>
        <span className="text-gray-400">{id}</span>
      </div>
      <span className={isSpecial ? 'text-brand-cyan font-bold' : 'text-brand-blue'}>{alpha}</span>
    </div>
  );
}

function StatusLine({ label, status }: { label: string, status: string }) {
  return (
    <div className="flex justify-between text-[11px]">
       <span className="text-gray-500">{label}</span>
       <span className="text-gray-300 font-mono italic">{status}</span>
    </div>
  );
}
