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

export function selectionAnchor(view: EditorView): { top: number; left: number } | null {
  const { from, to, empty } = view.state.selection
  if (empty || !view.hasFocus()) return null
  const start = view.coordsAtPos(from)
  const end = view.coordsAtPos(to)
  return { top: Math.min(start.top, end.top), left: (start.left + end.right) / 2 }
}
