"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

type HorizontalScrollProps = {
  children: ReactNode;
  /** Etiqueta accesible del carrusel. */
  label: string;
  /** Tono del fondo de la sección que lo contiene. */
  tone?: "light" | "dark";
};

/**
 * Carrusel que se recorre de izquierda a derecha: con los botones,
 * con el trackpad/flechas del teclado o arrastrando en móvil.
 */
export function HorizontalScroll({ children, label, tone = "light" }: HorizontalScrollProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [atStart, setAtStart] = useState(true);
  const [atEnd, setAtEnd] = useState(false);

  const updateState = useCallback(() => {
    const el = trackRef.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    setAtStart(el.scrollLeft <= 2);
    setAtEnd(max <= 2 || el.scrollLeft >= max - 2);
  }, []);

  useEffect(() => {
    updateState();
    window.addEventListener("resize", updateState);
    return () => window.removeEventListener("resize", updateState);
  }, [updateState]);

  const scrollByDirection = (direction: 1 | -1) => {
    const el = trackRef.current;
    if (!el) return;
    const distance = Math.max(el.clientWidth * 0.8, 320);
    el.scrollBy({ left: direction * distance, behavior: "smooth" });
  };

  return (
    <div className="relative">
      <div
        ref={trackRef}
        onScroll={updateState}
        role="region"
        aria-label={label}
        tabIndex={0}
        className="hscroll flex gap-4 overflow-x-auto pb-4 sm:gap-6"
      >
        {children}
      </div>

      <div className="mt-2 flex items-center justify-between gap-4">
        <p className={`hidden text-xs sm:block ${tone === "dark" ? "text-white/55" : "text-slate-400"}`} aria-hidden="true">
          Desliza →
        </p>
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={() => scrollByDirection(-1)}
            disabled={atStart}
            aria-label={`Desplazar ${label} hacia la izquierda`}
            className={`flex h-11 w-11 items-center justify-center rounded-full border transition disabled:cursor-not-allowed disabled:opacity-35 ${
              tone === "dark"
                ? "border-white/25 bg-white/10 text-white hover:border-flag-yellow hover:text-flag-yellow"
                : "border-slate-300 bg-white text-slate-700 hover:border-flag-blue hover:text-flag-blue"
            }`}
          >
            <ArrowIcon direction="left" />
          </button>
          <button
            type="button"
            onClick={() => scrollByDirection(1)}
            disabled={atEnd}
            aria-label={`Desplazar ${label} hacia la derecha`}
            className={`flex h-11 w-11 items-center justify-center rounded-full border transition disabled:cursor-not-allowed disabled:opacity-35 ${
              tone === "dark"
                ? "border-white/25 bg-white/10 text-white hover:border-flag-yellow hover:text-flag-yellow"
                : "border-slate-300 bg-white text-slate-700 hover:border-flag-blue hover:text-flag-blue"
            }`}
          >
            <ArrowIcon direction="right" />
          </button>
        </div>
      </div>
    </div>
  );
}

function ArrowIcon({ direction }: { direction: "left" | "right" }) {
  const rotate = direction === "left" ? "rotate(180 12 12)" : undefined;
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <g transform={rotate}>
        <path d="M5 12h14" />
        <path d="m13 6 6 6-6 6" />
      </g>
    </svg>
  );
}
