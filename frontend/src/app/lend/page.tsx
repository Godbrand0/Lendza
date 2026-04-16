"use client";

import React from "react";
import { 
  ShieldCheck, 
  ArrowUpRight, 
  TrendingUp,
  PieChart,
  Coins
} from "lucide-react";

export default function LendPage() {
  return (
    <div className="p-8 max-w-5xl mx-auto space-y-8 animate-in slide-in-from-bottom-4 duration-700">
      <div className="space-y-2">
        <h2 className="text-3xl font-bold tracking-tight">Protocol <span className="text-brand-blue">Liquidity</span></h2>
        <p className="text-gray-400 text-sm">Supply USDC to earn inflationary rewards and liquidation commissions.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <MarketCard 
          asset="USDC" 
          apy="4.20%" 
          totalApplied="2.4M" 
          utilization="62%"
        />
        <div className="glass p-8 md:col-span-2 space-y-6 flex flex-col justify-center">
          <div className="flex justify-between items-center px-1">
            <label className="text-xs font-medium text-gray-400 uppercase tracking-wider">Supply Amount</label>
            <span className="text-[10px] text-gray-500 font-mono italic">Wallet Balance: 12,450 USDC</span>
          </div>
          <div className="relative">
            <input 
              type="text" 
              placeholder="1000.00"
              className="w-full bg-white/5 border border-white/10 rounded-2xl px-6 py-5 focus:outline-none focus:border-brand-blue transition-all font-mono text-2xl"
            />
            <div className="absolute right-6 top-1/2 -translate-y-1/2 flex gap-2">
              <button className="px-2 py-1 rounded bg-white/10 text-[10px] uppercase font-bold text-gray-400 hover:text-white transition-colors">Max</button>
              <span className="text-sm font-bold text-brand-blue self-center">USDC</span>
            </div>
          </div>
          <button className="w-full py-5 rounded-2xl bg-gradient-to-r from-brand-blue to-brand-cyan text-black font-extrabold text-lg hover:opacity-90 transition-all shadow-[0_0_40px_rgba(79,172,254,0.1)]">
            Supply Liquidity
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
                <div className="bg-brand-blue h-full w-[62%] rounded-full shadow-[0_0_15px_rgba(79,172,254,0.3)]"></div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function MarketCard({ asset, apy, totalApplied, utilization }: any) {
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

function RewardItem({ label, value, color }: any) {
  return (
    <div className="flex justify-between items-center text-sm">
      <span className="text-gray-400 text-xs">{label}</span>
      <span className={`font-mono font-bold ${color || ""}`}>{value}</span>
    </div>
  );
}
