"use client";

import { useEffect, useState } from "react";

export type LandingSection = { id: string; label: string };

/**
 * Barra de progreso del scroll y navegación lateral por secciones.
 * Se muestra solo en la landing.
 */
export function ScrollChrome({ sections }: { sections: LandingSection[] }) {
  const [progress, setProgress] = useState(0);
  const [active, setActive] = useState(sections[0]?.id ?? "");

  useEffect(() => {
    const update = () => {
      const doc = document.documentElement;
      const max = doc.scrollHeight - doc.clientHeight;
      setProgress(max > 4 ? Math.min(1, Math.max(0, doc.scrollTop / max)) : 0);
    };

    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, []);

  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (visible) setActive(visible.target.id);
      },
      { threshold: [0.25, 0.5, 0.75], rootMargin: "-15% 0px -45% 0px" },
    );

    for (const section of sections) {
      const node = document.getElementById(section.id);
      if (node) observer.observe(node);
    }
    return () => observer.disconnect();
  }, [sections]);

  return (
    <>
      <div
        className="pointer-events-none fixed inset-x-0 top-0 z-50 h-1 bg-transparent"
        role="progressbar"
        aria-label="Progreso de lectura"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(progress * 100)}
      >
        <div
          className="h-full bg-[linear-gradient(90deg,#fcd116_0%,#003893_55%,#ce1126_100%)] transition-[width] duration-150"
          style={{ width: `${progress * 100}%` }}
        />
      </div>

      <nav
        aria-label="Secciones de la página"
        className="fixed right-5 top-1/2 z-40 hidden -translate-y-1/2 flex-col items-end gap-3 lg:flex"
      >
        {sections.map((section) => {
          const isActive = active === section.id;
          return (
            <a
              key={section.id}
              href={`#${section.id}`}
              aria-current={isActive ? "true" : undefined}
              className="group flex items-center gap-2"
            >
              <span
                className={`hidden rounded-full px-2.5 py-1 text-[11px] font-medium transition ${
                  isActive
                    ? "bg-flag-blue text-white opacity-100"
                    : "bg-slate-900/85 text-slate-100 opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100"
                }`}
              >
                {section.label}
              </span>
              <span
                className={`block h-2.5 rounded-full border transition-all ${
                  isActive
                    ? "w-2.5 border-flag-red/40 bg-flag-red ring-2 ring-flag-red/30"
                    : "w-2 border-slate-900/25 bg-slate-400 group-hover:bg-slate-500"
                }`}
              />
            </a>
          );
        })}
      </nav>
    </>
  );
}
