// A floating command bar that knows nothing about the editor it serves.
//
// It is handed three things:
//   view    — an opaque host. Only `.state`, `.dispatch` and `.focus()` are touched.
//   specs   — a **tree**: controls, sections holding controls, separators.
//   anchor  — (view) => a rect to float near, or null for "nothing to show".
//
// What it draws is `as`, which defaults from the `kind` whoever projected the
// specs deduced. A light-DOM `<template data-as>` replaces the built-in drawing:
// the template owns structure and appearance, this element owns behaviour and
// state, and that line is the whole of what keeps it from being a framework.
//
// `state` is a token: it is passed to functions this element was given, and
// never inspected. Nothing here knows what a command is, only that calling one
// without a dispatch asks a question and calling it with one answers it. The
// types say the same thing: `any` below is the honest type of "not mine to
// know" — a spec produced by prosemirror-verbs' toolbarSpecs fits structurally,
// and so does anything else of this shape. No package joins these two; a shape does.

import { place } from './place.js'
import type { Rect } from './place.js'

/** A command as this element understands it: opaque, dry-runnable. */
export type ToolbarCommand = (state: any, dispatch?: any, view?: any) => boolean

/** One control, or a section separator. */
export interface ToolbarSpec {
  id: string
  label: string
  title?: string
  command: ToolbarCommand
  active?: (state: any) => boolean
  keys?: string[]
  /** What it **is**, deduced by whoever projected it: `action`, `toggle`,
   *  `choice`, `value`. Absent means a button — the shape this element began with. */
  kind?: string
  /** How to **draw** it: `button`, `switch`, `select`, `radio`, `field`, or a
   *  word only a supplied template knows. Unknown words fall back to the kind's
   *  default — a typo costs a switch, never a control. */
  as?: string
  /** The **name** of a picture. This element never resolves it; it writes it
   *  onto the template's icon hole as `data-icon` and lets CSS decide whether
   *  that is an SVG mask, an icon font, or a letter. */
  icon?: string
  /** The uncollapsed readback: what a field shows, which member a select holds. */
  value?: (state: any) => unknown
  /** Commit: hand it what the control holds, it hands back a command to run. */
  write?: (value: unknown) => ToolbarCommand
  /** A select's members. */
  options?: { value: string; label: string }[]
  /** A field's input type ('text', 'number', 'url', …). */
  type?: string
  /** How much room this control's domain needs: 'glyph' | 'bounded' | 'unbounded'.
   *  The element sizes by this rather than guessing one width for every field. */
  room?: string
  /** What to do when the dry run says no: 'dim' (default) or 'hide'. */
  unavailable?: 'dim' | 'hide'
}
/** A section: controls and further sections, drawn per its own `as`.
 *
 *  `inline` lays its children out as siblings (the strip's own arrangement);
 *  `menu` collapses them behind one face. They are two layouts of one tree,
 *  which is the whole reason the element eats a tree at all. */
export interface ToolbarGroup {
  group: string
  label: string
  as?: string
  icon?: string
  items: ToolbarItem[]
}

export type ToolbarItem = ToolbarSpec | ToolbarGroup | { separator: true }

const isGroup = (item: ToolbarItem): item is ToolbarGroup => 'items' in item
const isSeparator = (item: ToolbarItem): item is { separator: true } => 'separator' in item

// ── The two vocabularies, and why only one of them is closed ─────────────────
//
// **`as` is open.** Any word a venue writes arrives here untouched — the
// projection passes it through and validates nothing — because `as` says how a
// control *looks*, and appearance is the host's. The words below are this
// element's **floor**: what to draw when no template matched, so a venue that
// supplies none still gets a working strip. They are not a permitted list, and
// an unknown word costs a drawing, never a control.
//
// **`kind` is closed**, because behaviour follows from it: an action runs, a
// value commits what it holds, a choice commits one of its members. That is
// deduced from the declaration's shape and nobody may disagree with it (V15).
//
// Which is why the wiring below is chosen from the **kind** and from the
// element the template actually handed us — never from the word. It used to be
// chosen from the word, and so a choice drawn as anything but a `<select>` got
// select wiring on a button: `<option>`s appended into it, a `change` listener
// that could never fire, and no error anywhere. The open vocabulary was only
// half true, and this is the half that was missing.

// What each kind is drawn as when nobody said.
const DEFAULT_AS: Record<string, string> = {
  action: 'button',
  toggle: 'button',
  choice: 'select',
  value: 'field',
  // The vocabulary this element began with, so an older spec still works.
  button: 'button',
  select: 'select',
  field: 'field',
}

/** How a control behaves: what it does when you use it, and what it shows back. */
type Wiring = 'pressable' | 'picker' | 'field' | 'dropdown'

// Which built-in *drawing* a given `as` asks for. Consulted only when no
// template matched — it decides what markup to create, not how to wire it.
const BUILT_IN: Record<string, 'button' | 'select' | 'field' | 'dropdown'> = {
  button: 'button',
  switch: 'button',
  select: 'select',
  radio: 'select',
  field: 'field',
  dropdown: 'dropdown',
}

// The wiring, from the kind and the element we landed on. The element gets a
// say because a template is the one thing that can hand us a real `<select>` or
// a real `<input>`, and those carry their own behaviour that it would be rude
// to ignore. Everything else is pressable, which is the only wiring that works
// on an arbitrary element.
function wiringFor(spec: ToolbarSpec, control: HTMLElement, drawn: string): Wiring {
  const tag = control.tagName
  if (tag === 'SELECT') return 'picker'
  if (tag === 'INPUT') return 'field'
  // A choice that is not a `<select>` is a face plus one member per option.
  if (spec.kind === 'choice' || drawn === 'dropdown') return 'dropdown'
  // Anything else is pressable — including a `value` verb a venue chose to draw
  // as a button, which is not a mistake: that spec's command is the collecting
  // one, so the button asks for the value the way a chord would.
  return 'pressable'
}

let popoverSeq = 0

/** What to float near, or null for "nothing to show".
 *
 *  A **rect** in viewport coordinates. A point still works — `bottom` and
 *  `right` default to `top` and `left`, a zero-size rect — so an anchor written
 *  against the older contract keeps working and simply gains the clamping. */
export type ToolbarAnchor = (view: any) => Rect | null

const sheet = new CSSStyleSheet()
sheet.replaceSync(`
  :host {
    position: fixed;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    /* Controls are wider than glyphs, so a mixed strip can outgrow the
       viewport. It wraps rather than overflowing — a second row of chrome
       is a smaller cost than a button nobody can reach. */
    max-width: min(92vw, 680px);
    gap: 2px;
    padding: 4px;
    z-index: 30;
    border-radius: 8px;
    background: Canvas;
    border: 1px solid color-mix(in srgb, CanvasText 20%, transparent);
    box-shadow: 0 4px 14px rgb(0 0 0 / 0.28);
    /* No transform. A translate(-50%, -100%) used to do the centring and the
       lift, and it is exactly why the strip could not be kept on screen: a
       transform is applied after layout, so the top/left JS writes are not the
       box's real corner, and clamping them clamps the wrong number. Both
       coordinates are now computed honestly, in place.ts. */
  }

  /* [hidden] is display:none in the UA sheet, which :host's display would win against. */
  :host([hidden]) { display: none; }

  /* Light-DOM rendering projects through one slot, and a slot is a box: without
     this the whole strip becomes a single flex item and stacks into a column.
     display:contents lifts the assigned controls into the host's own flex line,
     so a templated strip lays out exactly like a built-in one. */
  slot { display: contents; }

  /* Docked: the bar sits in the document's flow where the host put it, instead
     of floating by the selection. Same element, same specs, same commands —
     only the manner differs, which is the point of naming manner at all. */
  :host([data-placement='docked']) {
    position: static;
    transform: none;
    max-width: none;
    flex-wrap: nowrap;
    border-radius: 6px;
    box-shadow: none;
  }
  /* A control the dry run refuses, when the host asked for hiding rather than
     dimming. Hidden here means gone from the layout, not merely faint. */
  .gone { display: none; }

  button {
    min-width: 30px;
    height: 28px;
    padding: 0 7px;
    border: 0;
    border-radius: 5px;
    background: transparent;
    color: CanvasText;
    font: inherit;
    font-size: 13px;
    line-height: 1;
    cursor: pointer;
  }

  button:hover:not(:disabled) { background: color-mix(in srgb, CanvasText 12%, transparent); }
  button[aria-pressed='true']  { background: color-mix(in srgb, CanvasText 22%, transparent); }
  button:disabled { opacity: 0.35; cursor: default; }

  button[data-id='strong'] { font-weight: 700; }
  button[data-id='em']     { font-style: italic; }
  button[data-id='code']   { font-family: ui-monospace, monospace; font-size: 11px; }

  /* Fields and selects: the same 28px seat a button sits in, so a mixed
     strip stays one line tall. Unlike a button they may take focus. */
  input, select {
    height: 28px;
    box-sizing: border-box;
    padding: 0 6px;
    border: 1px solid color-mix(in srgb, CanvasText 25%, transparent);
    border-radius: 5px;
    background: Canvas;
    color: CanvasText;
    font: inherit;
    font-size: 13px;
  }

  /* Width is the control's own business, declared as room. The element used to
     give every field 14ch, which is why a caption read "Listino — due po" and a
     three-digit pixel value sat in a box built for a sentence. */
  input { width: 14ch; }
  input[data-room='bounded'] { width: 8ch; }
  input[data-room='bounded'][type='number'] { width: 5ch; }
  input[data-room='unbounded'] { width: 24ch; }
  /* Docked, an unbounded field has the whole bar to grow into. */
  :host([data-placement='docked']) input[data-room='unbounded'] { flex: 1; width: auto; min-width: 12ch; }
  input:focus, select:focus {
    outline: 2px solid Highlight;
    outline-offset: -1px;
  }
  input:disabled, select:disabled { opacity: 0.35; }

  .separator {
    width: 1px;
    align-self: stretch;
    margin: 2px 3px;
    background: color-mix(in srgb, CanvasText 20%, transparent);
  }

  /* An inline section is an arrangement, not a box: display:contents lifts its
     children into the strip's own flex line, so nesting costs no layout. */
  .group[data-as='inline'] { display: contents; }

  /* A section collapsed behind its face, and a choice collapsed behind its
     current member. Two altitudes, one shape — which is why they share a rule
     and share the popover wiring underneath it. */
  .group[data-as='menu'], .group[data-as='dropdown'] { position: relative; display: inline-flex; }

  /* A dropdown's panel is a column: its members are alternatives to read down,
     not a row of tools to scan across. */
  .group[data-as='dropdown'] > [popover]:popover-open {
    flex-direction: column;
    flex-wrap: nowrap;
    align-items: stretch;
  }

  /* The collapsed section's own sheet. The popover attribute does the work —
     top layer, light dismiss, focus handling — so there is no open/close code
     anywhere in this element. */
  [popover] {
    position: fixed;
    inset: auto;
    margin: 0;
    padding: 4px;
    gap: 2px;
    /* Shrink-to-fit measures against the containing block — a strip as wide as
       its own face — so without this the panel folds into a single column. */
    width: max-content;
    max-width: 22rem;
    border-radius: 8px;
    border: 1px solid color-mix(in srgb, CanvasText 20%, transparent);
    background: Canvas;
    color: CanvasText;
    box-shadow: 0 4px 14px rgb(0 0 0 / 0.28);
  }
  /* **Only when open.** The UA hides a closed popover with \`display: none\`, and
     an author rule saying \`display: flex\` on the panel itself beats it — every
     author rule beats every UA rule, whatever the specificity. So a "collapsed"
     section sat open forever, and the strip carried a panel nobody had asked
     for. Say the display here, where being open is the condition. */
  [popover]:popover-open { position: fixed; display: flex; flex-wrap: wrap; }
`)

const isControl = (node: EventTarget | null): boolean =>
  node instanceof HTMLElement && (node.tagName === 'INPUT' || node.tagName === 'SELECT')

/** One drawn control: the box that hides, and the thing that takes the click.
 *
 *  **The wrapper hides, the control disables.** When a template wraps its
 *  control — `<li><button>` for a real `<ul>` — `root` is the `<li>` and
 *  `control` the button, and that split is the contract: `.gone` lands on the
 *  outer box so nothing of it is left in the layout, `disabled` on the thing a
 *  pointer can reach. With no template the two are the same node and the
 *  distinction costs nothing. */
interface Drawn {
  root: HTMLElement
  control: HTMLElement
  spec: ToolbarSpec
  /** A dropdown's panel of members, if it has one. */
  panel?: HTMLElement | null
  /** How it behaves — from its kind, never from its `as`. */
  wiring?: Wiring
}

export class PmToolbar extends HTMLElement {
  #shadow: ShadowRoot
  #specs: ToolbarItem[] = []
  #controls = new Map<string, Drawn>()
  #groups: HTMLElement[] = []
  // What each section drew *directly* into itself, in order. Kept rather than
  // re-queried: with wrappers in play the DOM cannot answer "is anything of
  // mine still showing" — a hidden `<li>` still contains a `<button>` that was
  // never marked, and a nested panel's contents are not this section's business.
  #members = new Map<HTMLElement, HTMLElement[]>()
  // A drawn node → the wrapper a container's item template put it in. The
  // wrapper is what hides, so this is where `sync` has to reach.
  #wrapped = new WeakMap<HTMLElement, HTMLElement>()
  // Where the controls were drawn — the shadow root, or this element's own
  // light DOM when a venue supplied templates.
  #target: ParentNode
  // What each control last showed or committed. A field must not re-commit
  // a value it was merely handed by sync, and Enter must not commit twice
  // because `change` fires behind it.
  #shown = new Map<string, string>()

  /** The opaque host — assigned by the driving plugin. */
  view: any = null
  /** Where to float — assigned by the driving plugin. */
  anchor: ToolbarAnchor | null = null

  /** 'anchored' (default) floats by the selection; 'docked' sits in the flow
   *  where the host placed it. The anchor still governs *whether* to show —
   *  only positioning changes hands. */
  get placement(): 'anchored' | 'docked' {
    return this.dataset.placement === 'docked' ? 'docked' : 'anchored'
  }
  set placement(value: 'anchored' | 'docked') {
    this.dataset.placement = value
  }

  constructor() {
    super()
    this.#shadow = this.attachShadow({ mode: 'open' })
    this.#shadow.adoptedStyleSheets = [sheet]
    this.#target = this.#shadow

    // Never take focus — *unless* the thing pressed is a field or a select,
    // which cannot be typed into from a distance. The original law protected
    // the host's target from a button press; a control keeps that protection
    // a different way: the host's selection is state, not focus, and it
    // survives the blur. Commits hand the caret back before they run.
    //
    // On the host rather than the shadow root, because controls may be drawn
    // into either — and `composedPath()[0]` is the real target, where a
    // listener on the host would otherwise see everything retargeted to itself.
    this.addEventListener('mousedown', (event) => {
      if (isControl(event.composedPath()[0] ?? null)) return
      event.preventDefault()
    })
  }

  // Where a control lives when it holds focus: the shadow root sees its own,
  // and light-DOM renderings answer through the document.
  #focused(): Element | null {
    if (this.#shadow.activeElement) return this.#shadow.activeElement
    const active = document.activeElement
    return active && active !== this && this.contains(active) ? active : null
  }

  // Not the constructor: `createElement` runs it synchronously and then throws
  // NotSupportedError if the element gained an attribute, handing back a dead
  // HTMLUnknownElement instead of propagating. Hiding starts here.
  connectedCallback() {
    this.hidden = true
    addEventListener('scroll', this.#follow, { capture: true, passive: true })
    addEventListener('resize', this.#follow, { passive: true })
  }

  disconnectedCallback() {
    removeEventListener('scroll', this.#follow, { capture: true })
    removeEventListener('resize', this.#follow)
  }

  set specs(value: ToolbarItem[] | null | undefined) {
    this.#specs = value ?? []
    this.#build()
  }

  get specs(): ToolbarItem[] {
    return this.#specs
  }

  // The templates a venue supplied, keyed by the `as` each one draws. Read from
  // light DOM every build, so a page may add one at any time.
  #templates(): Map<string, HTMLTemplateElement> {
    const found = new Map<string, HTMLTemplateElement>()
    for (const child of this.children) {
      if (child instanceof HTMLTemplateElement && child.dataset.as) found.set(child.dataset.as, child)
    }
    return found
  }

  // Templates render into **light DOM**, defaults into shadow.
  //
  // One rule, and it is the only one simple enough to be worth having: supply
  // nothing and the strip is fully encapsulated; supply templates and you have
  // opted into owning the appearance, so your markup lands in your own cascade
  // and your stylesheet reaches it with no `::part` ceremony. The shadow root
  // becomes a bare `<slot>` so the light children render at all.
  #build() {
    const templates = this.#templates()
    this.#controls.clear()
    this.#groups = []
    this.#members.clear()
    this.#shown.clear()

    if (templates.size) {
      this.#shadow.replaceChildren(document.createElement('slot'))
      for (const child of [...this.children]) if (!(child instanceof HTMLTemplateElement)) child.remove()
      this.#target = this
    } else {
      this.#shadow.replaceChildren()
      this.#target = this.#shadow
    }
    this.#draw(this.#specs, this.#target, templates, this.#itemTemplate(this.#target))
  }

  // Walk the tree. A separator falls between two adjacent sections, which is
  // exactly where the flat projection used to put one — the arrangement is
  // unchanged, it is only no longer baked in before the element sees it.
  //
  // `wrap` is the container's own template for its children, if it declared one.
  // A `<ul>` may only hold `<li>`, and that is the **container's** rule, not the
  // item's opinion — so it is answered here, where the container is, rather than
  // by every verb inside it separately claiming to be a list item.
  #draw(
    items: ToolbarItem[],
    parent: ParentNode,
    templates: Map<string, HTMLTemplateElement>,
    wrap?: HTMLTemplateElement | null,
  ) {
    const drawn: HTMLElement[] = []
    let previousWasGroup = false
    for (const item of items) {
      let node: HTMLElement
      if (isSeparator(item)) {
        node = this.#separator()
        previousWasGroup = false
      } else if (isGroup(item)) {
        if (previousWasGroup) parent.append(this.#wrap(wrap, this.#separator()))
        node = this.#group(item, templates)
        previousWasGroup = true
      } else {
        node = this.#control(item, templates)
        previousWasGroup = false
      }
      drawn.push(node)
      parent.append(this.#wrap(wrap, node))
    }
    return drawn
  }

  // Put a node inside a clone of the container's item template, or hand it back
  // untouched. The wrapper is what carries `.gone`, so a hidden control takes
  // its `<li>` with it rather than leaving an empty bullet behind.
  #wrap(template: HTMLTemplateElement | null | undefined, node: HTMLElement): HTMLElement {
    if (!template) return node
    const box = template.content.firstElementChild?.cloneNode(true) as HTMLElement | undefined
    if (!box) return node
    box.append(node)
    this.#wrapped.set(node, box)
    return box
  }

  // The container's template for its own children, if it declared one. Scoped
  // to `:scope >` so a nested section's template is that section's business.
  #itemTemplate(hole: ParentNode): HTMLTemplateElement | null {
    return hole.querySelector<HTMLTemplateElement>(':scope > template[data-slot="item"]')
  }

  // `popover` and `popovertarget` do all of it: top layer, light dismiss, focus
  // handling, escape. No open/close code lives in this element — only the
  // geometry, because the top layer paints outside the flow and so
  // `position: absolute` cannot anchor a panel to the button that opened it.
  // CSS anchor positioning is the platform's own answer and is not evenly
  // shipped, so the same `place` the strip uses does the job, preferring below,
  // because that is where everyone has looked for a dropdown since 1984.
  #popover(button: HTMLElement, panel: HTMLElement) {
    // A template may supply the panel; if it did not also say `popover`, then
    // `popovertarget` would point at an ordinary element and the button would
    // silently do nothing. Say it for them.
    if (!panel.hasAttribute('popover')) panel.setAttribute('popover', '')
    const id = panel.id || `pm-menu-${(popoverSeq += 1)}`
    panel.id = id
    button.setAttribute('popovertarget', id)
    button.setAttribute('aria-haspopup', 'true')
    button.setAttribute('aria-expanded', 'false')
    panel.addEventListener('toggle', () => {
      const open = panel.matches(':popover-open')
      button.setAttribute('aria-expanded', String(open))
      if (!open) return
      const box = panel.getBoundingClientRect()
      const spot = place(button.getBoundingClientRect(), { width: box.width, height: box.height }, { prefer: 'below' })
      panel.style.top = `${spot.top}px`
      panel.style.left = `${spot.left}px`
    })
  }

  #separator(): HTMLElement {
    const rule = document.createElement('div')
    rule.className = 'separator'
    return rule
  }

  #group(group: ToolbarGroup, templates: Map<string, HTMLTemplateElement>): HTMLElement {
    const as = group.as ?? 'inline'
    const template = templates.get(as)
    const root = template
      ? (template.content.firstElementChild!.cloneNode(true) as HTMLElement)
      : document.createElement(as === 'menu' ? 'span' : 'div')
    if (!template) root.className = 'group'
    root.dataset.as = as
    root.dataset.group = group.group

    const face = root.querySelector<HTMLElement>('[data-slot="face"]')
    const hole = root.querySelector<HTMLElement>('[data-slot="items"]')

    // A section is collapsed when it *is* one, not when it is called one. With
    // no template that means the word — `menu` is this element's own floor. With
    // a template it means the markup: a panel the venue wrote `popover` on is a
    // panel meant to open, whatever the venue chose to call the drawing. Which
    // is what an open vocabulary has to mean at this altitude too — otherwise a
    // second kind of section (a column of words beside a row of icons) would
    // have to lie about its name to get the behaviour it plainly declared.
    //
    // Not the *face*: an inline section may want one, as a heading over a
    // palette column, and a heading is not a thing you open.
    if (as === 'menu' || hole?.hasAttribute('popover')) {
      const button = face ?? document.createElement('button')
      if (!face) {
        ;(button as HTMLButtonElement).type = 'button'
        root.append(button)
      }
      const panel = hole ?? document.createElement('div')
      if (!hole) root.append(panel)
      this.#popover(button, panel)
      this.#face(button, group)
      this.#members.set(root, this.#draw(group.items, panel, templates, this.#itemTemplate(panel)))
    } else {
      // An inline section is an arrangement, not a thing with a face. It gets
      // one only if a template asked for one (a heading over a palette column);
      // writing a label onto a bare section would put a stray text node in the
      // strip, ahead of the controls.
      if (face) this.#face(face, group)
      const into = hole ?? root
      this.#members.set(root, this.#draw(group.items, into, templates, this.#itemTemplate(into)))
    }

    this.#groups.push(root)
    return root
  }

  // Fill the holes a template left, or write the words a built-in needs. The
  // vocabulary is four — `icon`, `label`, `face`, `items` — and a fifth has to
  // earn its place, because this is where a template language would start.
  #face(node: HTMLElement, spec: { label: string; title?: string; icon?: string }) {
    const iconHole = node.querySelector<HTMLElement>('[data-slot="icon"]')
    if (iconHole) {
      // The name, handed on. What it *means* is the venue's stylesheet's
      // business — an SVG mask, an icon font, a letter. Never resolved here.
      if (spec.icon) iconHole.dataset.icon = spec.icon
      else iconHole.remove()
    }
    const labelHole = node.querySelector<HTMLElement>('[data-slot="label"]')
    if (labelHole) labelHole.textContent = spec.label
    // No template, no holes: the default rendering draws the words. A stranger
    // gets a wordy but readable toolbar rather than a row of blank boxes.
    if (!iconHole && !labelHole && !node.childElementCount) node.textContent = spec.label
    // An icon-only control has no text node at all, so the accessible name
    // stops being a nicety and becomes the only name there is. A section has no
    // separate tooltip name, so its label is what it is called.
    const name = spec.title ?? spec.label
    if (name) {
      node.title = name
      node.setAttribute('aria-label', name)
    }
  }

  #control(spec: ToolbarSpec, templates: Map<string, HTMLTemplateElement>): HTMLElement {
    const as = spec.as ?? DEFAULT_AS[spec.kind ?? 'action'] ?? 'button'
    const template = templates.get(as)
    // An `as` this element has never heard of falls back to the kind's own
    // default *drawing*: a typo costs a switch, never a control.
    const built = BUILT_IN[as] ?? BUILT_IN[DEFAULT_AS[spec.kind ?? 'action'] ?? 'button'] ?? 'button'

    let root: HTMLElement
    let control: HTMLElement
    let panel: HTMLElement | null = null
    if (template) {
      root = template.content.firstElementChild!.cloneNode(true) as HTMLElement
      control = root.querySelector<HTMLElement>('[data-slot="face"], button, input, select') ?? root
      panel = root.querySelector<HTMLElement>('[data-slot="items"]')
    } else if (built === 'dropdown') {
      ;({ root, control, panel } = this.#dropdown())
    } else {
      control = built === 'field' ? this.#input(spec) : built === 'select' ? this.#picker(spec) : this.#pressable(spec)
      root = control
    }

    // From the kind and the element in hand — never from the word. See `wiringFor`.
    const wiring = wiringFor(spec, control, built)
    if (wiring === 'field') this.#wireField(control as HTMLInputElement, spec)
    else if (wiring === 'picker') this.#wirePicker(control as HTMLSelectElement, spec)
    else if (wiring === 'dropdown') this.#wireDropdown(control, panel, spec, templates)
    else this.#wirePressable(control, spec)

    if (wiring !== 'field' && wiring !== 'picker') this.#face(control, spec)
    // On both, when a template put them apart, so a stylesheet can reach either
    // by id. Nothing *behavioural* reads these — `#collapse` used to, and got a
    // hidden item's unmarked button for its trouble.
    root.dataset.id = spec.id
    control.dataset.id = spec.id
    this.#controls.set(spec.id, { root, control, spec, panel, wiring })
    return root
  }

  // The built-in dropdown: a face and a panel, the same two parts a collapsed
  // section has, because they are the same shape seen from one altitude down.
  #dropdown(): { root: HTMLElement; control: HTMLElement; panel: HTMLElement } {
    const root = document.createElement('span')
    root.className = 'group'
    root.dataset.as = 'dropdown'
    const control = document.createElement('button')
    control.type = 'button'
    const panel = document.createElement('div')
    panel.setAttribute('popover', '')
    root.append(control, panel)
    return { root, control, panel }
  }

  // A choice collapsed behind its current member. Everything it needs was
  // already on the spec — `options` is the domain, `value` the readback, `write`
  // the commit — which is why this is a drawing and not a feature: nothing new
  // is declared, the same declaration is simply not flattened into a `<select>`.
  #wireDropdown(
    face: HTMLElement,
    panel: HTMLElement | null,
    spec: ToolbarSpec,
    templates: Map<string, HTMLTemplateElement>,
  ) {
    if (!panel) {
      // A template drew a choice with no items hole: it wants the face and
      // nothing else. Honour it rather than inventing a panel it did not ask for.
      this.#wirePressable(face, spec)
      return
    }
    this.#popover(face, panel)
    const item = this.#itemTemplate(panel)
    for (const option of spec.options ?? []) {
      const member = option as { value: string; label: string; icon?: string }
      // A member is not a verb of its own — it is this verb, held to one value —
      // so it is drawn as an ordinary control and wears the venue's own button
      // template for free. Its id is keyed apart from `expand`'s `base:member`
      // convention on purpose: a host drawing the base *and* its conjugated
      // forms is a real arrangement, and these must not quietly overwrite those.
      const drawn = this.#control(
        {
          id: `${spec.id}::${member.value}`,
          label: member.label ?? member.value,
          ...(member.icon ? { icon: member.icon } : {}),
          kind: 'action',
          // The platform's own word for a member of a chooser, and its own
          // drawing: a row of words. Keyed apart from `button` so a venue can
          // template a panel row without touching its strip's icon-only faces —
          // and with no template at all, the built-in draws the label, which is
          // what a chooser needs and what an icon-only face could never say.
          as: 'option',
          command: (state, dispatch) => {
            // Available exactly when the verb is: the parent answers for its own
            // members, and asking the same question twice invites two answers.
            if (!dispatch) return spec.command(state)
            this.#commit(spec, member.value)
            // A chooser's panel has spent its purpose the moment you choose. (A
            // section drawn as a menu stays open, deliberately — you may well
            // want a second row after the first.)
            panel.hidePopover?.()
            return true
          },
          // Lit when it is the one the readback answers, so the panel shows
          // where you are and not only where you may go.
          active: (state) => String(spec.value?.(state) ?? '') === member.value,
        },
        templates,
      )
      panel.append(this.#wrap(item, drawn))
    }
  }

  #pressable(_spec: ToolbarSpec): HTMLButtonElement {
    const button = document.createElement('button')
    button.type = 'button'
    return button
  }

  #wirePressable(node: HTMLElement, spec: ToolbarSpec) {
    node.addEventListener('click', () => {
      spec.command(this.view.state, this.view.dispatch, this.view)
    })
  }

  // A field is the collector, inlined: it shows the value the verb reads back
  // and commits what you leave in it. Escape restores, so an abandoned edit
  // costs nothing.
  #input(spec: ToolbarSpec): HTMLInputElement {
    const input = document.createElement('input')
    input.type = spec.type === 'number' ? 'number' : 'text'
    if (spec.room) input.dataset.room = spec.room
    return input
  }

  #wireField(input: HTMLInputElement, spec: ToolbarSpec) {
    if (spec.room) input.dataset.room = spec.room
    input.placeholder = spec.label
    input.setAttribute('aria-label', spec.title ?? spec.label)
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault()
        this.#commit(spec, input.value)
      } else if (event.key === 'Escape') {
        event.preventDefault()
        input.value = this.#shown.get(spec.id) ?? ''
        this.view?.focus?.()
      }
      // Every other key is the field's own: the host must not see it.
      event.stopPropagation()
    })
    input.addEventListener('change', () => this.#commit(spec, input.value))
  }

  #picker(_spec: ToolbarSpec): HTMLSelectElement {
    return document.createElement('select')
  }

  #wirePicker(select: HTMLSelectElement, spec: ToolbarSpec) {
    select.setAttribute('aria-label', spec.title ?? spec.label)
    // The blank stands for "no member here" — a readback may be null, and a
    // select with no matching option would otherwise show the first one and lie.
    if (!select.options.length) {
      const blank = document.createElement('option')
      blank.value = ''
      blank.textContent = '—'
      select.append(blank)
      for (const option of spec.options ?? []) {
        const el = document.createElement('option')
        el.value = option.value
        el.textContent = option.label ?? option.value
        select.append(el)
      }
    }
    select.addEventListener('change', () => {
      if (select.value) this.#commit(spec, select.value)
    })
  }

  // Hand the caret back *before* running: a host that moves focus onto its own
  // components during the dispatch (a node view claiming a cell) needs to see a
  // focused editor while the transaction is applied, not one microtask later.
  #commit(spec: ToolbarSpec, value: string) {
    if (this.#shown.get(spec.id) === value) return
    const command = spec.write?.(value)
    if (!command) return
    this.#shown.set(spec.id, value)
    this.view?.focus?.()
    command(this.view.state, this.view.dispatch, this.view)
  }

  // Called by the host whenever its state changes.
  sync() {
    // A control that holds focus holds it *from* the host — whose anchor then
    // sees an unfocused editor and says "nothing to show". Staying put is the
    // truthful answer: the selection the strip serves has not gone anywhere.
    const engaged = !!this.#focused()
    const at = this.anchor?.(this.view)
    if (!at && !engaged) {
      this.hidden = true
      return
    }
    if (at) {
      this.hidden = false
      // A docked bar takes its position from the document, not from us; the
      // anchor's answer still decides whether it is there at all.
      if (this.placement === 'anchored') this.#position(at)
    }

    const focused = this.#focused()
    for (const { root, control, spec, wiring } of this.#controls.values()) {
      const available = !!spec.command(this.view.state)
      ;(control as HTMLInputElement).disabled = !available
      // Dim or vanish, the host's call. Hiding is what lets one strip serve
      // several selections without carrying every group at once; dimming is
      // what keeps its width from jumping as the caret moves. Neither is
      // universally right, so neither is decided here.
      //
      // On the wrapper a container's item template put it in, when there is
      // one — a hidden control must take its `<li>` with it, or the list keeps
      // a bullet for something that is not there.
      ;(this.#wrapped.get(root) ?? root).classList.toggle('gone', !available && spec.unavailable === 'hide')
      if (wiring === 'dropdown') {
        // The face wears the member the readback answers, and falls back to the
        // verb's own name and picture when it answers none — which is the same
        // honesty as the select's blank: a chooser showing a member it is not
        // on would be lying.
        const shown = String(spec.value?.(this.view.state) ?? '')
        this.#shown.set(spec.id, shown)
        const member = spec.options?.find((option) => option.value === shown) as
          | { value: string; label?: string; icon?: string }
          | undefined
        // A domain member may carry only its value — a plugin naming its own
        // members is taste, and plenty of them decline. Falling back to the
        // value is what the select has always done; the face owes the same.
        const named = member ? (member.label ?? member.value) : null
        this.#face(control, {
          label: named ?? spec.label,
          icon: member?.icon ?? spec.icon,
          // Both halves said aloud: what this chooses, and what it is on. An
          // icon-only face has no text for a screen reader to fall back to.
          title: named ? `${spec.title ?? spec.label}: ${named}` : (spec.title ?? spec.label),
        })
      } else if (spec.write) {
        const shown = String(spec.value?.(this.view.state) ?? '')
        this.#shown.set(spec.id, shown)
        // Never fight the typist: a focused control keeps what is in it.
        if (focused !== control) (control as HTMLInputElement).value = shown
      } else {
        const lit = String(spec.active?.(this.view.state) ?? false)
        // `aria-pressed` for a button, `aria-checked` for a switch — the same
        // reading, said in whichever word the role the template chose expects.
        control.setAttribute(control.getAttribute('role') === 'switch' ? 'aria-checked' : 'aria-pressed', lit)
      }
    }
    this.#collapse()
  }

  // Availability empties things, and an empty thing should not draw. A section
  // holding nothing live goes with its contents — the generalisation of what
  // separator-trimming already did for a divider, now one altitude up — and
  // then the dividers that no longer divide anything follow.
  // Asked of what each section drew, not of the DOM under it. Querying was
  // right only while a control *was* its own box: once a template wraps one,
  // `[data-id]:not(.gone)` finds the inner button of a hidden item — the button
  // is never the thing marked — and a section of hidden items would stay open.
  #collapse() {
    // `#groups` is already innermost-first — a section is recorded after the
    // children it drew — so a section holding only empty sections goes too,
    // in one pass. A separator is not a member: it divides, it is not content.
    for (const group of this.#groups) {
      const members = this.#members.get(group) ?? []
      const showing = members.some(
        (node) => !node.classList.contains('separator') && !(this.#wrapped.get(node) ?? node).classList.contains('gone'),
      )
      group.classList.toggle('gone', !showing)
    }
    this.#trimSeparators(this.#target)
    for (const group of this.#groups) this.#trimSeparators(group)
  }

  // Measure, then decide, then apply. The measuring has to happen while the
  // element is visible — a hidden box has no size — which is why `sync` unhides
  // first; there is no flash, because layout is computed synchronously here and
  // paint happens after this task.
  //
  // `side` rides out as an attribute rather than being consumed here: which
  // way a strip ended up flipping is exactly the sort of thing a stylesheet
  // wants (a pointer arrow that must swap ends), and it is not this element's
  // business to draw one.
  #position(at: Rect) {
    const box = this.getBoundingClientRect()
    const spot = place(at, { width: box.width, height: box.height })
    this.style.top = `${spot.top}px`
    this.style.left = `${spot.left}px`
    this.dataset.side = spot.side
  }

  // A strip pinned in viewport coordinates does not move when the page scrolls,
  // and no transaction fires to tell it to — so it detaches from the selection
  // it serves and hangs in mid-air. Scrolling and resizing are the two things
  // that change the answer without changing the state, so they are the two
  // things this listens to. Capture, because scroll does not bubble from an
  // inner scroller.
  #follow = () => {
    if (this.view && !this.hidden) this.sync()
  }

  // A separator divides two sections; with hiding in play a whole section can
  // vanish and leave its rule behind, so the strip opens with a stack of
  // orphaned lines. Which separators still divide anything is the element's own
  // business — it is the only thing that knows what is currently drawn — unlike
  // *what to hide*, which is the host's.
  #trimSeparators(parent: ParentNode) {
    let lastKept: Element | null = null
    let sinceKept = 0
    for (const el of parent.children) {
      if (el.tagName === 'TEMPLATE' || el.tagName === 'SLOT') continue
      if (el.classList.contains('separator')) {
        if (sinceKept === 0) el.classList.add('gone')
        else {
          el.classList.remove('gone')
          lastKept = el
          sinceKept = 0
        }
      } else if (!el.classList.contains('gone')) sinceKept++
    }
    if (lastKept && sinceKept === 0) lastKept.classList.add('gone')
  }
}

if (!customElements.get('pm-toolbar')) customElements.define('pm-toolbar', PmToolbar)
