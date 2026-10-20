# prosemirror-surface

Host **chrome** for ProseMirror editors, as a clean install: **two web components over one base**, the PluginView that drives either, and a selection anchor.

The doctrine it implements comes from [prosemirror-verbs](https://github.com/egildo/prosemirror-verbs)' tablet, *the ecosystem stone*: **plugins ship verbs; hosts ship chrome.** Plugins declare what can be done; the host builds — or now, installs — the furniture that summons it, once, for all plugins at the same time.

## What's inside

| | |
|---|---|
| **`PmSurface`** | What both elements *are*, and not registered itself: templates, drawing, wiring, publishing, availability. |
| **`<pm-toolbar>`** | A command bar that floats by the selection or docks in the flow. |
| **`<pm-palette>`** | A modal, searchable list you walk with the arrows and descend into. |
| **`toolbarPlugin(element, { project, run }, anchor?)`** | The lane: a PluginView that hands either element the host's projection and its door, and calls `sync()` on every state change. |
| **`selectionAnchor(view)`** | **What** a strip floats near: the rect the selection occupies, or `null` for "nothing to show". |
| **`place(anchor, size, options)`** | **Where** it goes: pure geometry, no DOM, no editor. |

Importing the package registers both elements, guarded against double registration. Neither knows anything about the editor it serves: each is handed an opaque `view` (only `.state`, `.dispatch` and `.focus()` are ever touched) and a **tree** of specs.

## Two surfaces, one base

The two differ by **one question asked twice**. The base decides a section is *collapsed*; each surface says what collapsing *means*:

```ts
// PmSurface — is this section hidden behind one face?
protected collapses(as: string, hole: HTMLElement | null): boolean

// …and what does that mean here?
protected abstract collapse(face: HTMLElement, panel: HTMLElement, group: ToolbarGroup): void
```

`PmToolbar` answers with a **popover beside the face**. `PmPalette` answers with a **page you push**. Same tree, same templates, two navigations, neither written twice — which is the claim prosemirror-verbs' V14 makes about projections, expressed here in the type system rather than in prose.

One smaller seam sits beside it: `divider()` returns what falls between two adjacent sections. A strip draws a rule; a palette answers `null`, because a list that gives its sections headings needs nothing between them.

Subclassing is a supported way to write a third surface. Everything the two shipped ones use is `protected`, not private.

## Templates: your markup, our behaviour

A surface draws a built-in for each `as` it knows. Supply a `<template data-as="…">` as a **light-DOM child** and it draws yours instead:

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

That line is what keeps this from being a framework. The element still reads the availability that disables and the readback that lights or fills, and runs the door on click and on commit. A template that could change *behaviour* would be a framework; one that can only change shape is a stylesheet with elements in it.

- **Keyed by `as`, never by id.** One template per drawing, applied to every control of that drawing, is consistent by construction — a per-control override would drift the first time somebody was in a hurry.
- **Five holes**: `icon`, `label`, `face`, `items`, `item`. A sixth has to earn its place, because this is where a template language would start. No conditionals, no loops, no expressions — a template that needs to *decide* something is describing a decision that belongs in the host's cascade, where `describe()` can explain it.
- **Templates render into light DOM; defaults render into shadow.** Supply none and the surface is fully encapsulated; supply any and you have opted into owning appearance, so your markup lands in your own cascade and your stylesheet reaches it with no `::part` ceremony. (The whole rendering moves, not just the templated parts — so once you template anything, style everything.)
- **An unknown `as` falls back** to the kind's default *drawing*. A typo costs a switch, never a control.

### The `as` vocabulary is per-surface

Templates are read from **each element's own light-DOM children**, so the same word means whatever that surface's templates say. A strip's `button` is an icon; a palette's `button` is a full row with its words and its chord. No verb needs to know which surface it landed on, and nothing has to be renamed to appear in two places.

Which is also the answer to *how do I avoid duplicating components*: you don't share templates between surfaces — you share **CSS**. The palette in [pm-testing-venue](https://github.com/egildo/pm-testing-venue) reuses the strip's `.ctl`, its icon block and its disabled rule, and its own templates are four elements each.

### Publish, don't hole

Anything on the spec a surface does not itself consume is written onto the control as `data-*` and left alone — strings and numbers only, because a function is behaviour and behaviour is not something to hand to CSS.

That is what keeps the hole vocabulary at five. A palette draws its chord with `content: attr(data-chord)` and filters on `[data-search]`; both are words the *host* put on the spec, carried the last step to where a stylesheet can reach them. The projection already carries a host's own attributes through (`passthrough`); this closes the loop. **Add a hole only when the thing must be an element** — focusable, or something a picture goes in.

### Icons are names

A surface **never resolves an icon**. It writes the name onto the template's icon hole as `data-icon` and stops:

```css
[data-icon] { mask: center / contain no-repeat; background: currentColor }
[data-icon="row-add-after"] { mask-image: url(icons/row-add-after.svg) }
```

An icon font, an SVG symbol, a letter in `content:` — all the same to this package, and they mix freely in one strip. `mask` plus `currentColor` gets you hover, disabled and inherited colour for free.

**Consequence worth knowing**: an icon-only control has no text node, so the accessible name is the only name there is. The element writes `aria-label` from `title` for exactly that reason, and it is pinned in the tests.

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

## Sections

A section arrives as `{ group, label, as?, icon?, items }`, holds controls **and further sections**, and is drawn `inline` (children as siblings, via `display: contents`) or collapsed behind one face.

A section is collapsed when it **is** one, not when it is called one: with no template that means the word `menu`, and with a template it means the markup — a panel you wrote `popover` on is a panel meant to open, whatever you called the drawing. So a venue may invent a second kind of section without having to lie about its name. If your items hole forgets the `popover` attribute, a toolbar adds it; `popovertarget` aimed at an ordinary element is silent, and silence is the worst failure a control can have.

Nesting is unbounded and needs nothing declared for it: sections hold sections, so a strip gets dropdowns inside dropdowns and a palette gets pages inside pages from the same tree.

Open, close, light dismiss, the top layer and Escape are the platform's for a **menu** — this package writes no open/close code at all, only `popovertarget`. What it does write is the geometry: a popover paints in the top layer, so `position: absolute` cannot anchor it to the button that opened it, and CSS anchor positioning is not evenly shipped yet. So a panel is put where `place()` says, preferring below.

A section with nothing available in it disappears, and so does the divider that no longer divides anything — separator-trimming, one altitude up.

The element writes `aria-haspopup` and keeps `aria-expanded` true — the platform's popover does not — which means the one attribute a screen reader needs is also the one your stylesheet needs for a caret that turns over. A caret is appearance, so it belongs in your template as ordinary markup; no register should be asked to carry "this opens".

> **Styling a popover: put `display` on `:popover-open`, never on the panel itself.** The UA hides a closed popover with `display: none`, and *any* author rule setting `display` on the panel beats it — author beats UA whatever the specificity. A panel styled `display: flex` is therefore open forever. This element's own sheet had exactly that bug, and the venue's copy of it had the same; both now say `[popover]:popover-open { display: flex }`, pinned by a test that reads the rules rather than the computed style, since a headless DOM has no UA popover styles to prove anything with.

## `<pm-toolbar>`

A strip. Its own concerns are **where it goes** and **whether it is there** — everything else is the base.

```js
toolbar.anchor = selectionAnchor          // (view) => Rect | null
toolbar.placement = 'anchored' | 'docked' // floating, or in the document's flow
```

Two jobs, deliberately separate. The **anchor** says *what I am about*; the **element** says *where I go*.

```js
anchor: (view) => ({ top, left, bottom?, right? }) | null
```

A **rect**, because a point cannot be flipped: choosing the other side needs the far edge of the thing you are avoiding, and staying on screen needs your own width. `bottom` and `right` default to `top` and `left` — a zero-size rect — so an anchor written against the older point contract keeps working and simply gains the clamping. Returning `null` is the whole show/hide rule.

The element measures itself, calls `place()`, and writes real `top`/`left`. Above by default (chrome that covers what you just selected is chrome you have to move), flipped below when there is no room above, and pulled back inside the viewport at either edge. The result rides out as `data-side="above|below"` for stylesheets that care — a pointer arrow has to swap ends. It re-places itself on **scroll** and **resize**, the two things that change the answer without changing the editor's state, so no transaction fires to say so.

There is **no CSS transform**. `translate(-50%, -100%)` used to do the centring and the lift, and that was precisely why the strip could not be kept on screen: a transform is applied after layout, so the coordinates JS writes are not the box's real corner, and clamping them clamps the wrong number.

`place()` is exported and tested on its own, which is the point of its being a function rather than a method: geometry written inside an element is geometry nobody can check.

*On the platform's own answer: CSS anchor positioning — `anchor-name`, `position-area`, `position-try-fallbacks: flip-block, flip-inline` — is this file in a declaration, and it is where this should end up. It is not evenly shipped across engines yet, and a surface that works in one engine is not a surface. When it is, `place()` becomes the fallback rather than the mechanism, and the contract above does not change.*

## `<pm-palette>`

The same registry, laid out as a list you search, walk and descend into. It has no anchor: whether it is there is its own state, not a question about the selection.

```js
palette.show() / hide() / toggle()   // which chord summons it is yours
palette.open        // boolean, reflected as [data-open] for CSS
palette.query       // the <input>: set its placeholder and aria-label
palette.matcher     // (text, query) => boolean — substring by default
palette.separator   // ' › ' — the punctuation between a path's names
palette.depth       // how many pages deep
palette.at          // the highlighted row, or null
palette.reachableRows()  // what the arrows would walk right now
palette.push(panel) / pop() / reset() / move(step) / activate()
```

**Keys it owns**: `↑ ↓` move over reachable rows and wrap; `Home` / `End` go to the ends; `Enter` descends if the row is a page face and otherwise runs and closes; `Escape` pops a page, and closes only when there is nowhere left to go. Everything else is typing and is deliberately **not** stopped.

**ARIA is not optional here**, and is the clearest single reason this lives in the package rather than in each venue: the query is a `role="combobox"` with `aria-expanded` and `aria-controls`, rows are `role="option"` with generated ids, and `aria-activedescendant` tracks the highlight and clears on close. The caret never leaves the query box — that is the combobox pattern, and the reason typing keeps working while the arrows move a selection somewhere else.

### Why the palette owns Escape

A palette **redefines a key**. Escape in a dialog means *close*; in a palette with a page open it means *back*, and no user agent can know that.

The first cut leaned on the platform: pages were nested popovers, whose close watcher pops the innermost one. It reads beautifully and it was the wrong call, for three reasons that only showed up in the field:

- **Nothing owned it.** No code, no test — and a single `stopPropagation()` on a keydown, anywhere in an ancestor, removes back-navigation silently. That happened, in this package's own venue, and went unnoticed.
- **It could not be checked.** The close watcher is unobservable in a headless DOM, and the browser harness this was built through delivers no keydown events at all. *Back works, trust me* is not a capability.
- **It could not be layered.** Adding a handler on top needs `preventDefault()` on the keydown to suppress the close request, and neither the HTML spec's text nor MDN says it does. Own it or trust it — there is no safe both.

So pages are ordinary elements and the stack is a field. The **host** is still a popover (`manual`), because the top layer, `::backdrop` and `:popover-open` are worth having and cost nothing. What we give up is light dismiss — about ten lines, and now a thing with a test rather than a thing we hope about.

The general rule this leaves behind: **the platform keeps every behaviour whose meaning we agree with, and we take the ones we redefine.**

Scoping a query to the current page is what keeps that meaning single. Were a query to search the whole register from anywhere, descending would stop mattering the moment you typed, and Escape would have to decide between clearing the query and going back — an overloaded key, which is the thing this section exists to avoid.

### Searching: a query flattens

**The hierarchy is for browsing when you do not know the name; a query is for jumping when you do.** So typing does not narrow the tree — it collapses it:

> While a query is active, the palette shows every match in the current subtree **at one level**, each carrying the path it came from. A page that matches **by its own name** stays a row you can descend into; a page that merely *contains* matches disappears in favour of what it contains.

```
(browsing)              (typing "quot")
  Format        ▸         Quote        Structure › Wrappers   ⌘>
  Structure     ▸         Quotation    Insert › Blocks
  Insert        ▸
```

Anything else asks you to guess a branch and descend to find out whether you guessed right, which is the failure a palette exists to prevent. An earlier cut of this kept only the *road* to a match — you saw `Structure`, never `Quote` — and it was wrong for exactly that reason.

**Scope is the page you are standing on.** At the top a query searches everything; inside `Insert` it searches only `Insert`. Descending stays meaningful, and Escape keeps its single meaning — *back* — instead of having to decide between clearing a query and popping a page.

The path is `data-path`, published like every other attribute and drawn with `attr()`; `separator` is the punctuation between its names and is yours to set. A flattened panel carries `data-flat` and the host carries `data-query`, which is all a stylesheet needs to stop drawing a page as an overlay. **No sixth hole was needed for any of it.**

### What is hidden, and by whom

The element decides what is visible and CSS draws it — not the other way round, because navigation and `aria-activedescendant` both have to know what is reachable, and reading that back out of layout is slow and wrong the moment a venue hides something its own way.

Three rules, one idea seen at three depths — **hide anything with nothing left in it**:

- a row whose text the `matcher` refuses;
- a section left with no rows;
- a page that neither matches by name nor holds a match — **and pages settle innermost-first**, because a parent asked while its own sub-faces are unmarked counts them as matches and survives every query.

Search text comes from `spec.search` when a host stamped one, and otherwise from the label, the title and any `keywords` — so a palette works with no host cooperation at all.

### One consequence of templating a palette

With templates supplied, a surface draws into light DOM — **including the palette's own query box and listbox**, which its shadow styling then cannot reach. That is the documented bargain rather than an oversight: supply templates and the look is yours, all of it. Style `.query` and `.list` yourself, or supply no templates and keep the built-in rendering.

## The spec contract

Either element eats a **structural shape**, not a package — plain data, no functions, the shape [verbr](https://github.com/egildo/verbr)'s `project` produces:

```js
{ id: 'strong', kind: 'toggle', label: 'Bold', icon: 'bold', enabled: true, pressed: false }  // a button
{ id: 'link', kind: 'value', label: 'Link', value: 'https://…', args: [{ name: 'href', type: 'url' }] }  // an input
{ id: 'region', kind: 'choice', label: 'Row region', value: 'body',
  args: [{ name: 'region', domain: [{ value: 'head' }, { value: 'body' }] }] }  // a select
{ id: 'insert', label: 'Insert', as: 'menu', items: [...] }                    // a section
```

Two adjacent sections get a divider between them; there is no separator item.

### `kind` is closed, `as` is open

The two words look alike and are not. **`kind` is what a control *is*** — `action`, `toggle`, `choice`, `value` — deduced from the declaration's shape by whoever projected it, and **behaviour follows from it**: an action runs, a value commits what it holds, a choice commits one of its members. Nobody may disagree with a kind.

**`as` is how it looks**, and it is an open vocabulary: any word you write arrives untouched, because appearance is the host's. The words this package knows — `button`, `switch`, `select`, `radio`, `field`, `dropdown`, `option`, and `menu` for a section — are its **floor**, the drawing to use when no template of yours matched. They are not a permitted list.

The wiring is chosen from the kind and from the element your template actually handed over — a `<select>` gets select wiring, an `<input>` gets field wiring, anything else gets pressable — and **never from the word**. (It used to be chosen from the word, so a choice drawn as anything but a `<select>` got `<option>`s appended into a button and a `change` listener that could never fire. Silently.)

### A choice drawn as a `dropdown`

`as: 'dropdown'` on a choice gives the classic chooser: a face wearing the member the readback answers, a `popover` of the domain, one pressable per member, the current one lit, and the panel closing when you pick. Nothing new is declared for it — the first argument's members were already the domain, `value` the readback, and the door the commit — it is the same declaration simply not flattened into a native `<select>`, which cannot wear an icon and cannot be styled. Members are drawn as `as: 'option'`.

**The state is the host's, read through a projection.** The element is handed `project(state)` and calls it on every `sync()`: a tree of the same shape is synced in place, a different one is drawn afresh. `enabled: false` disables a control — or hides it, when the element's `unavailable` is `'hide'` — and an absent `enabled` is the authority not having spoken, so the control is offered. `pressed` lights a button. A field or select shows `value` — the readback **uncollapsed**, the value itself rather than a lamp.

**A value drawn as a button is lit while it holds a value** (a link, asked for through the collector rather than a field: the caret stands in a link, the button says so).

**A button summons by command.** With the Invoker Commands API, every pressable the element draws carries `command="--<id>"` and `commandfor` naming the element (or a seat in its shadow root, for the built-in drawing), and the platform fires a `CommandEvent` there on activation; nothing listens for clicks. The element is the outlet: a command for an id it drew presses that control, one for any other id runs the verb through the door — so `<button command="--strong" commandfor="<the element's id>">` anywhere in the page summons a verb by attribute alone (verbr's `outlet` spells the same `--` grammar). Where the API is missing, a click listener does the same.

**Everything runs through one door**, `run(id, args, view)`, which the host supplies. A button runs with no args; a field, a select or a dropdown member commits `{ [firstArg.name]: value }` (a `number` argument is sent as a number; an emptied field sends no value, and the verb decides what absence means). A verb that needs args and was pressed without them is the door's to ask for — so a field's verb drawn as a palette row asks the way a chord would. [prosemirror-verbs](../prosemirror-verbs)' `commandFor` is such a door over verbr's `invoke`, but **no dependency joins the packages**: anything of this shape drives either element.

### Focus, and the one place the original law bends

A button **never takes focus** — the element prevents `mousedown`, because a click must not disturb the selection the command acts on. A field cannot work that way: you have to be able to type into it. The law is conditional, and three things keep it safe:

1. **The editor's selection is state, not focus.** It survives the blur intact, so the command still acts on exactly what the surface was serving.
2. **The caret is handed back before the door is called** — `view.focus()`, then `run` — so a node view that claims its own DOM seat during the dispatch (a spreadsheet cell) finds a focused editor when it looks. This is why a palette row works at all: focus is in the query box when it fires.
3. **A strip stays put while engaged.** An anchor that reads focus (`selectionAnchor` does) reports "nothing to show" the instant a field is clicked; `sync()` therefore holds position and visibility whenever a control holds focus.

A focused control also keeps whatever is in it — `sync()` never overwrites the value under a typist's hands. `Enter` commits, `Escape` restores and returns the caret, and a value is never committed twice.

## Hosting it

```js
import { toolbarPlugin, selectionAnchor } from 'prosemirror-surface' // registers both elements
import { project } from 'verbr'
import { commandFor } from 'prosemirror-verbs'

const run = (id, args, view) => commandFor(register, id, { args, collect })(view.state, view.dispatch, view)
const strip = { project: (state) => project(register, state, taste, { face: 'icon', includeUnavailable: true }), run }
const list = { project: (state) => project(register, state, taste, { includeUnavailable: true }), run }

const toolbar = document.createElement('pm-toolbar')
const palette = document.createElement('pm-palette')
document.body.append(toolbar, palette) // the host owns the elements' existence

// Which chord summons the palette is yours: summoning chrome is not a verb.
addEventListener('keydown', (e) => {
  if (e.key.toLowerCase() === 'p' && (e.metaKey || e.ctrlKey) && e.shiftKey) {
    e.preventDefault()
    palette.toggle()
  }
})

const plugins = [
  ...otherPlugins,
  toolbarPlugin(toolbar, strip, selectionAnchor),
  // No anchor: a palette's being-there is its own state.
  toolbarPlugin(palette, list),
]
toolbar.unavailable = 'hide' // or 'dim', the default
```

`face: 'icon'` is verbr's way of saying *this surface's face is a picture* — a palette leaves it at words, so it can see the verbs no strip would promote, which is most of the reason to have one.

A toolbar is a form bound to the selection: readbacks are its current values, the door its setter. A palette is the same register with the curation taken off.

## Status

Extracted 2026-07-19 from [pm-testing-venue](https://github.com/egildo/pm-testing-venue), which remains the proving ground. Moved to verbr's projection on 2026-10-19: specs became plain data, and the element stopped holding any verb's functions.

The destination named in the original stub — *a toolbar on a selection that morphs into a command palette when summoned* — **arrived on 2026-08-03**, and not as a morph: two elements over one base turned out to be the honest shape, because a strip and a palette disagree about placement, about dismissal and about what Escape means, and about nothing else. Fields and selects landed 2026-07-27 and crossed the focus line for the first time; the palette crossed it wholesale.

Known and deliberate, in case it reads as an oversight:

- **The exported type names still say `Toolbar`** — `ToolbarSpec`, `ToolbarItem`, `ToolbarGroup`, `ToolbarCommand`, `toolbarPlugin`. They predate the split and are shared by both surfaces. Renaming is an API break for no behaviour, so it waits for a release that has another reason to break.
- **`switch` and `radio` are floor words with no built-in drawing yet** — supply a template and they work today; without one they fall back to a button and a select.
- **No fuzzy matching.** `matcher` is the seam; substring is the default, and the day one is wanted it is a function, not a feature.
