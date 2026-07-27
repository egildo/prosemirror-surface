# prosemirror-surface

Host **chrome** for ProseMirror editors, as a clean install: a floating toolbar web component, the PluginView that drives it, and a selection anchor.

The doctrine it implements comes from [prosemirror-verbs](https://github.com/egildo/prosemirror-verbs)' tablet, *the ecosystem stone*: **plugins ship verbs; hosts ship chrome.** Plugins declare what can be done; the host builds — or now, installs — the furniture that summons it, once, for all plugins at the same time. This package is that furniture's first piece.

## What's inside

- **`<pm-toolbar>`** — a floating command bar that knows nothing about the editor it serves. It is handed an opaque `view` (only `.state`, `.dispatch` and `.focus()` are ever touched), a list of `specs`, and an `anchor` function; it renders **buttons, fields and selects**, dry-runs commands for enabled-ness, reads `active` for lit-ness and `value` for what a control shows. Importing the package registers the element, guarded against double registration.
- **`toolbarPlugin(element, specs, anchor)`** — the lane: a ProseMirror plugin whose PluginView wires the element and calls `element.sync()` on every state change. It touches only `.specs`, `.anchor`, `.view`, `.hidden` and `.sync()` — it neither knows nor cares that the thing it drives is a custom element.
- **`selectionAnchor(view)`** — where the strip floats: top-centre of the selection, or `null` (hidden) when the selection is empty or the editor unfocused. Write your own for other geometries; returning `null` is the whole show/hide rule.

## The spec contract

The element eats a **structural shape**, not a package:

```js
{ id: 'strong', label: 'B', title: 'Bold (⌘B)', command, active? }              // a button (kind omitted)
{ id: 'link', kind: 'field', label: 'URL', type: 'url', command, value, write } // an input
{ id: 'region', kind: 'select', label: 'Row region', command, value, write, options } // a select
{ separator: true }                                                             // a section break
```

`command` is dry-run for enabled-ness (`command(state)`) on every kind, and run on click for a button (`command(state, dispatch, view)`); `active(state)` lights a button. A field or select shows `value(state)` — the readback **uncollapsed**, the value itself rather than a lamp — and commits through `write(value)`, which hands back a command to run. [prosemirror-verbs](https://github.com/egildo/prosemirror-verbs)' `toolbarSpecs` produces the button subset and `controlSpecs(verbs, groups, { collect })` produces all three — but **no dependency joins the two packages**: anything of this shape drives the element, the same way any plain object of the entry shape joins the verbs registry.

### Focus, and the one place the original law bends

A button **never takes focus** — the element prevents `mousedown` in its shadow, because a click must not disturb the selection the command acts on. A field cannot work that way: you have to be able to type into it. The law is now conditional, and three things keep it safe:

1. **The editor's selection is state, not focus.** It survives the blur intact, so the command still acts on exactly what the strip was serving.
2. **The caret is handed back before the command runs** — `view.focus()`, then the command — so a node view that claims its own DOM seat during the dispatch (a spreadsheet cell) finds a focused editor when it looks.
3. **The strip stays put while engaged.** An anchor that reads focus (`selectionAnchor` does) reports "nothing to show" the instant a field is clicked; `sync()` therefore holds position and visibility whenever a control in the shadow root holds focus.

A focused control also keeps whatever is in it — `sync()` never overwrites the value under a typist's hands. `Enter` commits, `Escape` restores and returns the caret, and a value is never committed twice.

## Hosting it

```js
import { toolbarPlugin, selectionAnchor } from 'prosemirror-surface' // registers <pm-toolbar>
import { controlSpecs } from 'prosemirror-verbs'

const toolbar = document.createElement('pm-toolbar')
document.body.append(toolbar) // the host owns the element's existence

const plugins = [
  ...otherPlugins,
  toolbarPlugin(toolbar, controlSpecs(verbs, ['marks', 'blocktype'], { collect }), selectionAnchor),
]
```

The toolbar is a form bound to the selection: readbacks are its current values, commands its setters.

## Status

Extracted 2026-07-19 from [pm-testing-venue](https://github.com/egildo/pm-testing-venue), which remains the proving ground. This is deliberately a stub with discipline: the intended destination is the unified surface — a toolbar on a selection that morphs into a command palette when summoned — and its open questions (the focus handoff, focus scope, the top layer) are tracked in prosemirror-verbs' tablet, not here. What ships today is the honest subset that exists and is exercised.

Fields and selects landed 2026-07-27, and with them the first narrow crossing of the focus line the palette will one day have to cross wholesale. Narrow deliberately: one control at a time, no keyboard capture, no summon chord. The palette's questions stay open.
