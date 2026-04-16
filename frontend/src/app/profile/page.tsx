"use client";

import React from "react";
import { 
  User, 
  History, 
  Settings, 
  CreditCard,
  ShieldAlert,
  Wallet,
  ArrowDownLeft,
  ArrowUpRight
} from "lucide-react";

export default function ProfilePage() {
  return (
    <div className="p-8 max-w-6xl mx-auto space-y-8 animate-in slide-in-from-bottom-4 duration-700">
      <div className="flex items-center gap-6 mb-4">
        <div className="w-20 h-20 rounded-3xl bg-white/5 border border-white/10 flex items-center justify-center relative group">
          <User size={32} className="text-gray-400 group-hover:text-white transition-colors" />
          <div className="absolute -bottom-1 -right-1 w-6 h-6 bg-green-500 border-4 border-background rounded-full"></div>
        </div>
        <div className="space-y-1">
          <h2 className="text-3xl font-bold tracking-tight">0x1A...8BAC</h2>
          <div className="flex gap-3">
             <span className="text-[10px] bg-brand-cyan/10 text-brand-cyan px-2 py-0.5 rounded border border-brand-cyan/20 font-mono uppercase">Verified Account</span>
             <span className="text-[10px] bg-white/5 text-gray-500 px-2 py-0.5 rounded border border-white/10 font-mono uppercase tracking-widest">Mainnet Ready</span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Account summary */}
        <div className="lg:col-span-2 space-y-8">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <SummaryCard 
              label="Net Worth" 
              value="$12,342.12" 
              icon={<Wallet className="text-brand-blue" />} 
            />
            <SummaryCard 
              label="Active Health" 
              value="1.82" 
              icon={<ShieldAlert className="text-green-400" />} 
              isWarning={false}
            />
          </div>

          <div className="glass p-8 space-y-6">
            <h3 className="text-lg font-semibold flex items-center gap-2">
              <History size={20} className="text-gray-400" />
              Recent Activity
            </h3>
            <div className="space-y-4">
              <ActivityItem 
                action="Repay Debt" 
                amount="500.00 USDC" 
                date="Apr 16, 2026" 
                icon={<ArrowDownLeft className="text-green-400" />} 
              />
              <ActivityItem 
                action="Borrow USDC" 
                amount="5,000.00 USDC" 
                date="Apr 14, 2026" 
                icon={<ArrowUpRight className="text-brand-blue" />} 
              />
              <ActivityItem 
                action="Supply Liquidity" 
                amount="10.00 ETH" 
                date="Apr 12, 2026" 
                icon={<ArrowUpRight className="text-brand-cyan" />} 
              />
            </div>
          </div>
        </div>

        {/* Sidebar settings */}
        <div className="space-y-6">
          <div className="glass p-6 space-y-6">
             <h4 className="font-semibold text-sm flex items-center gap-2">
               <Settings size={18} className="text-gray-400" />
               Account Settings
             </h4>
             <div className="space-y-2">
               <SettingsToggle label="Real-time Health Notifications" active />
               <SettingsToggle label="Auto-Alpha Sharing (x402)" active />
               <SettingsToggle label="Privacy Shield (Mixer)" />
             </div>
             <button className="w-full py-3 rounded-xl bg-white/5 border border-white/10 text-sm font-bold hover:bg-white/10 transition-all">
                Disconnect Wallet
             </button>
          </div>

          <div className="glass p-6 bg-brand-cyan/5 border-brand-cyan/20">
            <h4 className="font-medium text-xs mb-2 text-brand-cyan uppercase tracking-widest flex items-center gap-2">
              <CreditCard size={12} /> Gas Station
            </h4>
            <p className="text-[10px] text-gray-400 leading-relaxed">
              Argen uses a relayer for confidential transactions. Keep your Gas balance topped up to ensure agents can process your liquidation checks.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function SummaryCard({ label, value, icon, isWarning }: any) {
  return (
    <div className="glass p-6 space-y-3 relative overflow-hidden">
      <div className="flex justify-between items-start">
        <span className="text-xs text-gray-400 font-medium uppercase tracking-widest">{label}</span>
        {icon}
      </div>
      <p className={`text-2xl font-bold ${isWarning ? 'text-yellow-400' : ''}`}>{value}</p>
    </div>
  );
}

function ActivityItem({ action, amount, date, icon }: any) {
  return (
    <div className="flex items-center justify-between p-4 rounded-2xl bg-white/2 hover:bg-white/5 transition-all border border-white/5">
      <div className="flex items-center gap-4">
        <div className="w-10 h-10 rounded-xl bg-white/5 flex items-center justify-center">
          {icon}
        </div>
        <div>
          <p className="text-sm font-semibold">{action}</p>
          <p className="text-[10px] text-gray-500 font-mono italic">{date}</p>
        </div>
      </div>
      <div className="text-right">
        <p className="text-sm font-bold">{amount}</p>
        <p className="text-[10px] text-gray-500 uppercase font-bold tracking-tighter">Confirmed</p>
      </div>
    </div>
  );
}

function SettingsToggle({ label, active }: { label: string, active?: boolean }) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-white/5 last:border-0">
      <span className="text-xs text-gray-400">{label}</span>
      <div className={`w-8 h-4 rounded-full p-0.5 transition-colors cursor-pointer ${active ? 'bg-brand-cyan' : 'bg-white/10'}`}>
        <div className={`w-3 h-3 rounded-full bg-white transition-transform ${active ? 'translate-x-4' : 'translate-x-0'}`}></div>
      </div>
    </div>
  );
}
