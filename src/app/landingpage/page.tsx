"use client";

import Link from "next/link";
import { useLocale, LocaleToggle } from "@/lib/i18n";
import RollingTagline from "@/components/RollingTagline";

const Sparkle = ({ size = 28, className = "" }: { size?: number; className?: string }) => (
  <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} fill="none" className={className}>
    {[
      [size/2, 1, size/2, size-1],
      [1, size/2, size-1, size/2],
      [size*0.18, size*0.18, size*0.82, size*0.82],
      [size*0.82, size*0.18, size*0.18, size*0.82],
    ].map(([x1,y1,x2,y2], i) => (
      <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke="#d946ef" strokeWidth={1.8} strokeLinecap="round" />
    ))}
  </svg>
);

/* ── Rolling word animation ─────────────────────────────────────
   Two-slot crossfade: outgoing word blurs + drifts up while
   incoming word rises from below with a soft spring.            */

const GlassButton = ({ children, primary = false, href = "/login" }: { children: React.ReactNode; primary?: boolean; href?: string }) => (
  <Link
    href={href}
    className={`inline-flex items-center px-7 py-3 rounded-full text-sm font-semibold text-white transition-all hover:scale-105 ${
      primary
        ? "bg-[#d946ef]/55 border border-[#d946ef]/30 hover:bg-[#d946ef]/70"
        : "bg-white/7 border border-white/12 hover:bg-white/12"
    }`}
  >
    {children}
  </Link>
);

export default function LandingPage() {
  const { t } = useLocale();

  const useCases = [
    { tag: t('landing.uc1.tag'), title: t('landing.uc1.title'), desc: t('landing.uc1.desc'), feature: t('landing.uc1.feature'), img: "/landing/uc-retouch.jpg" },
    { tag: t('landing.uc2.tag'), title: t('landing.uc2.title'), desc: t('landing.uc2.desc'), feature: t('landing.uc2.feature'), img: "/landing/uc-explore.jpg" },
    { tag: t('landing.uc3.tag'), title: t('landing.uc3.title'), desc: t('landing.uc3.desc'), feature: t('landing.uc3.feature'), img: "/landing/uc-storyboard.jpg" },
    { tag: t('landing.uc4.tag'), title: t('landing.uc4.title'), desc: t('landing.uc4.desc'), feature: t('landing.uc4.feature'), img: "/landing/uc-video.jpg" },
  ];

  return (
    <div className="relative min-h-screen bg-black text-white overflow-hidden max-w-[1440px] mx-auto">
      {/* eslint-disable-next-line @next/next/no-css-tags */}
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Caveat:wght@400;500&display=swap');`}</style>
      {/* Language toggle */}
      <div className="absolute top-4 right-4 z-20">
        <LocaleToggle />
      </div>

      {/* ─── Hero ─── */}
      <section className="relative flex flex-col items-center">
        {/* Glow */}
        <div className="pointer-events-none absolute top-[-80px] left-1/2 -translate-x-1/2 w-[700px] h-[600px] rounded-full bg-[radial-gradient(ellipse,#d946ef18_0%,transparent_70%)]" />

        {/* Text */}
        <div className="relative z-10 flex flex-col items-center text-center pt-16 lg:pt-24 px-6 max-w-[660px]">
          <Sparkle size={28} />
          <h1 className="mt-4 text-[52px] lg:text-[88px] font-extrabold tracking-[-0.04em] leading-[1]">
            Makaron
          </h1>

          {/* Rolling tagline */}
          <p className="mt-3 leading-tight">
            <RollingTagline className="text-2xl lg:text-[32px]" />
          </p>

          <p className="mt-6 text-[15px] lg:text-lg text-[#a1a1aa] leading-relaxed max-w-[480px]">
            {t('landing.heroDesc1')}
            <br />
            {t('landing.heroDesc2')}
          </p>
          <div className="mt-8 flex gap-3">
            <GlassButton primary>{t('landing.tryFree')}</GlassButton>
            <GlassButton>{t('landing.watchDemo')}</GlassButton>
          </div>
        </div>

        {/* ── Device mockups — overlapping composition ── */}
        <div className="relative z-10 mt-14 lg:mt-20 w-full max-w-[1000px] px-5 lg:px-8">
          {/* Desktop browser — main, centered */}
          <div className="relative rounded-xl border border-white/10 bg-[#0d0d0d] overflow-hidden shadow-[0_20px_80px_-12px_rgba(217,70,239,.12)]">
            {/* Browser chrome bar */}
            <div className="flex items-center gap-1.5 px-4 py-2.5 bg-[#161616] border-b border-white/6">
              <span className="w-[10px] h-[10px] rounded-full bg-[#ff5f57]/80" />
              <span className="w-[10px] h-[10px] rounded-full bg-[#febc2e]/80" />
              <span className="w-[10px] h-[10px] rounded-full bg-[#28c840]/80" />
              <div className="ml-4 flex-1 max-w-[280px] h-[22px] rounded-md bg-white/5 border border-white/8 flex items-center justify-center">
                <span className="text-[10px] text-white/30 tracking-wide">makaron.app</span>
              </div>
            </div>
            <img
              src="/landing/desktop-screenshot.jpg"
              alt="Makaron Desktop"
              className="w-full block"
            />
          </div>

          {/* Phone — overlapping bottom-left, floating above */}
          <div className="absolute -bottom-12 -left-3 lg:left-4 lg:-bottom-16 w-[140px] lg:w-[220px] z-20">
            <div className="aspect-[9/19.5] rounded-[20px] lg:rounded-[30px] border-2 border-white/15 bg-[#0d0d0d] p-[3px] lg:p-[5px] shadow-[0_16px_60px_-8px_rgba(0,0,0,.9)]">
              <div className="w-full h-full rounded-[17px] lg:rounded-[25px] overflow-hidden bg-black">
                <img
                  src="/landing/phone-screenshot.jpg"
                  alt="Makaron Mobile"
                  className="w-full h-full object-cover"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Extra bottom space for the floating phone */}
        <div className="h-16 lg:h-24" />
      </section>

      {/* ─── Statement ─── */}
      <section className="py-12 lg:py-20 text-center">
        <p className="text-3xl lg:text-6xl font-extrabold tracking-tight text-white/25">
          {t('landing.statement')}
        </p>
      </section>

      {/* ─── Bento Features ─── */}
      <section className="px-5 lg:px-20 space-y-4">
        <div className="flex flex-col lg:flex-row gap-4">
          {/* Tips - wide card */}
          <div className="relative flex-1 min-h-[320px] lg:min-h-[400px] rounded-2xl overflow-hidden border border-white/6 bg-white/5">
            <img src="/landing/tips.jpg" alt="Smart Tips" className="absolute inset-0 w-full h-[55%] object-cover" />
            <div className="absolute bottom-0 left-0 right-0 p-6 lg:p-8 bg-gradient-to-t from-[#0a0a0a] via-[#0a0a0a]/90 to-transparent pt-20">
              <p className="font-[Caveat,cursive] text-xl lg:text-2xl text-[#d946ef]">{t('landing.tips.label')}</p>
              <h3 className="mt-1 text-xl lg:text-[28px] font-bold leading-tight">{t('landing.tips.title')}</h3>
              <p className="mt-2 text-sm text-[#a1a1aa] leading-relaxed max-w-[400px]">{t('landing.tips.desc')}</p>
            </div>
          </div>

          {/* Agent - narrow card */}
          <div className="relative lg:w-[360px] min-h-[320px] lg:min-h-[400px] rounded-2xl overflow-hidden border border-white/6 bg-white/5">
            <img src="/landing/agent.jpg" alt="AI Agent" className="absolute inset-0 w-full h-[55%] object-cover" />
            <div className="absolute bottom-0 left-0 right-0 p-6 lg:p-8 bg-gradient-to-t from-[#0a0a0a] via-[#0a0a0a]/90 to-transparent pt-20">
              <p className="font-[Caveat,cursive] text-xl lg:text-2xl text-[#d946ef]">{t('landing.agent.label')}</p>
              <h3 className="mt-1 text-xl lg:text-2xl font-bold leading-tight">{t('landing.agent.title')}</h3>
              <p className="mt-2 text-sm text-[#a1a1aa] leading-relaxed">{t('landing.agent.desc')}</p>
            </div>
          </div>
        </div>

        {/* Video - full width */}
        <div className="relative h-[280px] lg:h-[320px] rounded-2xl overflow-hidden border border-white/6 bg-white/5">
          <img src="/landing/video.jpg" alt="Video" className="absolute inset-0 w-full h-full object-cover" />
          <div className="absolute inset-0 bg-gradient-to-r from-black/85 via-black/40 to-black/85" />
          <div className="relative z-10 p-6 lg:p-10 flex flex-col justify-end h-full">
            <p className="font-[Caveat,cursive] text-xl lg:text-2xl text-[#d946ef]">{t('landing.video.label')}</p>
            <h3 className="mt-1 text-xl lg:text-[28px] font-bold leading-tight">{t('landing.video.title')}</h3>
            <p className="mt-2 text-sm text-[#a1a1aa]/80 leading-relaxed max-w-[440px]">{t('landing.video.desc')}</p>
          </div>
        </div>
      </section>

      {/* ─── Use Cases ─── */}
      <section className="px-5 lg:px-20 py-20 lg:py-28">
        <p className="font-[Caveat,cursive] text-xl lg:text-2xl text-[#d946ef]">{t('landing.useCases.label')}</p>
        <h2 className="mt-2 text-3xl lg:text-[44px] font-bold tracking-tight leading-tight">
          {t('landing.useCases.heading')}
        </h2>
        <p className="mt-3 text-sm lg:text-base text-[#a1a1aa]">
          {t('landing.useCases.sub')}
        </p>

        <div className="mt-10 grid grid-cols-1 lg:grid-cols-2 gap-4">
          {useCases.map((uc) => (
            <div key={uc.tag} className="relative min-h-[360px] lg:min-h-[460px] rounded-2xl overflow-hidden border border-white/6 bg-white/5">
              <img src={uc.img} alt={uc.title} className="absolute inset-0 w-full h-[60%] object-cover" />
              <div className="absolute inset-x-0 bottom-0 p-5 lg:p-7 bg-gradient-to-t from-[#0a0a0a] via-[#0a0a0a]/95 to-transparent pt-24">
                <p className="text-[10px] lg:text-[11px] font-semibold text-[#d946ef] tracking-[2px]">{uc.tag}</p>
                <h3 className="mt-1 text-lg lg:text-2xl font-bold">{uc.title}</h3>
                <p className="mt-2 text-xs lg:text-sm text-[#a1a1aa] leading-relaxed">{uc.desc}</p>
                <p className="mt-2 text-xs text-[#d946ef]/55 font-medium">{uc.feature}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ─── Final CTA ─── */}
      <section className="relative py-24 lg:py-32 flex flex-col items-center text-center">
        <div className="pointer-events-none absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[400px] rounded-full bg-[radial-gradient(ellipse,#d946ef12_0%,transparent_70%)]" />
        <Sparkle size={32} />
        <h2 className="mt-5 text-4xl lg:text-[56px] font-extrabold tracking-tight leading-[1.1]">
          {t('landing.cta.heading1')}
          <br />
          {t('landing.cta.heading2')}
        </h2>
        <p className="mt-4 text-sm lg:text-base text-[#a1a1aa]">
          {t('landing.cta.sub')}
        </p>
        <div className="mt-8">
          <GlassButton primary href="/login">{t('landing.cta.button')}</GlassButton>
        </div>
      </section>

      {/* ─── Footer ─── */}
      <footer className="border-t border-[#1f1f1f] py-6 px-5 lg:px-20 flex flex-col lg:flex-row items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="text-sm font-extrabold tracking-tight">Makaron</span>
          <span className="text-sm text-[#a1a1aa]/20">·</span>
          <span className="font-[Caveat,cursive] text-sm text-[#d946ef]/35">{t('landing.tagline')}</span>
        </div>
        <span className="text-xs text-[#a1a1aa]/20">© 2026</span>
      </footer>
    </div>
  );
}
