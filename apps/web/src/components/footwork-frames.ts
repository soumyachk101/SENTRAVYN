/**
 * Cinematic ASCII footer frame data (DESIGN.md 4 — mandatory signature).
 *
 * This is a stylised ARTISTIC visualisation of preparedness, not a real
 * event, prediction or scientific detonation simulation (DESIGN.md 4;
 * SAFETY-POLICY.md 4). The frames are original and deliberately composed,
 * deterministic, and advance at a restrained rate. They contain no weapon
 * construction detail and no blast modelling (DESIGN.md 4).
 *
 * Sequence (DESIGN.md 4):
 *   0 silence  -> 1 initial flash -> 2 expansion -> 3 rising column
 *   -> 4 mushroom-cloud silhouette -> 5 settlement
 *
 * Each frame is a fixed-width ASCII composition rendered in a readable
 * monospace type. 36 columns wide, 13 rows tall.
 */

export const FOOTER_FRAMES: readonly string[] = [
  // 0 — Silence: a restrained terminal-like field.
  [
    '....................................',
    '....................................',
    '....................................',
    '....................................',
    '....................................',
    '....................................',
    '....................................',
    '....................................',
    '....................................',
    '....................................',
    '....................................',
    '....................................',
    '....................................',
  ].join('\n'),
  // 1 — Initial flash: a brief expansion of character density at ground level.
  [
    '....................................',
    '....................................',
    '....................................',
    '....................................',
    '....................................',
    '....................................',
    '....................................',
    '....................................',
    '....................................',
    '..........*oOoooOo*.................',
    '.........oOOOOOOOOOo..............',
    '........O00000000000O.............',
    '....................................',
  ].join('\n'),
  // 2 — Expansion: composed spherical growth above the horizon line.
  [
    '....................................',
    '....................................',
    '....................................',
    '....................................',
    '..............Oo0.................',
    '.............0OOO0................',
    '............o0OOO0o...............',
    '.............0OOO0................',
    '..............Oo0.................',
    '...........o0O0O0O0o..............',
    '..........O0000000000O............',
    '....................................',
    '....................................',
  ].join('\n'),
  // 3 — Rising column: an abstract vertical form.
  [
    '..............oOOOo.................',
    '..............0OOO0.................',
    '..............oOOOo.................',
    '..............0OOO0.................',
    '..............oOOOo.................',
    '..............0OOO0.................',
    '..............oOOOo.................',
    '..............0OOO0.................',
    '..............oOOOo.................',
    '............o0OOOO0o................',
    '...........O0000000O0o..............',
    '............O000000O................',
    '....................................',
  ].join('\n'),
  // 4 — Mushroom-cloud silhouette: the recognisable artistic form.
  [
    '.......oOOOOOOOOOOOOOOOo............',
    '.....o0OOOOOOOOOOOOOOO0o...........',
    '....O0OOOOOOOOOOOOOOOO0O............',
    '...O0OOOOOOOOOOOOOOOOOOO............',
    '...o0OOOOOOOOOOOOOOOOO0o............',
    '....O0OOOOOOOOOOOOO0O...............',
    '......oOOOOOOOOOOOo.................',
    '.........oOOOOOOo...................',
    '..........oOOOOOo....................',
    '..........oOOOOOo....................',
    '.........o0OOOOO0o...................',
    '.........O000000Oo...................',
    '..........O000Oo.....................',
  ].join('\n'),
  // 5 — Settlement: the composition stabilises.
  [
    '.........OOOOOOOOOOOOO..............',
    '.......OOOOOOOOOOOOOOO..............',
    '.......OOOOOOOOOOOOOOO..............',
    '........OOOOOOOOOOOOO...............',
    '.........OOOOOOOOOOO................',
    '...........OOOOOO...................',
    '............OOOOO....................',
    '............OOOOO....................',
    '............OOOOO....................',
    '............OOOOO....................',
    '............OOOOO....................',
    '............OOOOO....................',
    '.............OOO.....................',
  ].join('\n'),
];

export const FOOTER_MESSAGE = 'PREPAREDNESS SAVES LIVES.';
export const FOOTER_SUPPORTING_COPY =
  'Understand the risks. Follow verified guidance. Protect what matters.';

/**
 * ms between frames. Restrained by design (DESIGN.md 4: no strobe, no rapid
 * flashing). ~2.4s full cycle across 6 frames.
 */
export const FOOTER_FRAME_INTERVAL_MS = 400;
