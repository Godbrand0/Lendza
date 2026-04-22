/**
 * x402client.ts — HTTP payment client for the Lendza x402 server
 *
 * Implements the two-step probe-pay-confirm flow:
 *   1. POST endpoint         → expect 402 with { payTo, amount, tokenAddress, confirmEndpoint }
 *   2. transfer(payTo, fee)  on-chain using the agent's USDC wallet
 *   3. POST confirmEndpoint  { txHash, ...body } → 200 with data
 *
 * If the server returns 200 on the initial probe (already paid / cached),
 * the on-chain payment is skipped entirely.
 */

import axios, { AxiosError } from "axios";
import { ethers } from "ethers";

// Minimal ABI — only transfer needed for fee payment
const USDC_ABI = [
  "function transfer(address to, uint256 amount) external returns (bool)",
  "function balanceOf(address account) external view returns (uint256)",
];

export interface X402Response<T = unknown> {
  data: T;
  paid: boolean;    // true if an on-chain payment was made this call
  txHash?: string;  // the payment tx hash if paid === true
}

export interface OverduePosition {
  borrower: string;
  collateralEth: string;
  dueTime: number;
  overdueSeconds: number;
}

export interface AuctionData {
  auctionId: string;
  borrower: string;
  startPrice: string;
  floorPrice: string;
  currentPrice: string;
  discountPct: string;
  startTime: number;
  endsAt: number;
  secondsRemaining: number;
}

export class X402Client {
  private serverUrl: string;
  private wallet: ethers.Wallet;
  private usdc: ethers.Contract;
  private log: (msg: string) => void;

  constructor(
    serverUrl: string,
    wallet: ethers.Wallet,
    usdcAddress: string,
    log: (msg: string) => void,
  ) {
    this.serverUrl = serverUrl.replace(/\/$/, "");
    this.wallet = wallet;
    this.usdc = new ethers.Contract(usdcAddress, USDC_ABI, wallet);
    this.log = log;
  }

  /**
   * Generic probe-pay-confirm call.
   * `body` is sent to both the probe and the confirm endpoint.
   */
  async fetch<T>(probeEndpoint: string, body: Record<string, unknown> = {}): Promise<X402Response<T>> {
    const probeUrl = this.serverUrl + probeEndpoint;

    // ── 1. Probe ────────────────────────────────────────────────────────────
    let probeRes;
    try {
      probeRes = await axios.post(probeUrl, body);
      // 200 on probe — already granted (server-side cache or free endpoint)
      return { data: probeRes.data as T, paid: false };
    } catch (err) {
      const e = err as AxiosError;
      if (!e.response || e.response.status !== 402) {
        throw new Error(`x402 probe failed (${probeUrl}): ${e.message}`);
      }
      probeRes = e.response;
    }

    const { payTo, amount, tokenAddress, confirmEndpoint } = probeRes.data as {
      payTo: string;
      amount: number;
      tokenAddress: string;
      confirmEndpoint: string;
    };

    if (!payTo || !amount || !confirmEndpoint) {
      throw new Error(`x402: malformed 402 response from ${probeUrl}`);
    }

    // ── 2. Check USDC balance ───────────────────────────────────────────────
    const balance: bigint = await this.usdc.balanceOf(this.wallet.address);
    const fee = BigInt(amount);
    if (balance < fee) {
      throw new Error(
        `x402: insufficient USDC — need ${fee}, have ${balance} ` +
        `(wallet: ${this.wallet.address})`
      );
    }

    // ── 3. Pay on-chain ─────────────────────────────────────────────────────
    const tokenToUse = tokenAddress || (await this.usdc.getAddress());
    const payToken = tokenAddress
      ? new ethers.Contract(tokenAddress, USDC_ABI, this.wallet)
      : this.usdc;

    this.log(`x402: paying ${fee} USDC units to ${payTo} for ${probeEndpoint}…`);
    const payTx = await payToken.transfer(payTo, fee);
    const receipt = await payTx.wait();
    this.log(`x402: payment confirmed — tx: ${receipt.hash}`);

    // ── 4. Confirm ──────────────────────────────────────────────────────────
    const confirmUrl = this.serverUrl + confirmEndpoint.replace(/^POST /, "");
    const confirmRes = await axios.post(confirmUrl, { ...body, txHash: receipt.hash });

    return { data: confirmRes.data as T, paid: true, txHash: receipt.hash };
  }

  /** Get overdue positions eligible for liquidation. */
  async getOverduePositions(): Promise<OverduePosition[]> {
    const res = await this.fetch<{ positions: OverduePosition[] }>("/v1/positions/unhealthy");
    return res.data.positions ?? [];
  }

  /** Get live auction data with current prices. */
  async getAuctionData(): Promise<AuctionData[]> {
    const res = await this.fetch<{ auctions: AuctionData[] }>("/v1/auction/access");
    return res.data.auctions ?? [];
  }
}
