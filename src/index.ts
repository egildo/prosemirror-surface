// prosemirror-surface — public surface.
//
// Host chrome as a clean install: the floating toolbar element, the PluginView
// that drives it, and the selection anchor. Importing this module registers
// <pm-toolbar> (guarded, so importing twice is safe).
//
// It depends on no registry: the specs it eats are a structural shape, which
// prosemirror-verbs' toolbarSpecs happens to produce — and so may anything else.

export { PmToolbar } from './pm-toolbar.js'
export type { ToolbarSpec, ToolbarItem, ToolbarCommand, ToolbarAnchor } from './pm-toolbar.js'
export { toolbarPlugin } from './plugin.js'
export type { ToolbarLike } from './plugin.js'
export { selectionAnchor } from './anchor.js'
export { place } from './place.js'
export type { Rect, Size, Placement, PlaceOptions } from './place.js'
