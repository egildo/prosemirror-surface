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
- **Five holes**: `icon`, `label`, `face`, `items`, `item`. A sixth has to earn its place, because this is where a template language would start. No conditionals, no loops, no expressions — a template that needs to *decide* something is describing a decision that belongs in the host's cascade, where `describe()` can explain it.
- **Templates render into light DOM; defaults render into shadow.** Supply none and the strip is fully encapsulated; supply any and you have opted into owning the appearance, so your markup lands in your own cascade and your stylesheet reaches it with no `::part` ceremony. (The whole rendering moves, not just the templated parts — so once you template anything, style everything.)
- **An unknown `as` falls back** to the kind's default *drawing*. A typo costs a switch, never a control.

### What is yours, said plainly

The elements are yours — all of them. A template's root element *is* the group, or *is* the control's box; the element only asks that a control's box contain something it can wire (`button`, `input`, `select`, or a `[data-slot="face"]`). So a section can be a real `<ul>`, a control a real `<li>`, and the semantics of your document outline stay your business — this package ships no opinion about which element or which ARIA role a piece of chrome should be.

Two consequences worth writing down, because they are the contract and not an accident:

- **The wrapper hides; the control disables.** When a template puts the control inside something, `.gone` lands on the outer box and `disabled` on the inner control. A hidden item takes its `<li>` with it, rather than leaving a bullet for something that is not there.
- **The element reads the role you chose.** A `role="switch"` gets `aria-checked` where a button gets `aria-pressed`. It adapts to your markup; it does not overrule it.

### The item hole: a container's rule about its own children

A `<ul>` may hold only `<li>`. That is the **container's** rule, not the item's opinion — so it is answered where the container is, by a `<template data-slot="item">` nested in the items hole:

```html
<template data-as="listing">
  <span class="grp">
    <button type="button" data-slot="face"></button>
    <ul popover data-slot="items">
      <template data-slot="item"><li role="none"></li></template>
    </ul>
  </span>
</template>
```

Every child drawn into that hole is wrapped in a clone. Without it the wrapper would have to ride on each verb's own `as`, and a verb's drawing would silently owe something to whichever section it happened to land in — the drift that keying by `as` exists to prevent.

### Sections, and menus for free

A section arrives as `{ group, label, as?, icon?, items }` and is drawn `inline` (children as siblings, via `display: contents`, which is today's strip) or as a `menu` — one face plus a `popover`. Open, close, light dismiss, the top layer and Escape are the platform's; **this element writes no open/close code at all**, only `popovertarget`.

A section is collapsed when it **is** one, not when it is called one: with no template that means the word `menu`, and with a template it means the markup — a panel you wrote `popover` on is a panel meant to open, whatever you called the drawing. So a venue may invent a second kind of section (a column of words beside a row of icons) without having to lie about its name. If your items hole forgets the `popover` attribute, the element adds it — `popovertarget` aimed at an ordinary element is silent, and silence is the worst failure a control can have.

> **Styling a popover: put `display` on `:popover-open`, never on the panel itself.** The UA hides a closed popover with `display: none`, and *any* author rule setting `display` on the panel beats it — author beats UA whatever the specificity. A panel styled `display: flex` is therefore open forever. This element's own sheet had exactly that bug, and the venue's copy of it had the same; both now say `[popover]:popover-open { display: flex }`, and it is pinned by a test that reads the rules rather than the computed style, since a headless DOM has no UA popover styles to prove anything with.

The element writes `aria-haspopup` and keeps `aria-expanded` true — the platform's popover does not — which means the one attribute a screen reader needs is also the one your stylesheet needs for a caret that turns over. A caret is appearance, so it belongs in your template as ordinary markup; no register should be asked to carry "this opens".

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
{ id: 'strong', label: 'B', title: 'Bold (⌘B)', command, active? }               // a button (kind omitted)
{ id: 'link', kind: 'value', label: 'URL', type: 'url', command, value, write }  // an input
{ id: 'region', kind: 'choice', label: 'Row region', command, value, write, options } // a select
{ separator: true }                                                              // a section break
```

### `kind` is closed, `as` is open

The two words look alike and are not. **`kind` is what a control *is*** — `action`, `toggle`, `choice`, `value` — deduced from the declaration's shape by whoever projected it, and **behaviour follows from it**: an action runs, a value commits what it holds, a choice commits one of its members. Nobody may disagree with a kind.

**`as` is how it looks**, and it is an open vocabulary: any word you write arrives untouched, because appearance is the host's. The words this element knows — `button`, `switch`, `select`, `radio`, `field`, `dropdown`, `option` — are its **floor**, the drawing to use when no template of yours matched. They are not a permitted list.

The wiring is chosen from the kind and from the element your template actually handed over — a `<select>` gets select wiring, an `<input>` gets field wiring, anything else gets pressable — and **never from the word**. (It used to be chosen from the word, so a choice drawn as anything but a `<select>` got `<option>`s appended into a button and a `change` listener that could never fire. Silently.)

### A choice drawn as a `dropdown`

`as: 'dropdown'` on a choice gives the classic chooser: a face wearing the member the readback answers, a `popover` of the domain, one pressable per member, the current one lit, and the panel closing when you pick. Nothing new is declared for it — `options` was already the domain, `value` the readback, `write` the commit — it is the same declaration simply not flattened into a native `<select>`, which cannot wear an icon and cannot be styled. Members are drawn as `as: 'option'`, so a venue can template a panel row without touching its strip's icon-only faces; with no template they draw their words, which is what a chooser needs.

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
