"use client";

import { useState, useEffect, useCallback } from "react";
import { Contract, JsonRpcProvider } from "ethers";
import { useFhe } from "@/context/FheContext";
import {
  VAULT_ADDRESS, VAULT_ABI,
  CUSDC_ADDRESS, TOKEN_ABI,
} from "@/lib/contracts";

const ETH_PRICE_USD = 3000;
const MAX_LTV = 0.66;

export interface LoanInfo {
  startTime: number;
  termSeconds: number;
  dueTime: number;
  isOverdue: boolean;
  isActive: boolean;
}

export interface VaultPosition {
  hasCollateral: boolean;
  collateralGwei: bigint;
  collateralEth: number;
  collateralUsd: number;
  maxBorrowUsdc: number;
  loan: LoanInfo;
  isLender: boolean;
  debtUsdc: number | null;
  lenderUsdc: number | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  /** Clear cached decrypted values — call after a tx that changes encrypted state */
  clearDecrypted: () => void;
  decryptDebt: () => Promise<void>;
  decryptLenderBalance: () => Promise<void>;
}

const DEFAULT_LOAN: LoanInfo = {
  startTime: 0, termSeconds: 0, dueTime: 0, isOverdue: false, isActive: false,
};

/** Prefix a hex string with 0x if it doesn't already have it. */
function ensure0x(hex: string): `0x${string}` {
  return (hex.startsWith("0x") ? hex : `0x${hex}`) as `0x${string}`;
}

export function useVaultPosition(): VaultPosition {
  const { instance, account, signer } = useFhe();

  const [hasCollateral, setHasCollateral] = useState(false);
  const [collateralGwei, setCollateralGwei] = useState(0n);
  const [loan, setLoan] = useState<LoanInfo>(DEFAULT_LOAN);
  const [isLenderState, setIsLenderState] = useState(false);
  const [debtUsdc, setDebtUsdc] = useState<number | null>(null);
  const [lenderUsdc, setLenderUsdc] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const collateralEth = Number(collateralGwei) / 1e9;
  const collateralUsd = collateralEth * ETH_PRICE_USD;
  const maxBorrowUsdc = collateralUsd * MAX_LTV;

  // ── Plaintext refresh ──────────────────────────────────────────────────────

  const refresh = useCallback(async () => {
    if (!account || !VAULT_ADDRESS) return;
    setLoading(true);
    setError(null);
    try {
      const provider = new JsonRpcProvider(process.env.NEXT_PUBLIC_RPC_URL);
      const vault = new Contract(VAULT_ADDRESS, VAULT_ABI, provider);
      const [hasColl, gwei, loanInfo, lender] = await Promise.all([
        vault.hasCollateral(account),
        vault.collateralGwei(account),
        vault.getLoanInfo(account),
        vault.isLender(account),
      ]);
      setHasCollateral(hasColl);
      setCollateralGwei(BigInt(gwei));
      setLoan({
        startTime: Number(loanInfo[0]),
        termSeconds: Number(loanInfo[1]),
        dueTime: Number(loanInfo[2]),
        isOverdue: loanInfo[3],
        isActive: loanInfo[4],
      });
      setIsLenderState(lender);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [account]);

  useEffect(() => { refresh(); }, [refresh]);

  // ── Re-encryption core ─────────────────────────────────────────────────────

  /**
   * Decrypts a single euint64 handle using the Zama KMS userDecrypt flow.
   *
   * Steps:
   *  1. Generate throwaway keypair (stays in browser)
   *  2. Sign EIP-712 authorisation with the user's wallet
   *  3. KMS re-encrypts the ciphertext under our public key
   *  4. We decrypt locally with the private key
   *
   * Ethers v6 note: signTypedData rejects if `types` contains EIP712Domain,
   * so we strip it before calling.
   */
  const decryptHandle = useCallback(async (
    contractAddress: string,
    handle: string,
  ): Promise<bigint | null> => {
    if (!instance || !signer || !account) return null;

    // Zero handle = no balance initialised yet on-chain
    const zeroHandle = "0x" + "0".repeat(64);
    if (!handle || handle === zeroHandle || handle === "0".repeat(64)) return null;

    const normalHandle = ensure0x(handle);

    // 1. Throwaway keypair — keys are BytesHexNo0x (no 0x prefix from SDK)
    const { publicKey: pubKeyRaw, privateKey: privKeyRaw } = instance.generateKeypair();

    // 2. Build EIP-712 — contractAddresses must be checksum or lowercase hex
    const startTimestamp = Math.floor(Date.now() / 1000);
    const durationDays = 1;
    const eip712 = instance.createEIP712(
      ensure0x(pubKeyRaw),
      [contractAddress],
      startTimestamp,
      durationDays,
    );

    // Ethers v6 signTypedData MUST NOT receive EIP712Domain in types
    const { EIP712Domain: _ignored, ...typesForSigning } = eip712.types;

    const signature = await signer.signTypedData(
      eip712.domain,
      typesForSigning,
      eip712.message,
    );

    // 3. KMS re-encrypts + we decrypt locally
    const results = await instance.userDecrypt(
      [{ handle: normalHandle, contractAddress }],
      privKeyRaw,          // SDK expects raw hex without 0x
      ensure0x(pubKeyRaw), // SDK expects 0x-prefixed here
      signature,
      [contractAddress],
      account,
      startTimestamp,
      durationDays,
    );

    // Results: Record<handleHex, ClearValueType>
    const keys = Object.keys(results);
    if (keys.length === 0) return null;
    const val = results[keys[0] as `0x${string}`];
    return typeof val === "bigint" ? val : BigInt(String(val));
  }, [instance, signer, account]);

  // ── Per-value decrypt helpers ──────────────────────────────────────────────

  const clearDecrypted = useCallback(() => {
    setDebtUsdc(null);
    setLenderUsdc(null);
  }, []);

  const decryptDebt = useCallback(async () => {
    if (!account || !CUSDC_ADDRESS) return;
    setError(null);
    try {
      const provider = new JsonRpcProvider(process.env.NEXT_PUBLIC_RPC_URL);
      const token = new Contract(CUSDC_ADDRESS, TOKEN_ABI, provider);
      const handle: string = await token.confidentialBalanceOf(account);
      const plaintext = await decryptHandle(CUSDC_ADDRESS, handle);
      if (plaintext !== null) setDebtUsdc(Number(plaintext) / 1e6);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [account, decryptHandle]);

  const decryptLenderBalance = useCallback(async () => {
    if (!account || !VAULT_ADDRESS) return;
    setError(null);
    try {
      const provider = new JsonRpcProvider(process.env.NEXT_PUBLIC_RPC_URL);
      const vault = new Contract(VAULT_ADDRESS, VAULT_ABI, provider);
      const handle: string = await vault.getLenderBalanceHandle(account);
      const plaintext = await decryptHandle(VAULT_ADDRESS, handle);
      if (plaintext !== null) setLenderUsdc(Number(plaintext) / 1e6);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [account, decryptHandle]);

  return {
    hasCollateral,
    collateralGwei,
    collateralEth,
    collateralUsd,
    maxBorrowUsdc,
    loan,
    isLender: isLenderState,
    debtUsdc,
    lenderUsdc,
    loading,
    error,
    refresh,
    clearDecrypted,
    decryptDebt,
    decryptLenderBalance,
  };
}
