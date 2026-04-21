import Link from "next/link";
import Image from "next/image";

const GITHUB_URL = "https://github.com";

export default function LandingPage() {
  return (
    <div className="-mt-20 min-h-screen overflow-hidden bg-[#020202] text-white">
      <style suppressHydrationWarning>{`
        .landing-shell {
          position: relative;
          isolation: isolate;
        }
        .landing-glass {
          position: relative;
          background: rgba(255, 255, 255, 0.03);
          border: 1px solid rgba(255, 255, 255, 0.08);
          box-shadow:
            0 1px 2px rgba(0, 0, 0, 0.25),
            inset 0 1px 0 rgba(255, 255, 255, 0.06);
          backdrop-filter: blur(12px);
          -webkit-backdrop-filter: blur(12px);
        }
        .landing-panel {
          position: relative;
          overflow: hidden;
          border-radius: 24px;
          padding: 1.5rem;
          background: rgba(255, 255, 255, 0.03);
          border: 1px solid rgba(255, 255, 255, 0.08);
          box-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
          backdrop-filter: blur(12px);
          -webkit-backdrop-filter: blur(12px);
        }
        .landing-panel::after {
          content: "";
          position: absolute;
          inset: auto -18% -40% 32%;
          height: 180px;
          background: radial-gradient(circle, rgba(255, 221, 0, 0.08) 0%, rgba(255, 221, 0, 0.04) 35%, transparent 65%);
          opacity: 0;
          transition: opacity 180ms ease;
          pointer-events: none;
        }
        .landing-panel:hover::after {
          opacity: 1;
        }
        .h1-scale {
          font-size: clamp(4rem, 12vw, 150px);
          line-height: 0.9;
          letter-spacing: -0.05em;
        }
        /* Ambient drifting orbs — subtle background behind arcs */
        .ambient-orbs {
          position: fixed;
          inset: 0;
          pointer-events: none;
          z-index: 0;
          overflow: hidden;
        }
        .orb {
          position: absolute;
          border-radius: 50%;
          filter: blur(120px);
          animation: orb-float 32s infinite ease-in-out alternate;
        }
        .orb-a {
          width: 40vw;
          height: 40vw;
          top: -10vw;
          left: -10vw;
          background-color: rgba(255, 221, 0, 0.12);
          animation-duration: 38s;
        }
        .orb-b {
          width: 30vw;
          height: 30vw;
          bottom: -5vw;
          right: -5vw;
          background-color: rgba(255, 221, 0, 0.08);
          animation-duration: 28s;
          animation-delay: -10s;
        }
        .orb-c {
          width: 55vw;
          height: 55vw;
          top: 45%;
          left: 25%;
          background-color: rgba(255, 255, 255, 0.025);
          animation-duration: 44s;
          animation-delay: -5s;
        }
        @keyframes orb-float {
          0%   { transform: translate(0, 0) scale(1); }
          50%  { transform: translate(5vw, 5vw) scale(1.08); }
          100% { transform: translate(-3vw, 8vw) scale(0.92); }
        }
        /* Hero arcs — SVG-driven glowing rings */
        .hero-rings {
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          height: 58vh;
          pointer-events: none;
          overflow: hidden;
        }
        .hero-rings-svg {
          position: absolute;
          top: 0;
          left: 50%;
          transform: translateX(-50%);
          width: 140%;
          height: 100%;
          filter: drop-shadow(0 0 3px rgba(255,242,160,0.7)) drop-shadow(0 0 12px rgba(255,221,0,0.3));
        }
        .hero-rings-svg g {
          will-change: transform;
        }
        .hero-rings::after {
          content: "";
          position: absolute;
          inset: 0;
          background: linear-gradient(180deg, transparent 30%, rgba(2,2,2,0.35) 70%, rgba(2,2,2,0.55) 100%);
          z-index: 1;
        }
        @keyframes arc-travel-1 { from { stroke-dashoffset: 0; } to { stroke-dashoffset: -4200; } }
        @keyframes arc-travel-2 { from { stroke-dashoffset: 0; } to { stroke-dashoffset: -3600; } }
        @keyframes arc-travel-3 { from { stroke-dashoffset: 0; } to { stroke-dashoffset: -3100; } }
        @keyframes arc-travel-4 { from { stroke-dashoffset: 0; } to { stroke-dashoffset: -2580; } }
        @keyframes arc-travel-5 { from { stroke-dashoffset: 0; } to { stroke-dashoffset: -2060; } }
        @keyframes arc-travel-6 { from { stroke-dashoffset: 0; } to { stroke-dashoffset: -1600; } }
        @keyframes arc-breathe {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(var(--breathe-y, -4px)); }
        }
        @media (prefers-reduced-motion: reduce) {
          .hero-rings svg *,
          .closing-section svg *,
          .orb {
            animation-duration: 0.01ms !important;
            animation-iteration-count: 1 !important;
          }
        }
        .closing-section {
          content-visibility: auto;
          contain-intrinsic-size: auto 900px;
        }
        @media (max-width: 768px) {
          .hero-rings { height: 40vh; }
          .hero-rings-svg { width: 200%; }
        }
      `}</style>

      {/* Ambient orbs — subtle drifting background layer */}
      <div className="ambient-orbs">
        <div className="orb orb-a" />
        <div className="orb orb-b" />
        <div className="orb orb-c" />
      </div>

      <div className="landing-shell">
        <header className="fixed inset-x-0 top-0 z-30 px-5 pt-6 md:px-8">
          <div className="mx-auto flex max-w-6xl items-center justify-between rounded-[40px] bg-black/40 backdrop-blur-[12px] border border-white/[0.08] px-5 py-3 md:px-7">
            <Link href="/" className="relative flex items-center gap-2">
              <Image src="/logo.png" alt="Basement" width={24} height={24} priority />
              <span className="text-xl font-bold text-white">Basement</span>
            </Link>
            <div className="relative flex items-center gap-5 md:gap-8">
              <a
                href={GITHUB_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="hidden items-center gap-2 text-[11px] uppercase tracking-[2px] text-white/58 transition-colors hover:text-white md:inline-flex"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
                </svg>
                <span>GitHub</span>
              </a>
              <Link
                href="/markets"
                className="rounded-full bg-white px-5 py-2 text-[11px] font-semibold uppercase tracking-[2px] text-black transition-transform hover:-translate-y-0.5"
              >
                Launch App
              </Link>
            </div>
          </div>
        </header>

        <section className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden px-6 pb-20 pt-24 md:px-8 md:pt-32">
          <div className="hero-rings">
            <svg className="hero-rings-svg" viewBox="0 0 1800 700" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg">
              <defs>
                <linearGradient id="ring-grad" x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor="#FFDD00" stopOpacity="0.2" />
                  <stop offset="20%" stopColor="#FFE840" stopOpacity="0.9" />
                  <stop offset="50%" stopColor="#FFF2A0" stopOpacity="1" />
                  <stop offset="80%" stopColor="#FFE840" stopOpacity="0.9" />
                  <stop offset="100%" stopColor="#FFDD00" stopOpacity="0.2" />
                </linearGradient>
              </defs>
              <g style={{ animation: 'arc-breathe 12s ease-in-out infinite', ['--breathe-y' as string]: '-5px' } as React.CSSProperties}>
                <ellipse cx="900" cy="-180" rx="880" ry="420" fill="none" stroke="url(#ring-grad)" strokeWidth="2" opacity="0.5" />
                <ellipse cx="900" cy="-180" rx="880" ry="420" fill="none" stroke="#FFF2A0" strokeWidth="3" opacity="0.9" strokeDasharray="1400 2800" style={{ animation: 'arc-travel-1 18s linear infinite' }} />
              </g>
              <g style={{ animation: 'arc-breathe 14s ease-in-out infinite 1s', ['--breathe-y' as string]: '-4px' } as React.CSSProperties}>
                <ellipse cx="900" cy="-80" rx="760" ry="360" fill="none" stroke="url(#ring-grad)" strokeWidth="1.8" opacity="0.4" />
                <ellipse cx="900" cy="-80" rx="760" ry="360" fill="none" stroke="#FFF2A0" strokeWidth="2.8" opacity="0.75" strokeDasharray="1200 2400" style={{ animation: 'arc-travel-2 22s linear infinite reverse' }} />
              </g>
              <g style={{ animation: 'arc-breathe 16s ease-in-out infinite 2s', ['--breathe-y' as string]: '-3px' } as React.CSSProperties}>
                <ellipse cx="900" cy="10" rx="650" ry="310" fill="none" stroke="url(#ring-grad)" strokeWidth="1.6" opacity="0.32" />
                <ellipse cx="900" cy="10" rx="650" ry="310" fill="none" stroke="#FFF2A0" strokeWidth="2.5" opacity="0.6" strokeDasharray="1000 2100" style={{ animation: 'arc-travel-3 16s linear infinite' }} />
              </g>
              <g style={{ animation: 'arc-breathe 13s ease-in-out infinite 3s', ['--breathe-y' as string]: '-2px' } as React.CSSProperties}>
                <ellipse cx="900" cy="90" rx="540" ry="260" fill="none" stroke="url(#ring-grad)" strokeWidth="1.4" opacity="0.25" />
                <ellipse cx="900" cy="90" rx="540" ry="260" fill="none" stroke="#FFF2A0" strokeWidth="2.2" opacity="0.45" strokeDasharray="800 1780" style={{ animation: 'arc-travel-4 20s linear infinite reverse' }} />
              </g>
              <g style={{ animation: 'arc-breathe 15s ease-in-out infinite 4s', ['--breathe-y' as string]: '-2px' } as React.CSSProperties}>
                <ellipse cx="900" cy="160" rx="430" ry="210" fill="none" stroke="url(#ring-grad)" strokeWidth="1.2" opacity="0.2" />
                <ellipse cx="900" cy="160" rx="430" ry="210" fill="none" stroke="#FFF2A0" strokeWidth="2" opacity="0.35" strokeDasharray="650 1410" style={{ animation: 'arc-travel-5 14s linear infinite' }} />
              </g>
              <g style={{ animation: 'arc-breathe 11s ease-in-out infinite 5s', ['--breathe-y' as string]: '-1px' } as React.CSSProperties}>
                <ellipse cx="900" cy="220" rx="330" ry="165" fill="none" stroke="url(#ring-grad)" strokeWidth="1" opacity="0.15" />
                <ellipse cx="900" cy="220" rx="330" ry="165" fill="none" stroke="#FFF2A0" strokeWidth="1.8" opacity="0.25" strokeDasharray="500 1080" style={{ animation: 'arc-travel-6 12s linear infinite reverse' }} />
              </g>
            </svg>
          </div>

          <div className="relative z-10 flex max-w-5xl flex-col items-center text-center">
            <div className="landing-glass mb-12 rounded-full px-4 py-2">
              <span className="relative text-[10px] uppercase tracking-[3px] text-white/68">
                Aptos Testnet sign-in only. No gas. No funds move.
              </span>
            </div>

            <div className="flex w-full flex-col items-center">
              <h1 className="h1-scale font-light uppercase text-white mr-auto md:ml-4">
                Predict
              </h1>
              <h1 className="h1-scale font-bold uppercase text-[#FFDD00] -mt-2 ml-auto md:mr-4">
                The Future
              </h1>
            </div>

            <p className="mb-8 mt-12 max-w-2xl text-base leading-relaxed text-white/58 md:text-lg">
              Sign in with your wallet on Aptos Testnet, claim VirtualUSD,
              and try the market flow without paying gas or moving funds.
            </p>
          </div>
        </section>

        <section id="how-it-works" className="relative border-t border-white/[0.06] py-24 md:py-32">
          <div className="mx-auto max-w-5xl px-6">
            <div className="mb-16 text-center">
              <p className="mb-4 text-[10px] uppercase tracking-[3px] text-[#FFDD00]">How It Works</p>
              <h2 className="text-4xl font-light uppercase leading-none text-white">Three Steps</h2>
              <h2 className="mt-1 text-4xl font-bold uppercase leading-none text-[#FFDD00]">To Trade</h2>
            </div>

            <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
              {[
                { step: "01", title: "Connect Wallet", desc: "Sign in with your Aptos Testnet wallet. Identity only, no gas, no deposits." },
                { step: "02", title: "Claim VirtualUSD", desc: "Get 50 free VirtualUSD every 24 hours from the faucet. Plenty to try the market." },
                { step: "03", title: "Trade & Win", desc: "Buy YES or NO on any market. Prices move with demand. Claim winnings when markets resolve." },
              ].map((item) => (
                <div key={item.step} className="landing-panel transition-transform duration-200 hover:-translate-y-1">
                  <span className="relative text-xs font-mono tracking-[2px] text-[#FFDD00]">{item.step}</span>
                  <h3 className="relative mb-2 mt-3 text-lg font-semibold text-white">{item.title}</h3>
                  <p className="relative text-sm leading-relaxed text-white/48">{item.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Closing section: Powered By + Start Predicting sharing one ring composition.
            Rings centered; Start Predicting block sits at section center = ring center;
            Powered By block anchored in upper third. */}
        <section className="closing-section relative border-t border-white/[0.06] overflow-hidden min-h-[1150px] md:min-h-[1250px]">
          {/* Ring layer — absolutely centered */}
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <svg
              width="1100"
              height="1100"
              viewBox="0 0 700 700"
              xmlns="http://www.w3.org/2000/svg"
              className="opacity-80 max-w-none"
              style={{ filter: 'drop-shadow(0 0 2px rgba(255,242,160,0.6)) drop-shadow(0 0 8px rgba(255,221,0,0.25))' }}
            >
              <defs>
                <linearGradient id="close-grad" x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor="#FFDD00" stopOpacity="0.15" />
                  <stop offset="30%" stopColor="#FFE840" stopOpacity="0.85" />
                  <stop offset="50%" stopColor="#FFF2A0" stopOpacity="1" />
                  <stop offset="70%" stopColor="#FFE840" stopOpacity="0.85" />
                  <stop offset="100%" stopColor="#FFDD00" stopOpacity="0.15" />
                </linearGradient>
              </defs>
              {/* Outer ring */}
              <ellipse cx="350" cy="350" rx="340" ry="340" fill="none" stroke="url(#close-grad)" strokeWidth="1.5" opacity="0.22">
                <animate attributeName="opacity" values="0.22;0.35;0.22" dur="8s" repeatCount="indefinite" />
              </ellipse>
              <ellipse cx="350" cy="350" rx="340" ry="340" fill="none" stroke="#FFF2A0" strokeWidth="2" opacity="0.2" strokeDasharray="700 1440">
                <animate attributeName="stroke-dashoffset" from="0" to="-2140" dur="20s" repeatCount="indefinite" />
              </ellipse>
              {/* Middle ring */}
              <ellipse cx="350" cy="350" rx="230" ry="230" fill="none" stroke="url(#close-grad)" strokeWidth="1.6" opacity="0.3">
                <animate attributeName="opacity" values="0.3;0.45;0.3" dur="10s" repeatCount="indefinite" begin="2s" />
              </ellipse>
              {/* Inner ring — tight halo around Launch App */}
              <ellipse cx="350" cy="350" rx="150" ry="150" fill="none" stroke="url(#close-grad)" strokeWidth="2" opacity="0.5">
                <animate attributeName="opacity" values="0.5;0.7;0.5" dur="6s" repeatCount="indefinite" begin="1s" />
              </ellipse>
              <ellipse cx="350" cy="350" rx="150" ry="150" fill="none" stroke="#FFF2A0" strokeWidth="2.5" opacity="0.4" strokeDasharray="320 620">
                <animate attributeName="stroke-dashoffset" from="0" to="-940" dur="12s" repeatCount="indefinite" />
              </ellipse>
            </svg>
          </div>

          {/* Powered By block — upper third, aligned with top arc of outer ring */}
          <div className="absolute left-1/2 top-[14%] z-10 w-full max-w-3xl -translate-x-1/2 px-6 text-center md:top-[15%]">
            <p className="mb-4 text-[10px] uppercase tracking-[3px] text-[#FFDD00]">Powered By</p>
            <h2 className="text-4xl font-light uppercase leading-none text-white md:text-5xl">Real-Time</h2>
            <h2 className="mt-1 text-4xl font-bold uppercase leading-none text-[#FFDD00] md:text-5xl">
              Crypto Prices
            </h2>
            <p className="mx-auto mt-6 max-w-xl text-base leading-relaxed text-white/55">
              Markets resolve automatically using live crypto prices.
              Wallets are used for Aptos Testnet sign-in only. VirtualUSD stays fully off-chain.
            </p>
          </div>

          {/* Start Predicting block — at exact vertical center = ring center;
              block is transform-centered so Start and Predicting straddle the midline,
              Launch App sits just below center line. */}
          <div className="absolute left-1/2 top-1/2 z-10 flex w-full max-w-3xl -translate-x-1/2 -translate-y-1/2 flex-col items-center px-6 text-center">
            <p className="mb-3 text-[10px] uppercase tracking-[3px] text-white/30">Ready?</p>
            <h2 className="text-3xl font-light uppercase text-white md:text-4xl">Start</h2>
            <h2 className="mt-1 text-3xl font-bold uppercase text-[#FFDD00] md:text-4xl">Predicting</h2>
            <Link
              href="/markets"
              className="mt-8 inline-block rounded-full bg-white px-10 py-4 text-[11px] font-semibold uppercase tracking-[2px] text-black transition-all hover:-translate-y-0.5 hover:shadow-[0_0_40px_rgba(255,255,255,0.3)]"
            >
              Launch App
            </Link>
          </div>
        </section>

        <footer className="relative border-t border-white/[0.06] py-6">
          <div className="mx-auto flex max-w-5xl items-center justify-center px-6">
            <span className="text-[10px] uppercase tracking-[2px] text-white/25">Basement, made by Isaac Zhang</span>
          </div>
        </footer>
      </div>
    </div>
  );
}
