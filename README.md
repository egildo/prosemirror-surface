# prosemirror-surface

Host **chrome** for ProseMirror editors, as a clean install: a floating toolbar web component, the PluginView that drives it, and a selection anchor.

The doctrine it implements comes from [prosemirror-verbs](https://github.com/egildo/prosemirror-verbs)' tablet, *the ecosystem stone*: **plugins ship verbs; hosts ship chrome.** Plugins declare what can be done; the host builds — or now, installs — the furniture that summons it, once, for all plugins at the same time. This package is that furniture's first piece.

## What's inside

- **`<pm-toolbar>`** — a floating command bar that knows nothing about the editor it serves. It is handed an opaque `view` (only `.state`, `.dispatch` and `.focus()` are ever touched), a list of `specs`, and an `anchor` function; it renders **buttons, fields and selects**, dry-runs commands for enabled-ness, reads `active` for lit-ness and `value` for what a control shows. Importing the package registers the element, guarded against double registration.
- **`toolbarPlugin(element, specs, anchor)`** — the lane: a ProseMirror plugin whose PluginView wires the element and calls `element.sync()` on every state change. It touches only `.specs`, `.anchor`, `.view`, `.hidden` and `.sync()` — it neither knows nor cares that the thing it drives is a custom element.
- **`selectionAnchor(view)`** — **what** the strip floats near: the rect the selection occupies, or `null` (hidden) when the selection is empty or the editor unfocused. Write your own for other geometries; returning `null` is the whole show/hide rule.
- **`place(anchor, size, options)`** — **where** it goes: pure geometry, no DOM, no editor.

## Anchoring and placement

Two jobs, deliberately separate — the same split this ecosystem draws everywhere else. The **anchor** says *what I am about*; the **element** says *where I go*.

```js
anchor: (view) => ({ top, left, bottom?, right? }) | null
```

A **rect**, because a point cannot be flipped: choosing the other side needs the far edge of the thing you are avoiding, and staying on screen needs your own width. `bottom` and `right` default to `top` and `left` — a zero-size rect — so an anchor written against the older point contract keeps working and simply gains the clamping.

The element measures itself, calls `place()`, and writes real `top`/`left`. Above by default (chrome that covers what you just selected is chrome you have to move), flipped below when there is no room above, and pulled back inside the viewport at either edge — which is the bug this replaces: a selection near the left margin used to put half the strip off-screen with its first buttons unreachable.

There is **no CSS transform** any more. `translate(-50%, -100%)` used to do the centring and the lift, and that was precisely why the strip could not be kept on screen: a transform is applied after layout, so the coordinates JS writes are not the box's real corner, and clamping them clamps the wrong number.

The result rides out as `data-side="above|below"` for stylesheets that care — a pointer arrow has to swap ends. The strip also re-places itself on **scroll** and **resize**, the two things that change the answer without changing the editor's state, so no transaction fires to say so.

`place()` is exported and tested on its own, which is the point of its being a function rather than a method: geometry written inside an element is geometry nobody can check.

*On the platform's own answer: CSS anchor positioning — `anchor-name`, `position-area`, `position-try-fallbacks: flip-block, flip-inline` — is this file in a declaration, and it is where this should end up. It is not evenly shipped across engines yet, and a surface that works in one engine is not a surface. When it is, `place()` becomes the fallback rather than the mechanism, and the contract above does not change.*

## Templates: your markup, our behaviour

The element draws a built-in for each `as` it knows. Supply a `<template data-as="…">` as a **light-DOM child** and it draws yours instead:

```html
<pm-toolbar>
  <template data-as="button">
    <button type="button" class="ctl"><i data-slot="icon"></i></button>
  </template>
  <template data-as="menu">
    <span class="grp">
      <button type="button" class="face" data-slot="face"><i data-slot="icon"></i></button>
      <div popover data-slot="items"></div>
    </span>
  </template>
</pm-toolbar>
```

> **The template owns structure and appearance. The element owns behaviour and state.**

That line is what keeps this from being a framework. The element still runs the dry run that disables, reads the readback that lights or fills, dispatches on click and commits through `write`. A template that could change *behaviour* would be a framework; one that can only change shape is a stylesheet with elements in it.

- **Keyed by `as`, never by id.** One template per drawing, applied to every control of that drawing, is consistent by construction — a per-control override would drift the first time somebody was in a hurry.
- **Four holes**: `icon`, `label`, `face`, `items`. A fifth has to earn its place, because this is where a template language would start. No conditionals, no loops, no expressions — a template that needs to *decide* something is describing a decision that belongs in the host's cascade, where `describe()` can explain it.
- **Templates render into light DOM; defaults render into shadow.** Supply none and the strip is fully encapsulated; supply any and you have opted into owning the appearance, so your markup lands in your own cascade and your stylesheet reaches it with no `::part` ceremony. (The whole rendering moves, not just the templated parts — so once you template anything, style everything.)
- **An unknown `as` falls back** to the kind's default. A typo costs a switch, never a control.

### Sections, and menus for free

A section arrives as `{ group, label, as?, icon?, items }` and is drawn `inline` (children as siblings, via `display: contents`, which is today's strip) or as a `menu` — one face plus a `popover`. Open, close, light dismiss, the top layer and Escape are the platform's; **this element writes no open/close code at all**, only `popovertarget`.

One thing the platform does not yet do for us: a popover is painted in the top layer, so `position: absolute` will not anchor it to the button that opened it. CSS anchor positioning is the native answer and is not evenly shipped, so the panel is placed with the same `place()` the strip uses, preferring `below`.

A section with nothing available in it disappears, and so does the divider that no longer divides anything — separator-trimming, one altitude up.

### Icons are names

The element **never resolves an icon**. It writes the name onto the template's icon hole as `data-icon` and stops:

```css
[data-icon] { mask: center / contain no-repeat; background: currentColor }
[data-icon="row-add-after"] { mask-image: url(icons/row-add-after.svg) }
```

An icon font, an SVG symbol, a letter in `content:` — all the same to this package. `mask` plus `currentColor` gets you hover, disabled and dark mode for free.

**Consequence worth knowing**: an icon-only control has no text node, so the accessible name is the only name there is. The element writes `aria-label` from `title` for exactly that reason, and it is pinned in the tests.

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
