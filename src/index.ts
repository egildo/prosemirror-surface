// prosemirror-surface — public surface.
//
// Host chrome as a clean install: **two elements over one base**, the PluginView
// that drives either, and the selection anchor. Importing this module registers
// <pm-toolbar> and <pm-palette> (guarded, so importing twice is safe).
//
//   PmSurface — what both are: templates, drawing, wiring, availability.
//   PmToolbar — a strip that floats by the selection, or docks in the flow.
//   PmPalette — a searchable list you walk with the arrows and descend into.
//
// The two differ by one question asked twice: the base decides a section is
// collapsed, and each surface says what collapsing means — a popover beside its
// face, or a page you push. Same tree, same templates, two navigations.
//
// It depends on no registry: the specs it eats are a structural shape, which
// prosemirror-verbs' projections happen to produce — and so may anything else.

export { PmSurface } from './pm-surface.js'
export type { ToolbarSpec, ToolbarItem, ToolbarGroup, ToolbarCommand } from './pm-surface.js'
export { PmToolbar } from './pm-toolbar.js'
export type { ToolbarAnchor } from './pm-toolbar.js'
export { PmPalette } from './pm-palette.js'
export type { Matcher } from './pm-palette.js'
export { toolbarPlugin } from './plugin.js'
export type { ToolbarLike } from './plugin.js'
export { selectionAnchor } from './anchor.js'
export { place } from './place.js'
export type { Rect, Size, Placement, PlaceOptions } from './place.js'
