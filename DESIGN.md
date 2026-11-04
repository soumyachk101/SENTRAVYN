## Approved project brand

**Brand name: SENTRAVYN.** Do not use the former working name in new product UI, documentation, metadata, package names or generated assets. Existing historic references may be retained only when needed for migration history.

# SENTRAVYN Design System & Visual Direction

## 1. Design intent

SENTRAVYN is a global public-safety product. Its interface must feel calm, credible, precise, human and premium. It must not resemble a generic AI SaaS template, cyberpunk dashboard or gaming interface.

**Visual references**
- https://www.ditto.site/
- https://veylqorix.vercel.app

Study the references for visual craft, custom surfaces, typography, composition, depth and polish. Do not copy their brand, assets, code or layouts.

## 2. Design dials

- Energy: 2/3 — composed, confident and distinctive.
- Rhythm: 3/3 — varied, editorial compositions with intentional density.
- Motion: 2/3 — purposeful, subtle and restrained.

## 3. Mandatory visual requirements

### Custom backgrounds

Custom-designed backgrounds are a core part of SENTRAVYN's identity. Do not replace them with plain solid fills or generic gradients.

Build reusable background treatments using purposeful combinations of:
- Original SVG artwork.
- Procedural patterns.
- Layered atmospheric textures.
- Subtle grain/noise.
- Restrained radial lighting.
- Topographic or cartographic motifs where relevant.
- Carefully composed shadows and depth.
- Custom section transitions.

Each treatment must have a clear purpose and be documented. Do not apply every effect everywhere. Avoid generic blue-purple mesh gradients, random grids, excessive glow and decorative noise that reduces legibility.

Backgrounds must preserve contrast and must not obscure emergency information, map labels, controls or accessibility affordances.

### Typography

Use a considered font system. Candidate families include Geist, Inter, Manrope, Satoshi and Instrument Sans. Use IBM Plex Mono or another readable monospace family for technical metadata and ASCII artwork.

Choose a cohesive combination; do not mix fonts without reason. Load fonts efficiently, use appropriate fallbacks and verify multilingual glyph coverage.

Define tokens for display, headings, body, labels, metadata, alert text and technical identifiers.

### Spacing and composition

No oversized empty sections, arbitrary padding, excessive card height, repeated identical gaps or huge blank areas.

Premium whitespace is intentional, not wasted space. Use content-driven spacing, balanced density, varied section composition, responsive grids and clear hierarchy.

Avoid repeating the same centred heading plus three-card layout on every page. Use cards only when they improve comparison, grouping or action clarity.

### Color

No neon colors. No cyberpunk palette. No oversaturated gradients. No decorative electric glow.

Use a sophisticated system based on deep atmospheric neutrals, warm off-whites, slate tones and restrained muted accents. Emergency colors must be semantic, accessible and used only when warranted. Never communicate status through color alone.

Do not make every page black-and-purple. The visual system may use light and dark surfaces where appropriate.

### Emoji policy

Zero emojis anywhere in SENTRAVYN product UI, web, mobile, admin, notifications, copy or documentation examples. Use Lucide icons or original SVG iconography.

## 4. Signature cinematic ASCII footer

The cinematic ASCII nuclear-explosion artwork is a required signature footer feature. It must not be removed, replaced by a static stock image, or reduced to a generic terminal window.

This is a stylised artistic educational visualization, not an actual event, prediction or scientific detonation simulation.

### Sequence

1. Silence: restrained terminal-like field.
2. Initial flash: abstract, brief expansion of character density.
3. Expansion: composed spherical visual growth.
4. Rising column: abstract vertical form.
5. Mushroom-cloud silhouette: recognisable artistic silhouette.
6. Settlement: composition gradually stabilises.
7. Closing message: `PREPAREDNESS SAVES LIVES.`

Supporting copy:
`Understand the risks. Follow verified guidance. Protect what matters.`

### Implementation constraints

- Original, deliberately composed ASCII frames.
- Deterministic frame progression.
- Readable monospaced type.
- Efficient canvas or precomputed frame rendering.
- No excessive DOM nodes.
- Responsive dimensions and mobile fallback.
- Static fallback for unsupported environments.
- Pause and replay controls.
- Respect `prefers-reduced-motion`.
- No strobe, rapid flashing or aggressive effects.
- No weapon construction detail or technical blast modelling.
- Clearly label the work as an artistic visualization.
- The animation must not compete with emergency actions or critical content.
- Keep CPU/GPU usage low and stop animation when not visible where practical.

The footer must also contain useful navigation: emergency resources, safety guides, data sources, about, privacy, security, terms and appropriate contact information. Do not create a generic four-column SaaS footer.

## 5. Motion and interaction

Use motion to clarify state, hierarchy or transitions. Prefer subtle page transitions, map transitions, focused hover feedback, loading indicators and carefully controlled reveals.

Avoid unnecessary parallax, bouncing cards, floating decoration, cursor gimmicks and repetitive animation. Critical emergency states must remain immediate and stable.

## 6. Page-specific design direction

### Landing page
A strong, original hero with clear purpose, immediate access to map and preparedness resources, and transparent limitations. No fake statistics, fabricated partner logos or invented trust claims.

### Emergency dashboard
Prioritise current alerts, affected area, recommended official action, timestamp, source and data freshness. Minimise decoration.

### Map
Map legibility is paramount. Use restrained layers, clear legends, accessible controls, useful clustering and explicit verification states.

### Safety guides
Editorial, readable, structured and source-backed. Show review date, version and authority.

### Admin
Operational clarity over marketing aesthetics. Clear audit trail, source provenance, role restrictions and approval workflow.

### Footer
The cinematic ASCII artwork is the visual signature, with navigation remaining clear and accessible.

## 7. Responsive and accessibility requirements

Inspect at 360, 390, 768, 1024, 1440 and 1920 CSS pixels.

Target WCAG 2.2 AA. Ensure keyboard navigation, visible focus, semantic structure, screen-reader labels, sufficient contrast, reduced motion, touch target size and status communication beyond color.

Do not simply shrink desktop layouts for mobile. Design mobile navigation, map controls, bottom sheets, emergency actions and footer independently.

## 8. Visual review checklist

- Does each section have a clear purpose?
- Is the composition distinct without being arbitrary?
- Are backgrounds custom and purposeful?
- Is typography consistent and readable?
- Is spacing intentional and compact?
- Are there zero emojis and zero neon colors?
- Is any content fabricated?
- Do all controls work?
- Are loading, empty, error, offline and stale states designed?
- Does the page remain usable at all target sizes?
- Does motion respect reduced-motion settings?
- Is emergency content more prominent than decoration?

A page is not visually complete until it has been inspected in a browser at desktop and mobile sizes and significant issues have been fixed.
