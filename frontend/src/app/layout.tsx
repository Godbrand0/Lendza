import type { Metadata } from "next";
import "./globals.css";
import { Sidebar, Header } from "@/components/Navigation";
import ClientOnlyFheProvider from "@/components/ClientOnlyFheProvider";
import { Web3Provider } from "@/components/Web3Provider";

export const metadata: Metadata = {
  title: "ARGEN × ZAMA | Confidential Agentic Lending",
  description: "Porting the Argen autonomous liquidation protocol to FHEVM on Zama Sepolia.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Outfit:wght@400;500;600;700&display=swap" rel="stylesheet" />
      </head>
      <body>
        <Web3Provider>
          <ClientOnlyFheProvider>
            <div className="flex min-h-screen">
              <Sidebar />
              <div className="flex-1 flex flex-col min-w-0">
                <Header />
                <main className="flex-1">
                  {children}
                </main>
              </div>
            </div>
          </ClientOnlyFheProvider>
        </Web3Provider>
      </body>
    </html>
  );
}
