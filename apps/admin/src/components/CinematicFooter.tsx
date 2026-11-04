"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  FOOTER_FRAMES,
  FOOTER_MESSAGE,
  FOOTER_SUPPORTING_COPY,
  FOOTER_FRAME_INTERVAL_MS,
} from "./footer-frames";

// Env-gate: the public-product links point at the public web app and render
// only when NEXT_PUBLIC_WEB_BASE_URL is defined; otherwise they are omitted
// entirely (no dead hrefs). Agreed public product paths: / (home), /safety
// (guides), /data-sources, /about, /privacy, /security, /terms.
const WEB_BASE_URL =
  typeof window !== "undefined" ? process.env.NEXT_PUBLIC_WEB_BASE_URL : undefined;

const PUBLIC_NAV = [
  {
    title: "Public product",
    items: [
      { label: "Emergency resources", path: "/" },
      { label: "Safety guides", path: "/safety" },
      { label: "Data sources", path: "/data-sources" },
      { label: "About SENTRAVYN", path: "/about" },
    ],
  },
  {
    title: "Trust and legal",
    items: [
      { label: "Privacy", path: "/privacy" },
      { label: "Security", path: "/security" },
      { label: "Terms", path: "/terms" },
    ],
  },
];

/**
 * Signature cinematic footer (DESIGN.md 4 — mandatory). Carried into the
 * admin shell so the identity remains consistent with the public product.
 *
 * - Deterministic frame progression (precomputed ASCII compositions).
 * - Readable monospace type, low DOM cost (a single <pre> re-render).
 * - Pause and replay controls.
 * - Respects `prefers-reduced-motion` (shows the settled frame, no motion).
 * - Static fallback for environments without IntersectionObserver.
 * - Stops advancing when not visible (IntersectionObserver), and pauses on
 *   document hidden, to keep CPU/GPU usage low.
 * - No strobe or rapid flashing (interval is deliberately slow).
 * - Clearly labelled an artistic visualisation.
 *
 * The footer carries useful navigation (DESIGN.md 4): admin workspace links
 * are cross-linked internally; public product and trust/legal links point at
 * the public web app and render only when NEXT_PUBLIC_WEB_BASE_URL is set,
 * so the admin console never ships dead hrefs.
 */

function useReducedMotion(): boolean {
  // useSyncExternalStore: no local state, so there is no setState to call in
  // an effect. SSR-safe server snapshot (assumes motion is allowed).
  return useSyncExternalStore(
    (onStoreChange) => {
      const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
      mq.addEventListener("change", onStoreChange);
      return () => mq.removeEventListener("change", onStoreChange);
    },
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    () => false,
  );
}

export function CinematicFooter() {
  const reduced = useReducedMotion();
  // Settled frame when reduced motion is on (DESIGN.md 4).
  const [frame, setFrame] = useState(reduced ? FOOTER_FRAMES.length - 1 : 0);
  const [playing, setPlaying] = useState(!reduced);
  const [visible, setVisible] = useState(true);
  const stageRef = useRef<HTMLDivElement>(null);

  // Loop the sequence deterministically.
  useEffect(() => {
    if (!playing || reduced || !visible) return;
    const id = window.setInterval(() => {
      setFrame((f) => (f + 1) % FOOTER_FRAMES.length);
    }, FOOTER_FRAME_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [playing, reduced, visible]);

  // Stop when the footer scrolls out of view / tab hidden (DESIGN.md 4).
  useEffect(() => {
    const el = stageRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          setVisible(entry.isIntersecting);
        }
      },
      { threshold: 0.25 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const togglePlay = useCallback(() => {
    if (reduced) return;
    setPlaying((p) => !p);
  }, [reduced]);

  const replay = useCallback(() => {
    if (reduced) return;
    setFrame(0);
    setPlaying(true);
  }, [reduced]);

  const settledIndex = FOOTER_FRAMES.length - 1;

  return (
    <footer className="cinematic-footer">
      <div className="footwork">
        <p className="footwork__label">
          An artistic visualisation. Not a real event, prediction or
          scientific simulation.
        </p>

        <div className="footwork__stage" ref={stageRef}>
          <pre
            className="footwork__art"
            aria-hidden="true"
            role="img"
            aria-label="Cinematic ASCII preparedness visualisation"
          >
            {reduced ? FOOTER_FRAMES[settledIndex] : FOOTER_FRAMES[frame]}
          </pre>
        </div>

        <p className="footwork__message">{FOOTER_MESSAGE}</p>
        <p className="footwork__copy">{FOOTER_SUPPORTING_COPY}</p>

        <div className="footwork__controls">
          {reduced ? (
            <button type="button" disabled>
              Motion disabled (reduced-motion)
            </button>
          ) : (
            <>
              <button type="button" onClick={togglePlay} aria-pressed={!playing}>
                {playing ? "Pause" : "Play"}
              </button>
              <button type="button" onClick={replay}>
                Replay
              </button>
            </>
          )}
        </div>

        <nav className="footwork__nav" aria-label="Footer">
          <div className="footwork__group">
            <h3>Admin workspace</h3>
            <ul>
              <li><Link href="/review">Review queue</Link></li>
              <li><Link href="/providers">Data providers</Link></li>
              <li><Link href="/audit">Audit log</Link></li>
              <li><Link href="/login">Sign in</Link></li>
            </ul>
          </div>
          {WEB_BASE_URL &&
            PUBLIC_NAV.map((group) => (
              <div className="footwork__group" key={group.title}>
                <h3>{group.title}</h3>
                <ul>
                  {group.items.map((item) => (
                    <li key={item.path}>
                      <a
                        href={`${WEB_BASE_URL}${item.path}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {item.label}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
        </nav>

        <p className="footwork__colophon">
          SENTRAVYN is an information and preparedness platform. It is not a
          substitute for local emergency services, official warnings,
          professional medical care or government evacuation instructions.
        </p>
      </div>
    </footer>
  );
}
