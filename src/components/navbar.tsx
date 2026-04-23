"use client";

import dynamic from "next/dynamic";
import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import { WalletIsland } from "./wallet-island";

const NavbarDesktopPortfolioLink = dynamic(
  () => import("./navbar-wallet-controls").then((mod) => mod.NavbarDesktopPortfolioLink),
  { ssr: false }
);
const NavbarWalletControls = dynamic(
  () => import("./navbar-wallet-controls").then((mod) => mod.NavbarWalletControls),
  { ssr: false }
);
const NavbarMobileWalletItems = dynamic(
  () => import("./navbar-wallet-controls").then((mod) => mod.NavbarMobileWalletItems),
  { ssr: false }
);

function MaybeWalletProvider({
  enabled,
  children,
}: {
  enabled: boolean;
  children: React.ReactNode;
}) {
  return enabled ? <WalletIsland>{children}</WalletIsland> : <>{children}</>;
}

export function Navbar({ withWalletProvider = true }: { withWalletProvider?: boolean }) {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <>
      <header className="fixed top-4 left-1/2 -translate-x-1/2 w-[calc(100%-2rem)] max-w-5xl z-50 flex items-center justify-between px-5 py-2 rounded-pill bg-black/40 backdrop-blur-[20px] border border-glass-border">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2">
          <Image src="/logo.png" alt="Basement" width={24} height={24} className="h-6 w-6" />
          <span className="text-lg font-bold text-white">Basement</span>
        </Link>

        {/* Center nav — desktop */}
        <nav className="hidden md:flex items-center gap-6">
          <Link href="/markets" className="text-sm text-white/50 hover:text-white transition-colors">
            Markets
          </Link>
          <MaybeWalletProvider enabled={withWalletProvider}>
            <NavbarDesktopPortfolioLink />
          </MaybeWalletProvider>
        </nav>

        {/* Right side */}
        <div className="flex items-center gap-3">
          <MaybeWalletProvider enabled={withWalletProvider}>
            <NavbarWalletControls />
          </MaybeWalletProvider>

          {/* Mobile hamburger */}
          <button
            onClick={() => setMobileOpen(!mobileOpen)}
            className="md:hidden flex flex-col gap-1 p-1"
            aria-label="Menu"
          >
            <span className={`block w-5 h-0.5 bg-white/60 transition-transform ${mobileOpen ? "rotate-45 translate-y-1.5" : ""}`} />
            <span className={`block w-5 h-0.5 bg-white/60 transition-opacity ${mobileOpen ? "opacity-0" : ""}`} />
            <span className={`block w-5 h-0.5 bg-white/60 transition-transform ${mobileOpen ? "-rotate-45 -translate-y-1.5" : ""}`} />
          </button>
        </div>
      </header>

      {/* Mobile dropdown */}
      {mobileOpen && (
        <div className="fixed top-[68px] left-4 right-4 z-50 glass rounded-lg p-4 flex flex-col gap-3 md:hidden">
          <Link href="/markets" onClick={() => setMobileOpen(false)} className="text-sm text-white/70 hover:text-white py-2 border-b border-glass-border">
            Markets
          </Link>
          <MaybeWalletProvider enabled={withWalletProvider}>
            <NavbarMobileWalletItems onNavigate={() => setMobileOpen(false)} />
          </MaybeWalletProvider>
        </div>
      )}
    </>
  );
}
