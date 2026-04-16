"use client";

import React, { useState } from "react";
import { 
  ShieldCheck, 
  Activity, 
  Zap, 
  ArrowUpRight, 
  Lock, 
  RefreshCw,
  AlertCircle
} from "lucide-react";

export default function Dashboard() {
  return (
    <div className="p-8 space-y-8 animate-in fade-in duration-700">
      {/* Hero Stats */}
      <section className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <StatCard 
          icon={<ShieldCheck className="text-green-400" />} 
          label="Total Collateral" 
          value="1,420.69 cETH" 
          change="+12.4%" 
        />
        <StatCard 
          icon={<Zap className="text-yellow-400" />} 
          label="Active Liquidations" 
          value="4 Auctions" 
          change="0.5 cETH pending" 
        />
        <StatCard 
          icon={<Activity className="text-brand-cyan" />} 
          label="Total Protocol Health" 
          value="152%" 
          isGradient 
        />
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Main Content */}
        <div className="lg:col-span-2 space-y-8">
          <div className="glass p-8 min-h-[400px]">
              <div className="space-y-6">
                <div className="flex justify-between items-center">
                  <h3 className="text-xl font-semibold">Vault Overview</h3>
                  <button className="text-gray-400 hover:text-white transition-colors flex items-center gap-2 text-sm">
                    <RefreshCw size={14} /> Refresh FHE
                  </button>
                </div>
                
                <table className="w-full text-left">
                  <thead>
                    <tr className="text-gray-500 text-sm border-b border-white/10">
                      <th className="pb-4 font-medium">Position ID</th>
                      <th className="pb-4 font-medium">Collateral (cETH)</th>
                      <th className="pb-4 font-medium">Debt (cUSDC)</th>
                      <th className="pb-4 font-medium">Health Factor</th>
                      <th className="pb-4 font-medium text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    <PositionRow id="#2401" collateral="10.0" debt="25,000" health="1.82" />
                    <PositionRow id="#2582" collateral="5.5" debt="12,400" health="1.65" />
                    <PositionRow id="#1105" collateral="2.2" debt="4,100" health="1.95" />
                  </tbody>
                </table>
              </div>
          </div>
        </div>

        {/* Sidebar activity */}
        <div className="space-y-6">
          <div className="glass p-6 space-y-6 border-brand-cyan/20 glow-shadow bg-brand-cyan/5">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold flex items-center gap-2 text-sm">
                <Activity size={16} className="text-brand-cyan" />
                Live Agent Intel
              </h3>
              <span className="text-[9px] uppercase font-mono px-2 py-0.5 rounded bg-brand-cyan/20 text-brand-cyan border border-brand-cyan/30">Syncing</span>
            </div>
            
            <div className="space-y-4">
              <LogItem time="2m ago" agent="Monitor-1" action="Triggered health check for #2401" />
              <LogItem time="5m ago" agent="Bidder-Alpha" action="Submitted encrypted bid for #1920" />
              <LogItem time="12m ago" agent="Server" action="x402 Alpha granted for pos #2582" />
              <LogItem time="15m ago" agent="Vault" action="New deposit detected: 4.2 ETH" />
            </div>
          </div>

          <div className="glass p-6 bg-brand-blue/5 border-brand-blue/20">
            <h4 className="font-medium text-xs mb-2 text-brand-blue uppercase tracking-widest flex items-center gap-2">
              <Zap size={12} /> Solvency Check
            </h4>
            <p className="text-[10px] text-gray-400 leading-relaxed">
              Argen agents use TFHE.lt to verify health factors without revealing collateral value. This self-healing economy preserves privacy and solvency simultaneously.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function StatCard({ icon, label, value, change, isGradient }: { icon: any, label: string, value: string, change?: string, isGradient?: boolean }) {
  return (
    <div className="glass p-6 space-y-3 relative overflow-hidden group hover:border-white/20 transition-all hover:translate-y--0.5 shadow-xl">
      <div className="absolute -right-4 -top-4 w-24 h-24 bg-brand-blue/10 blur-3xl opacity-0 group-hover:opacity-100 transition-opacity" />
      <div className="flex items-center gap-2 text-xs text-gray-400 uppercase tracking-widest font-medium">
        {icon} {label}
      </div>
      <div className="flex items-end justify-between">
        <span className={`text-2xl font-bold tracking-tight ${isGradient ? 'text-gradient' : ''}`}>{value}</span>
        {change && <span className="text-[10px] font-mono text-green-400 border border-green-400/20 px-2 py-1 rounded-full bg-green-400/5">{change}</span>}
      </div>
    </div>
  );
}

function PositionRow({ id, collateral, debt, health }: any) {
  return (
    <tr className="group hover:bg-white/5 transition-colors">
      <td className="py-4 font-mono text-xs text-brand-cyan">{id}</td>
      <td className="py-4 font-semibold text-sm">{collateral} <span className="text-gray-500 font-normal">cETH</span></td>
      <td className="py-4 font-semibold text-sm">{debt} <span className="text-gray-500 font-normal">cUSDC</span></td>
      <td className="py-4">
        <span className="text-green-400 text-xs font-mono">{health}</span>
      </td>
      <td className="py-4 text-right">
        <button className="p-1.5 glass text-gray-400 hover:text-brand-cyan transition-colors rounded-lg">
          <ArrowUpRight size={14} />
        </button>
      </td>
    </tr>
  );
}

function LogItem({ time, agent, action }: { time: string, agent: string, action: string }) {
  return (
    <div className="flex gap-4 group">
      <div className="w-1 h-1 shrink-0 bg-brand-cyan/40 rounded-full mt-1.5 group-hover:bg-brand-cyan transition-colors" />
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <span className="text-[9px] font-mono text-gray-500 uppercase tracking-tighter">{time}</span>
          <span className="text-[9px] font-mono text-brand-cyan uppercase tracking-tighter font-bold">{agent}</span>
        </div>
        <p className="text-[10px] text-gray-300 leading-snug">{action}</p>
      </div>
    </div>
  );
}
