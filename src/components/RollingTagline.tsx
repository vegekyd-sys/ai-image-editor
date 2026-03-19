"use client";

import { useState, useEffect, useRef } from "react";

const WORDS = ["creative", "retouching", "branding", "anime"];

export default function RollingTagline({ className = "" }: { className?: string }) {
  const [idx, setIdx] = useState(0);
  const [phase, setPhase] = useState<"idle" | "glitch" | "enter">("idle");
  const measRef = useRef<HTMLSpanElement>(null);
  const [width, setWidth] = useState<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    if (measRef.current) setWidth(measRef.current.offsetWidth);
  }, [idx]);

  useEffect(() => {
    const cycle = () => {
      setPhase("glitch");
      timer.current = setTimeout(() => {
        setIdx(i => (i + 1) % WORDS.length);
        setPhase("enter");
        timer.current = setTimeout(() => setPhase("idle"), 600);
      }, 400);
    };
    const id = setInterval(cycle, 3000);
    return () => { clearInterval(id); clearTimeout(timer.current); };
  }, []);

  const word = WORDS[idx];

  return (
    <span className={`font-[Caveat,cursive] text-[#d946ef] whitespace-nowrap ${className}`}>
      <style>{`
        @keyframes glitch-out {
          0%   { transform: translate(0,0) skewX(0deg); opacity:1; filter:blur(0); color:#d946ef; }
          15%  { transform: translate(4px,-2px) skewX(-8deg); opacity:1; color:#22d3ee; }
          30%  { transform: translate(-3px,1px) skewX(5deg); opacity:.8; filter:blur(1px); color:#d946ef; }
          50%  { transform: translate(6px,-3px) skewX(-12deg); opacity:.6; filter:blur(2px); clip-path:inset(20% 0 40% 0); color:#22d3ee; }
          70%  { transform: translate(-4px,4px) skewX(8deg); opacity:.3; filter:blur(3px); clip-path:inset(60% 0 10% 0); color:#d946ef; }
          100% { transform: translate(0,20px) skewX(0deg); opacity:0; filter:blur(6px); clip-path:inset(0); }
        }
        @keyframes glitch-in {
          0%   { transform: translate(0,-20px) skewX(0deg); opacity:0; filter:blur(6px); color:#22d3ee; }
          20%  { transform: translate(-3px,-8px) skewX(6deg); opacity:.4; filter:blur(3px); clip-path:inset(50% 0 20% 0); color:#d946ef; }
          40%  { transform: translate(5px,-2px) skewX(-10deg); opacity:.7; filter:blur(1px); clip-path:inset(10% 0 60% 0); color:#22d3ee; }
          60%  { transform: translate(-2px,1px) skewX(4deg); opacity:.9; filter:blur(0); clip-path:inset(0); color:#d946ef; }
          80%  { transform: translate(1px,0) skewX(-2deg); opacity:1; color:#d946ef; }
          100% { transform: translate(0,0) skewX(0deg); opacity:1; filter:blur(0); color:#d946ef; }
        }
      `}</style>
      one man{" "}
      <span ref={measRef} className="absolute invisible whitespace-nowrap" aria-hidden>{word}</span>
      <span
        className="relative inline-flex justify-center overflow-hidden align-bottom"
        style={{
          width: width ? `${width + 8}px` : "auto",
          transition: "width 0.5s cubic-bezier(.34,1.56,.64,1)",
          padding: "0 4px",
        }}
      >
        <span
          className="inline-block"
          style={{
            color: "#d946ef",
            animation:
              phase === "glitch" ? "glitch-out 0.4s ease-in forwards" :
              phase === "enter"  ? "glitch-in 0.55s ease-out forwards" :
                                   "none",
          }}
        >
          {word}
        </span>
      </span>
      {" "}studio
    </span>
  );
}
