"use client";

// Thin client-side wrapper so the server-component layout.tsx can
// render this without triggering SSR issues.
import { FheContextProvider } from "@/context/FheContext";

export default function FheProvider({ children }: { children: React.ReactNode }) {
  return <FheContextProvider>{children}</FheContextProvider>;
}
