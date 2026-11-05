"use client";

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
} from "./footwork-frames";

/**
 * Signature cinematic footer (DESIGN.md 4 — mandatory).
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
 * The footer also carries useful navigation (DESIGN.md 4): emergency
 * resources, safety guides, data sources, about, privacy, security, terms,
 * contact. Not a generic four-column SaaS footer.
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
  const [tabHidden, setTabHidden] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);

  // Loop the sequence deterministically.
  useEffect(() => {
    if (!playing || reduced || !visible || tabHidden) return;
    const id = window.setInterval(() => {
      setFrame((f) => (f + 1) % FOOTER_FRAMES.length);
    }, FOOTER_FRAME_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [playing, reduced, visible, tabHidden]);

  // Stop when the footer scrolls out of view (IntersectionObserver). Where the
  // observer is unavailable the footer is a static fallback: it holds the
  // current frame and does not advance.
  useEffect(() => {
    const el = stageRef.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      if (!el) return;
      setVisible(false);
      return;
    }
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

  // Pause when the tab/document is hidden, to keep CPU/GPU usage low.
  useEffect(() => {
    if (typeof document === "undefined" || !("visibilityState" in document)) {
      return;
    }
    const onVisibilityChange = () => setTabHidden(document.hidden);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
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
          {/* The ASCII artwork is decorative; the label above it describes
              what it is, so the <pre> is hidden from the accessibility tree. */}
          <pre className="footwork__art" aria-hidden="true">
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
            <h3>Preparedness</h3>
            <ul>
              <li><a href="/alerts" className="planned">Emergency alerts</a></li>
              <li><a href="/guides" className="planned">Safety guides</a></li>
              <li><a href="/map" className="planned">Emergency map</a></li>
              <li><a href="/prepare" className="planned">Household preparedness</a></li>
            </ul>
          </div>
          <div className="footwork__group">
            <h3>Trust &amp; sources</h3>
            <ul>
              <li><a href="/data-sources" className="planned">Data sources</a></li>
              <li><a href="/verification" className="planned">Place verification</a></li>
              <li><a href="/about" className="planned">About SENTRAVYN</a></li>
            </ul>
          </div>
          <div className="footwork__group">
            <h3>Legal &amp; privacy</h3>
            <ul>
              <li><a href="/privacy" className="planned">Privacy</a></li>
              <li><a href="/security" className="planned">Security</a></li>
              <li><a href="/terms" className="planned">Terms</a></li>
              <li><a href="/contact" className="planned">Contact</a></li>
            </ul>
          </div>
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
