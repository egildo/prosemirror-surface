// Placement — pure geometry, and the only opinion this package holds about
// where a floating thing goes.
//
// It knows nothing about editors, selections, ProseMirror, or toolbars. Given
// a rect to be near, a size to place, and a viewport to stay inside, it answers
// where. That is deliberate on two counts: it makes the rule testable without a
// layout engine (jsdom has no boxes, and geometry written inside an element is
// geometry nobody can check), and it keeps the element's job to *measuring* and
// *applying* rather than deciding.
//
// Why this exists at all: the anchor contract used to answer a **point**, and a
// point cannot be flipped. Flipping to the other side needs the far edge of the
// thing you are avoiding, and staying inside the viewport needs your own width —
// which `transform: translate(-50%, -100%)` was hiding, because a transform
// happens after layout and JS clamping cannot see past it. So the anchor now
// answers a rect, the transform is gone, and both numbers are computed here.
//
// The platform is growing a native answer to exactly this — CSS anchor
// positioning, where `position-try-fallbacks: flip-block, flip-inline` is this
// file in a declaration. It is not evenly shipped yet, and a surface that only
// works in one engine is not a surface. When it is everywhere, this becomes the
// fallback rather than the mechanism, and the contract below does not change.

/** What to be near, in viewport coordinates. */
export interface Rect {
  top: number
  left: number
  bottom?: number
  right?: number
}

/** What to place. */
export interface Size {
  width: number
  height: number
}

/** Where it goes, and which side it ended up on. */
export interface Placement {
  top: number
  left: number
  side: 'above' | 'below'
}

/** How much room to leave: `gap` from the anchor, `margin` from the viewport edge. */
export interface PlaceOptions {
  gap?: number
  margin?: number
  viewport?: Size
  /** Which side to try first. A strip over a selection wants `above` — chrome
   *  covering what you just selected is chrome you have to move. A menu hanging
   *  off its own button wants `below`, which is where everyone has looked for a
   *  dropdown since 1984. Either flips when its side has no room. */
  prefer?: 'above' | 'below'
}

// Clamp, with the honest degenerate case: when the thing is wider than the
// space it must fit in, prefer the near edge over centring it in nothing.
const clamp = (value: number, min: number, max: number): number =>
  max < min ? min : Math.min(Math.max(value, min), max)

/// Place `size` near `anchor`, inside `viewport`.
///
/// Above by default, because chrome that covers what you just selected is
/// chrome you have to move out of the way. Below when there is no room above —
/// and when there is room on neither side, whichever side has more, clamped.
/// Horizontally centred on the anchor, then pulled back inside the viewport,
/// which is the whole of the bug this replaces: a selection near the left
/// margin used to put half the strip off-screen with its first buttons
/// unreachable.
///
/// A point anchor (no `bottom`/`right`) is a zero-size rect, so every caller
/// written against the old contract keeps working and simply gains the clamping.
export function place(anchor: Rect, size: Size, options: PlaceOptions = {}): Placement {
  const gap = options.gap ?? 8
  const margin = options.margin ?? 8
  const viewport = options.viewport ?? {
    width: typeof window === 'undefined' ? 0 : window.innerWidth,
    height: typeof window === 'undefined' ? 0 : window.innerHeight,
  }

  const bottom = anchor.bottom ?? anchor.top
  const right = anchor.right ?? anchor.left

  const roomAbove = anchor.top - margin
  const roomBelow = viewport.height - bottom - margin
  const needed = size.height + gap
  // The preferred side unless it does not fit and the other does; if neither
  // fits, the larger, rather than picking one on principle and hanging off it.
  const first = options.prefer ?? 'above'
  const room = first === 'above' ? roomAbove : roomBelow
  const other = first === 'above' ? roomBelow : roomAbove
  const side: Placement['side'] =
    room >= needed || (other < needed && room >= other) ? first : first === 'above' ? 'below' : 'above'

  const top =
    side === 'above'
      ? clamp(anchor.top - size.height - gap, margin, viewport.height - size.height - margin)
      : clamp(bottom + gap, margin, viewport.height - size.height - margin)

  const centre = (anchor.left + right) / 2
  const left = clamp(centre - size.width / 2, margin, viewport.width - size.width - margin)

  return { top, left, side }
}
