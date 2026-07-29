// Where to float, and whether to float at all.
//
// The verbs themselves — what a button does, whether it's lit — live in the
// host's registry. What lives here is the one thing that is toolbar geometry
// rather than a verb: where the strip anchors to the selection.
//
// It is handed to the element as a function — the element cannot work this out from
// an opaque token. Returning null is the whole show/hide rule: nothing to anchor to
// means nothing to show.

import type { EditorView } from 'prosemirror-view'
import type { Rect } from './place.js'

// "The editor has focus" must include focus held *inside* the editor's DOM
// by a node view's own components (a plugin's cell, say — focusable internal
// elements are legitimate under the black-box posture). ProseMirror's
// hasFocus() is strict equality with view.dom, which reads such a state as
// unfocused and would hide the toolbar exactly when a cell is selected.
function focusWithin(view: EditorView): boolean {
  if (view.hasFocus()) return true
  const active = (view.root as unknown as DocumentOrShadowRoot | undefined)?.activeElement
  return !!active && view.dom.contains(active)
}

/// The rect the selection occupies, or null for "nothing to show".
///
/// A **rect**, not a point: the element places itself relative to this, and
/// placement needs both edges — the top to sit above, the bottom to flip below
/// when there is no room above. Answering a point was the reason the strip
/// could not flip and could not be pulled back inside the viewport.
///
/// A multi-line selection's rect is the union of its ends, which is wider than
/// the text on any one line. That is the right answer for centring: the strip
/// belongs over the *selection*, not over its last line.
export function selectionAnchor(view: EditorView): Rect | null {
  const { from, to, empty } = view.state.selection
  if (empty || !focusWithin(view)) return null
  const start = view.coordsAtPos(from)
  const end = view.coordsAtPos(to)
  return {
    top: Math.min(start.top, end.top),
    bottom: Math.max(start.bottom, end.bottom),
    left: Math.min(start.left, end.left),
    right: Math.max(start.right, end.right),
  }
}
