"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ShieldCheck,
  TrendingDown,
  LayoutDashboard,
  User,
  Bot,
  Lock,
  ExternalLink,
} from "lucide-react";
import { useFhe } from "@/context/FheContext";
import { ConnectButton } from "@rainbow-me/rainbowkit";

export function Sidebar() {
  const pathname = usePathname();

  const navItems = [
    { label: "Dashboard", icon: LayoutDashboard, href: "/" },
    { label: "Lend", icon: ShieldCheck, href: "/lend" },
    { label: "Borrow", icon: TrendingDown, href: "/borrow" },
    { label: "Profile", icon: User, href: "/profile" },
    { label: "Agent Access", icon: Bot, href: "/agent-access", isSpecial: true },
  ];

  const { sdkReady } = useFhe();

  return (
    <div className="w-64 shrink-0 h-screen glass border-r border-white/5 flex flex-col p-6 sticky top-0 overflow-y-auto">
      <div className="flex items-center gap-3 mb-10 px-2">
        <div className="w-8 h-8 bg-gradient-to-tr from-brand-blue to-brand-cyan rounded-lg flex items-center justify-center glow-shadow">
          <Lock className="text-dark w-4 h-4" />
        </div>
        <span className="font-bold text-lg tracking-tight">ARGEN <span className="text-brand-cyan">×</span> ZAMA</span>
      </div>

      <nav className="flex-1 space-y-2">
        {navItems.map((item) => {
          const isActive = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 px-4 py-3 rounded-xl transition-all ${
                isActive
                  ? "bg-white/10 text-white shadow-[inset_0_0_20px_rgba(255,255,255,0.05)]"
                  : "text-gray-400 hover:text-white hover:bg-white/5"
              } ${item.isSpecial ? "border border-brand-cyan/20 text-brand-cyan!" : ""}`}
            >
              <item.icon size={20} />
              <span className="font-medium">{item.label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="mt-auto pt-6 space-y-4">
        <div className="p-4 bg-brand-cyan/5 rounded-2xl border border-brand-cyan/10">
          <p className="text-[10px] uppercase font-mono text-brand-cyan tracking-widest mb-2">Network Status</p>
          <div className="flex items-center gap-2 text-xs text-brand-cyan/80">
            <div className={`w-1.5 h-1.5 rounded-full ${sdkReady ? "bg-brand-cyan animate-pulse" : "bg-gray-500"}`} />
            <span>{sdkReady ? "FHEVM Coprocessor active" : "Loading WASM…"}</span>
          </div>
        </div>
        <button className="w-full flex items-center justify-between text-xs text-gray-500 hover:text-white transition-colors group">
          <span>Stellar Bridge</span>
          <ExternalLink size={12} className="group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform" />
        </button>
      </div>
    </div>
  );
}

export function Header() {
  return (
    <header className="flex justify-between items-center py-4 px-8 sticky top-0 bg-background/50 backdrop-blur-xl z-50 border-b border-white/5">
      <div className="flex items-center gap-4">
        <div className="px-3 py-1 rounded-full bg-white/5 border border-white/10 text-[10px] font-mono text-gray-400 uppercase tracking-widest">
          Testnet v0.4
        </div>
      </div>
      <div className="flex items-center gap-3 scale-90 origin-right">
        <ConnectButton 
          accountStatus="address"
          chainStatus="icon"
          showBalance={false}
        />
      </div>
    </header>
  );
}
