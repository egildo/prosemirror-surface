// The lane. A toolbar is a view.
//
// PluginView is two methods — update and destroy — and update fires on every
// state change. That is the whole subscription; nothing else is needed.
//
// The element is handed in. The plugin never creates it, never removes it, and
// never reaches into the document — it wires what it is given and syncs it. It
// touches only .specs, .anchor, .view and .sync(), so it neither knows nor cares
// that the thing it drives is a custom element — the interface below is that
// indifference, typed.

import { Plugin } from 'prosemirror-state'
import type { ToolbarAnchor, ToolbarItem } from './pm-toolbar.js'

/** What the plugin actually touches — anything of this shape can be driven. */
export interface ToolbarLike {
  specs: ToolbarItem[] | null | undefined
  anchor: ToolbarAnchor | null
  view: any
  hidden: boolean
  sync(): void
}

export const toolbarPlugin = (element: ToolbarLike, specs: ToolbarItem[], anchor: ToolbarAnchor) =>
  new Plugin({
    view(editorView) {
      Object.assign(element, { specs, anchor, view: editorView })
      element.sync()

      // update runs on every transaction, keystrokes included. A few dry runs and
      // some idempotent DOM writes; do not add diffing before measuring a problem.
      // The sync is deferred one microtask: the anchor reads focus, and a node
      // view may move focus onto its own components synchronously *within* the
      // dispatch — a same-tick sync would read the world mid-move and hide the
      // strip exactly when a cell gets selected. The guard covers a destroy
      // landing before the microtask runs.
      return {
        update: () => queueMicrotask(() => element.view && element.sync()),
        destroy: () => {
          // The host owns the element's existence, not the plugin — so let go,
          // don't remove.
          element.hidden = true
          element.view = null
        },
      }
    },
  })
