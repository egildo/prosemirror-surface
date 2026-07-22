# prosemirror-surface

Host **chrome** for ProseMirror editors, as a clean install: a floating toolbar web component, the PluginView that drives it, and a selection anchor.

The doctrine it implements comes from [prosemirror-verbs](https://github.com/egildo/prosemirror-verbs)' tablet, *the ecosystem stone*: **plugins ship verbs; hosts ship chrome.** Plugins declare what can be done; the host builds — or now, installs — the furniture that summons it, once, for all plugins at the same time. This package is that furniture's first piece.

## What's inside

- **`<pm-toolbar>`** — a floating command bar that knows nothing about the editor it serves. It is handed an opaque `view` (only `.state` and `.dispatch` are ever touched), a list of `specs`, and an `anchor` function; it renders buttons, dry-runs commands for enabled-ness, reads `active` for lit-ness, and **never takes focus** (a click must not disturb the selection the command acts on). Importing the package registers the element, guarded against double registration.
- **`toolbarPlugin(element, specs, anchor)`** — the lane: a ProseMirror plugin whose PluginView wires the element and calls `element.sync()` on every state change. It touches only `.specs`, `.anchor`, `.view`, `.hidden` and `.sync()` — it neither knows nor cares that the thing it drives is a custom element.
- **`selectionAnchor(view)`** — where the strip floats: top-centre of the selection, or `null` (hidden) when the selection is empty or the editor unfocused. Write your own for other geometries; returning `null` is the whole show/hide rule.

## The spec contract

The element eats a **structural shape**, not a package:

```js
{ id: 'strong', label: 'B', title: 'Bold (⌘B)', command, active? }   // a button
{ separator: true }                                                   // a section break
```

`command` is dry-run for enabled-ness (`command(state)`) and run on click (`command(state, dispatch, view)`); `active(state)` lights the button. [prosemirror-verbs](https://github.com/egildo/prosemirror-verbs)' `toolbarSpecs(verbs, groups, { collect })` produces exactly this shape — the natural pairing — but **no dependency joins the two packages**: anything of this shape drives the element, the same way any plain object of the entry shape joins the verbs registry.

## Hosting it

```js
import { toolbarPlugin, selectionAnchor } from 'prosemirror-surface' // registers <pm-toolbar>
import { toolbarSpecs } from 'prosemirror-verbs'

const toolbar = document.createElement('pm-toolbar')
document.body.append(toolbar) // the host owns the element's existence

const plugins = [
  ...otherPlugins,
  toolbarPlugin(toolbar, toolbarSpecs(verbs, ['marks', 'blocktype'], { collect }), selectionAnchor),
]
```

The toolbar is a form bound to the selection: readbacks are its current values, commands its setters.

## Status

Extracted 2026-07-19 from [pm-testing-venue](https://github.com/egildo/pm-testing-venue), which remains the proving ground. This is deliberately a stub with discipline: the intended destination is the unified surface — a toolbar on a selection that morphs into a command palette when summoned — and its open questions (the focus handoff, focus scope, the top layer) are tracked in prosemirror-verbs' tablet, not here. What ships today is the honest subset that exists and is exercised.
