"use client";

import dynamic from "next/dynamic";

const FheProvider = dynamic(() => import("@/components/FheProvider"), {
  ssr: false,
});

export default function ClientOnlyFheProvider({ children }: { children: React.ReactNode }) {
  return <FheProvider>{children}</FheProvider>;
}
