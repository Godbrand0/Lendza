"use client";

import { useState, useEffect, useCallback } from "react";
import { Contract, JsonRpcProvider } from "ethers";
import { VAULT_ADDRESS, VAULT_ABI } from "@/lib/contracts";

export interface ProtocolStats {
  totalCollateralEth: number;
  activeBorrowers: number;
  totalLenders: number;
  loading: boolean;
}

export function useProtocolStats(): ProtocolStats {
  const [totalCollateralEth, setTotalCollateralEth] = useState(0);
  const [activeBorrowers, setActiveBorrowers] = useState(0);
  const [totalLenders, setTotalLenders] = useState(0);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    if (!VAULT_ADDRESS) return;
    try {
      const provider = new JsonRpcProvider(process.env.NEXT_PUBLIC_RPC_URL);
      const vault = new Contract(VAULT_ADDRESS, VAULT_ABI, provider);
      const [totalCollateral, borrowers, lenders] = await vault.getProtocolStats();
      setTotalCollateralEth(Number(totalCollateral) / 1e9);
      setActiveBorrowers(Number(borrowers));
      setTotalLenders(Number(lenders));
    } catch {
      // RPC error — keep zeros
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetch(); }, [fetch]);

  return { totalCollateralEth, activeBorrowers, totalLenders, loading };
}
