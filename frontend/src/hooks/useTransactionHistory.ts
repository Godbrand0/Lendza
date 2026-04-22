"use client";

import { useCallback, useEffect, useState } from "react";
import { useAccount, usePublicClient } from "wagmi";
import { parseAbiItem } from "viem";
import { VAULT_ADDRESS } from "@/lib/contracts";

export type HistoryAction =
  | "Collateral Deposited"
  | "Collateral Withdrawn"
  | "Borrowed"
  | "Repaid"
  | "Liquidity Deposited"
  | "Liquidated";

export interface HistoryEvent {
  action: HistoryAction;
  blockNumber: bigint;
  txHash: string;
  ethAmount?: number;
  timestamp?: number;
}

export interface TransactionHistory {
  borrowEvents: HistoryEvent[];
  lendEvents: HistoryEvent[];
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

const CONTRACT_DEPLOY_BLOCK = 10_701_681n;

export function useTransactionHistory(): TransactionHistory {
  const { address, isConnected } = useAccount();
  const publicClient = usePublicClient();

  const [borrowEvents, setBorrowEvents] = useState<HistoryEvent[]>([]);
  const [lendEvents, setLendEvents] = useState<HistoryEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const refresh = useCallback(() => setTick((n) => n + 1), []);

  useEffect(() => {
    if (!isConnected || !address || !publicClient || !VAULT_ADDRESS) return;

    let cancelled = false;

    async function fetchHistory() {
      setLoading(true);
      setError(null);

      try {
        const fromBlock = CONTRACT_DEPLOY_BLOCK;

        const vaultAddr = VAULT_ADDRESS as `0x${string}`;
        const userAddr = address as `0x${string}`;

        // Fetch all relevant borrow-side events in parallel
        const [deposited, withdrawn, borrowed, repaid, liquidated] =
          await Promise.all([
            publicClient!.getLogs({
              address: vaultAddr,
              event: parseAbiItem(
                "event CollateralDeposited(address indexed borrower, uint256 gweiAmount)"
              ),
              args: { borrower: userAddr },
              fromBlock,
            }),
            publicClient!.getLogs({
              address: vaultAddr,
              event: parseAbiItem(
                "event CollateralWithdrawn(address indexed borrower, uint256 gweiAmount)"
              ),
              args: { borrower: userAddr },
              fromBlock,
            }),
            publicClient!.getLogs({
              address: vaultAddr,
              event: parseAbiItem("event Borrowed(address indexed borrower)"),
              args: { borrower: userAddr },
              fromBlock,
            }),
            publicClient!.getLogs({
              address: vaultAddr,
              event: parseAbiItem("event Repaid(address indexed borrower)"),
              args: { borrower: userAddr },
              fromBlock,
            }),
            publicClient!.getLogs({
              address: vaultAddr,
              event: parseAbiItem(
                "event LiquidationStarted(address indexed borrower)"
              ),
              args: { borrower: userAddr },
              fromBlock,
            }),
          ]);

        // Fetch lend-side events
        const [liquidityDeposited] = await Promise.all([
          publicClient!.getLogs({
            address: vaultAddr,
            event: parseAbiItem(
              "event LiquidityDeposited(address indexed lender)"
            ),
            args: { lender: userAddr },
            fromBlock,
          }),
        ]);

        if (cancelled) return;

        // Map raw logs to HistoryEvent
        const rawBorrow: HistoryEvent[] = [
          ...deposited.map((l) => ({
            action: "Collateral Deposited" as HistoryAction,
            blockNumber: l.blockNumber,
            txHash: l.transactionHash,
            ethAmount:
              l.args && "gweiAmount" in l.args
                ? Number(l.args.gweiAmount as bigint) / 1e9
                : undefined,
          })),
          ...withdrawn.map((l) => ({
            action: "Collateral Withdrawn" as HistoryAction,
            blockNumber: l.blockNumber,
            txHash: l.transactionHash,
            ethAmount:
              l.args && "gweiAmount" in l.args
                ? Number(l.args.gweiAmount as bigint) / 1e9
                : undefined,
          })),
          ...borrowed.map((l) => ({
            action: "Borrowed" as HistoryAction,
            blockNumber: l.blockNumber,
            txHash: l.transactionHash,
          })),
          ...repaid.map((l) => ({
            action: "Repaid" as HistoryAction,
            blockNumber: l.blockNumber,
            txHash: l.transactionHash,
          })),
          ...liquidated.map((l) => ({
            action: "Liquidated" as HistoryAction,
            blockNumber: l.blockNumber,
            txHash: l.transactionHash,
          })),
        ].sort((a, b) => Number(b.blockNumber - a.blockNumber));

        const rawLend: HistoryEvent[] = liquidityDeposited
          .map((l) => ({
            action: "Liquidity Deposited" as HistoryAction,
            blockNumber: l.blockNumber,
            txHash: l.transactionHash,
          }))
          .sort((a, b) => Number(b.blockNumber - a.blockNumber));

        // Fetch block timestamps for unique blocks
        const allEvents = [...rawBorrow, ...rawLend];
        const uniqueBlocks = [...new Set(allEvents.map((e) => e.blockNumber))];

        const blockData = await Promise.all(
          uniqueBlocks.map((bn) =>
            publicClient!.getBlock({ blockNumber: bn }).catch(() => null)
          )
        );

        if (cancelled) return;

        const timestampMap = new Map<bigint, number>();
        blockData.forEach((block, i) => {
          if (block) timestampMap.set(uniqueBlocks[i], Number(block.timestamp));
        });

        const withTimestamps = (events: HistoryEvent[]) =>
          events.map((e) => ({
            ...e,
            timestamp: timestampMap.get(e.blockNumber),
          }));

        setBorrowEvents(withTimestamps(rawBorrow));
        setLendEvents(withTimestamps(rawLend));
      } catch (err) {
        if (!cancelled) {
          setError("Failed to load history. Try again.");
          console.error(err);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchHistory();
    return () => { cancelled = true; };
  }, [address, isConnected, publicClient, tick]);

  return { borrowEvents, lendEvents, loading, error, refresh };
}
