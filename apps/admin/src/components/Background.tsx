import type { CSSProperties } from "react";

/**
 * Custom background system (DESIGN.md 3: original, purposeful, layered).
 *
 * A restrained atmospheric treatment: deep base, a subtle topographic
 * contour motif, and soft radial lighting. Pure CSS (see globals.css
 * .sentravyn-bg), no external assets, no excessive glow. It sits behind
 * all content and never competes with operational information (DESIGN.md
 * 3, 6: admin = operational clarity over marketing aesthetics).
 */
export default function Background() {
  return (
    <div
      aria-hidden="true"
      className="sentravyn-bg"
      style={{ "--sentravyn-topo-opacity": "0.4" } as CSSProperties}
    />
  );
}
