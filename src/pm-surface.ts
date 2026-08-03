// What every surface in this package is, underneath.
//
// A surface is handed two things — an opaque `view` and a **tree** of specs —
// and turns them into DOM that stays in step with the host. Drawing, template
// resolution, wiring, publishing and availability all live here; what a
// particular surface *is* lives in the subclass:
//
//   PmToolbar — a strip that floats by the selection or docks in the flow.
//   PmPalette — a modal list you search, walk with the arrows, and descend into.
//
// The line between them is one question asked twice. **The base decides that a
// section is collapsed; the subclass decides what collapsing means** — a popover
// beside its face for a strip, a page you push for a palette. Same tree, same
// templates, two navigations, and neither one written twice.
//
// `state` is a token: it is passed to functions this element was given and never
// inspected. `any` below is the honest type of "not mine to know" — a spec
// produced by prosemirror-verbs' projections fits structurally, and so does
// anything else of this shape. No package joins these two; a shape does.

import { place } from './place.js'

/** A command as a surface understands it: opaque, dry-runnable. */
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
   *  `choice`, `value`. Absent means a button — the shape this began with. */
  kind?: string
  /** How to **draw** it: `button`, `switch`, `select`, `radio`, `field`, or a
   *  word only a supplied template knows. Unknown words fall back to the kind's
   *  default — a typo costs a switch, never a control. */
  as?: string
  /** The **name** of a picture. Never resolved here; it goes onto the template's
   *  icon hole as `data-icon` and CSS decides whether that is an SVG mask, an
   *  icon font, or a letter. */
  icon?: string
  /** The uncollapsed readback: what a field shows, which member a select holds. */
  value?: (state: any) => unknown
  /** Commit: hand it what the control holds, it hands back a command to run. */
  write?: (value: unknown) => ToolbarCommand
  /** A select's members. */
  options?: { value: string; label: string }[]
  /** A field's input type ('text', 'number', 'url', …). */
  type?: string
  /** How much room this control's domain needs: 'glyph' | 'bounded' | 'unbounded'. */
  room?: string
  /** What to do when the dry run says no: 'dim' (default) or 'hide'. */
  unavailable?: 'dim' | 'hide'
  /** What a palette's query matches against. Absent and it is composed from the
   *  words — see `PmPalette.searchText`. */
  search?: string
}

/** A section: controls and further sections, drawn per its own `as`.
 *
 *  `inline` lays its children out as siblings; a collapsed section hides them
 *  behind one face. They are two layouts of one tree, which is the whole reason
 *  a surface eats a tree at all. */
export interface ToolbarGroup {
  group: string
  label: string
  as?: string
  icon?: string
  items: ToolbarItem[]
}

export type ToolbarItem = ToolbarSpec | ToolbarGroup | { separator: true }

export const isGroup = (item: ToolbarItem): item is ToolbarGroup => 'items' in item
export const isSeparator = (item: ToolbarItem): item is { separator: true } => 'separator' in item

// ── The two vocabularies, and why only one of them is closed ─────────────────
//
// **`as` is open.** Any word a venue writes arrives here untouched — the
// projection passes it through and validates nothing — because `as` says how a
// control *looks*, and appearance is the host's. The words below are this
// package's **floor**: what to draw when no template matched, so a venue that
// supplies none still gets something working. They are not a permitted list,
// and an unknown word costs a drawing, never a control.
//
// **`kind` is closed**, because behaviour follows from it: an action runs, a
// value commits what it holds, a choice commits one of its members. That is
// deduced from the declaration's shape and nobody may disagree with it (V15).
//
// Which is why the wiring below is chosen from the **kind** and from the element
// the template actually handed us — never from the word.

const DEFAULT_AS: Record<string, string> = {
  action: 'button',
  toggle: 'button',
  choice: 'select',
  value: 'field',
  // The vocabulary this began with, so an older spec still works.
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

// What a surface reads for itself. Everything else on a spec is a host's own
// word and gets published to the DOM untouched — see `publish`.
const SPEC_OWNED = new Set([
  'id',
  'label',
  'title',
  'command',
  'active',
  'keys',
  'kind',
  'as',
  'icon',
  'value',
  'write',
  'options',
  'type',
  'unavailable',
])

let popoverSeq = 0

/** The shared sheet: what a *control* looks like, at any altitude. A surface's
 *  own layout is its own sheet, adopted after this one. */
export const controlSheet = new CSSStyleSheet()
controlSheet.replaceSync(`
  /* Light-DOM rendering projects through one slot, and a slot is a box: without
     this the whole surface becomes a single flex item. display:contents lifts
     the assigned controls into the host's own layout. */
  slot { display: contents; }

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

  /* Fields and selects: the same 28px seat a button sits in. Unlike a button
     they may take focus. */
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

  /* Width is the control's own business, declared as room. */
  input { width: 14ch; }
  input[data-room='bounded'] { width: 8ch; }
  input[data-room='bounded'][type='number'] { width: 5ch; }
  input[data-room='unbounded'] { width: 24ch; }
  input:focus, select:focus {
    outline: 2px solid Highlight;
    outline-offset: -1px;
  }
  input:disabled, select:disabled { opacity: 0.35; }

  /* A choice collapsed behind its current member. */
  .group[data-as='dropdown'] { position: relative; display: inline-flex; }
  .group[data-as='dropdown'] > [popover]:popover-open {
    flex-direction: column;
    flex-wrap: nowrap;
    align-items: stretch;
  }

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
     author rule beats every UA rule, whatever the specificity. Say the display
     here, where being open is the condition. */
  [popover]:popover-open { position: fixed; display: flex; flex-wrap: wrap; }
`)

const isControl = (node: EventTarget | null): boolean =>
  node instanceof HTMLElement && (node.tagName === 'INPUT' || node.tagName === 'SELECT')

/** One drawn control: the box that hides, and the thing that takes the click.
 *
 *  **The wrapper hides, the control disables.** When a template wraps its
 *  control — `<li><button>` for a real `<ul>` — `root` is the `<li>` and
 *  `control` the button: `.gone` lands on the outer box so nothing of it is
 *  left in the layout, `disabled` on the thing a pointer can reach. */
export interface Drawn {
  root: HTMLElement
  control: HTMLElement
  spec: ToolbarSpec
  /** A dropdown's panel of members, if it has one. */
  panel?: HTMLElement | null
  /** How it behaves — from its kind, never from its `as`. */
  wiring?: Wiring
}

export abstract class PmSurface extends HTMLElement {
  protected shadow: ShadowRoot
  #specs: ToolbarItem[] = []
  protected controls = new Map<string, Drawn>()
  protected groups: HTMLElement[] = []
  // What each section drew *directly* into itself, in order. Kept rather than
  // re-queried: with wrappers in play the DOM cannot answer "is anything of mine
  // still showing" — a hidden `<li>` still contains a `<button>` that was never
  // marked, and a nested panel's contents are not this section's business.
  protected members = new Map<HTMLElement, HTMLElement[]>()
  // A drawn node → the wrapper a container's item template put it in. The
  // wrapper is what hides, so this is where `sync` has to reach.
  protected wrapped = new WeakMap<HTMLElement, HTMLElement>()
  // Where the controls were drawn — the shadow root, or this element's own light
  // DOM when a venue supplied templates.
  protected target: ParentNode
  // What each control last showed or committed. A field must not re-commit a
  // value it was merely handed by sync, and Enter must not commit twice because
  // `change` fires behind it.
  protected shown = new Map<string, string>()

  /** The opaque host — assigned by the driving plugin. */
  view: any = null

  constructor() {
    super()
    this.shadow = this.attachShadow({ mode: 'open' })
    this.shadow.adoptedStyleSheets = [controlSheet]
    this.target = this.shadow

    // Never take focus — *unless* the thing pressed is a field or a select,
    // which cannot be typed into from a distance. The host's selection is state,
    // not focus, and it survives the blur. Commits hand the caret back first.
    //
    // On the host rather than the shadow root, because controls may be drawn into
    // either — and `composedPath()[0]` is the real target, where a listener on
    // the host would otherwise see everything retargeted to itself.
    this.addEventListener('mousedown', (event) => {
      if (isControl(event.composedPath()[0] ?? null)) return
      event.preventDefault()
    })
  }

  // Where a control lives when it holds focus: the shadow root sees its own, and
  // light-DOM renderings answer through the document.
  protected focused(): Element | null {
    if (this.shadow.activeElement) return this.shadow.activeElement
    const active = document.activeElement
    return active && active !== this && this.contains(active) ? active : null
  }

  set specs(value: ToolbarItem[] | null | undefined) {
    this.#specs = value ?? []
    this.build()
  }

  get specs(): ToolbarItem[] {
    return this.#specs
  }

  // The templates a venue supplied, keyed by the `as` each one draws. Read from
  // light DOM every build, so a page may add one at any time.
  protected templates(): Map<string, HTMLTemplateElement> {
    const found = new Map<string, HTMLTemplateElement>()
    for (const child of this.children) {
      if (child instanceof HTMLTemplateElement && child.dataset.as) found.set(child.dataset.as, child)
    }
    return found
  }

  // Templates render into **light DOM**, defaults into shadow.
  //
  // One rule, and the only one simple enough to be worth having: supply nothing
  // and the surface is fully encapsulated; supply templates and you have opted
  // into owning appearance, so your markup lands in your own cascade and your
  // stylesheet reaches it with no `::part` ceremony. The shadow root becomes a
  // bare `<slot>` so the light children render at all.
  protected build() {
    const templates = this.templates()
    this.controls.clear()
    this.groups = []
    this.members.clear()
    this.shown.clear()

    if (templates.size) {
      this.shadow.replaceChildren(document.createElement('slot'))
      for (const child of [...this.children]) if (!(child instanceof HTMLTemplateElement)) child.remove()
      this.target = this
    } else {
      this.shadow.replaceChildren()
      this.target = this.shadow
    }
    this.draw(this.#specs, this.target, templates, this.itemTemplate(this.target))
  }

  // Walk the tree. A divider falls between two adjacent sections — which a
  // surface that has no use for one declines by answering null.
  //
  // `wrap` is the container's own template for its children, if it declared one.
  // A `<ul>` may only hold `<li>`, and that is the **container's** rule, not the
  // item's opinion — so it is answered here, where the container is, rather than
  // by every verb inside it separately claiming to be a list item.
  protected draw(
    items: ToolbarItem[],
    parent: ParentNode,
    templates: Map<string, HTMLTemplateElement>,
    wrap?: HTMLTemplateElement | null,
  ) {
    const drawn: HTMLElement[] = []
    let previousWasGroup = false
    for (const item of items) {
      let node: HTMLElement | null
      if (isSeparator(item)) {
        node = this.divider()
        previousWasGroup = false
      } else if (isGroup(item)) {
        if (previousWasGroup) {
          const rule = this.divider()
          if (rule) parent.append(this.wrap(wrap, rule))
        }
        node = this.group(item, templates)
        previousWasGroup = true
      } else {
        node = this.control(item, templates)
        previousWasGroup = false
      }
      if (!node) continue
      drawn.push(node)
      parent.append(this.wrap(wrap, node))
    }
    return drawn
  }

  /** What divides two adjacent sections. A strip draws a rule; a surface that
   *  lays its sections out as headings answers null and gets none. */
  protected divider(): HTMLElement | null {
    const rule = document.createElement('div')
    rule.className = 'separator'
    return rule
  }

  // Put a node inside a clone of the container's item template, or hand it back
  // untouched. The wrapper carries `.gone`, so a hidden control takes its `<li>`
  // with it rather than leaving an empty bullet behind.
  protected wrap(template: HTMLTemplateElement | null | undefined, node: HTMLElement): HTMLElement {
    if (!template) return node
    const box = template.content.firstElementChild?.cloneNode(true) as HTMLElement | undefined
    if (!box) return node
    box.append(node)
    this.wrapped.set(node, box)
    return box
  }

  // The container's template for its own children, if it declared one. Scoped to
  // `:scope >` so a nested section's template is that section's business.
  protected itemTemplate(hole: ParentNode): HTMLTemplateElement | null {
    return hole.querySelector<HTMLTemplateElement>(':scope > template[data-slot="item"]')
  }

  // `popover` and `popovertarget` do the rest: top layer, light dismiss, focus
  // handling. Only the geometry is ours, because the top layer paints outside
  // the flow and so `position: absolute` cannot anchor a panel to the button
  // that opened it. CSS anchor positioning is the platform's own answer and is
  // not evenly shipped, so `place` does the job, preferring below.
  // Named apart from `HTMLElement.popover`, which is the platform's own
  // property for the attribute and would be shadowed by a method of that name.
  protected wirePopover(button: HTMLElement, panel: HTMLElement) {
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

  /** Is this section collapsed — hidden behind one face rather than laid out?
   *
   *  With no template that is the word: `menu` is this package's floor. With a
   *  template it is the markup — a panel the venue wrote `popover` on is a panel
   *  meant to open, whatever the venue called the drawing. Which is what an open
   *  vocabulary has to mean at this altitude too: otherwise a second kind of
   *  section would have to lie about its name to get the behaviour it declared. */
  protected collapses(as: string, hole: HTMLElement | null): boolean {
    return as === 'menu' || !!hole?.hasAttribute('popover')
  }

  /** **The seam.** The base decided this section is collapsed; a subclass says
   *  what that means — a popover beside the face, or a page you descend into. */
  protected abstract collapse(face: HTMLElement, panel: HTMLElement, group: ToolbarGroup): void

  protected group(group: ToolbarGroup, templates: Map<string, HTMLTemplateElement>): HTMLElement {
    const as = group.as ?? 'inline'
    const template = templates.get(as)
    const root = template
      ? (template.content.firstElementChild!.cloneNode(true) as HTMLElement)
      : document.createElement(this.collapses(as, null) ? 'span' : 'div')
    if (!template) root.className = 'group'
    root.dataset.as = as
    root.dataset.group = group.group

    const face = root.querySelector<HTMLElement>('[data-slot="face"]')
    const hole = root.querySelector<HTMLElement>('[data-slot="items"]')

    if (this.collapses(as, hole)) {
      const button = face ?? document.createElement('button')
      if (!face) {
        ;(button as HTMLButtonElement).type = 'button'
        root.append(button)
      }
      const panel = hole ?? document.createElement('div')
      if (!hole) root.append(panel)
      this.collapse(button, panel, group)
      this.face(button, group)
      this.members.set(root, this.draw(group.items, panel, templates, this.itemTemplate(panel)))
    } else {
      // An inline section is an arrangement, not a thing with a face. It gets one
      // only if a template asked for one (a heading over a palette column);
      // writing a label onto a bare section would put a stray text node ahead of
      // the controls.
      if (face) this.face(face, group)
      const into = hole ?? root
      this.members.set(root, this.draw(group.items, into, templates, this.itemTemplate(into)))
    }

    this.groups.push(root)
    return root
  }

  // Fill the holes a template left, or write the words a built-in needs. The
  // vocabulary is four — `icon`, `label`, `face`, `items` — and a fifth has to
  // earn its place, because this is where a template language would start.
  protected face(node: HTMLElement, spec: { label: string; title?: string; icon?: string }) {
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
    // gets a wordy but readable surface rather than a row of blank boxes.
    if (!iconHole && !labelHole && !node.childElementCount) node.textContent = spec.label
    // An icon-only control has no text node at all, so the accessible name stops
    // being a nicety and becomes the only name there is.
    const name = spec.title ?? spec.label
    if (name) {
      node.title = name
      node.setAttribute('aria-label', name)
    }
  }

  protected control(spec: ToolbarSpec, templates: Map<string, HTMLTemplateElement>): HTMLElement {
    const as = spec.as ?? DEFAULT_AS[spec.kind ?? 'action'] ?? 'button'
    const template = templates.get(as)
    // An `as` this package has never heard of falls back to the kind's own
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
      control = built === 'field' ? this.#input(spec) : built === 'select' ? this.#picker(spec) : this.#pressable()
      root = control
    }

    // From the kind and the element in hand — never from the word.
    const wiring = wiringFor(spec, control, built)
    if (wiring === 'field') this.#wireField(control as HTMLInputElement, spec)
    else if (wiring === 'picker') this.#wirePicker(control as HTMLSelectElement, spec)
    else if (wiring === 'dropdown') this.#wireDropdown(control, panel, spec, templates)
    else this.wirePressable(control, spec)

    if (wiring !== 'field' && wiring !== 'picker') this.face(control, spec)
    // On both, when a template put them apart, so a stylesheet can reach either
    // by id. Nothing *behavioural* reads these.
    root.dataset.id = spec.id
    control.dataset.id = spec.id
    this.#publish(root, spec)
    this.controls.set(spec.id, { root, control, spec, panel, wiring })
    return root
  }

  // Anything on the spec this element does not itself consume, written onto the
  // DOM as `data-*` and left there.
  //
  // **Publish, don't hole.** The projection already carries a host's own
  // attributes through to the spec (`passthrough`); this carries them the last
  // step, to where a stylesheet can reach them. So a chord is drawn with
  // `content: attr(data-chord)` — no sixth hole, no template change, and nothing
  // here knows what a chord is. It is the icon rule one turn further out: the
  // value travels, and whoever draws decides what it looks like.
  //
  // Strings and numbers only. A function is behaviour, and behaviour is not
  // something to hand to CSS.
  #publish(node: HTMLElement, spec: ToolbarSpec) {
    for (const [key, value] of Object.entries(spec)) {
      if (SPEC_OWNED.has(key)) continue
      if (typeof value !== 'string' && typeof value !== 'number') continue
      node.dataset[key] = String(value)
    }
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

  // A choice collapsed behind its current member. Everything it needs was already
  // on the spec — `options` is the domain, `value` the readback, `write` the
  // commit — which is why this is a drawing and not a feature.
  #wireDropdown(
    face: HTMLElement,
    panel: HTMLElement | null,
    spec: ToolbarSpec,
    templates: Map<string, HTMLTemplateElement>,
  ) {
    if (!panel) {
      // A template drew a choice with no items hole: it wants the face and
      // nothing else. Honour it rather than inventing a panel it did not ask for.
      this.wirePressable(face, spec)
      return
    }
    this.wirePopover(face, panel)
    const item = this.itemTemplate(panel)
    for (const option of spec.options ?? []) {
      const member = option as { value: string; label: string; icon?: string }
      // A member is not a verb of its own — it is this verb, held to one value —
      // so it is drawn as an ordinary control and wears the venue's own button
      // template for free. Its id is keyed apart from `expand`'s `base:member`
      // convention on purpose: a host drawing the base *and* its conjugated forms
      // is a real arrangement, and these must not quietly overwrite those.
      const drawn = this.control(
        {
          id: `${spec.id}::${member.value}`,
          label: member.label ?? member.value,
          ...(member.icon ? { icon: member.icon } : {}),
          kind: 'action',
          as: 'option',
          command: (state, dispatch) => {
            // Available exactly when the verb is: the parent answers for its own
            // members, and asking the same question twice invites two answers.
            if (!dispatch) return spec.command(state)
            this.commit(spec, member.value)
            // A chooser's panel has spent its purpose the moment you choose.
            panel.hidePopover?.()
            return true
          },
          // Lit when it is the one the readback answers, so the panel shows where
          // you are and not only where you may go.
          active: (state) => String(spec.value?.(state) ?? '') === member.value,
        },
        templates,
      )
      panel.append(this.wrap(item, drawn))
    }
  }

  #pressable(): HTMLButtonElement {
    const button = document.createElement('button')
    button.type = 'button'
    return button
  }

  protected wirePressable(node: HTMLElement, spec: ToolbarSpec) {
    node.addEventListener('click', () => {
      // The caret goes back first, exactly as `commit` has always done it. On a
      // strip this is a no-op — a button never took focus, so the editor still
      // has it. In a palette focus is in the query box, and a node view that
      // claims its own DOM seat during the dispatch (a spreadsheet cell) would
      // otherwise look up mid-transaction and find no focused editor.
      this.view?.focus?.()
      spec.command(this.view.state, this.view.dispatch, this.view)
    })
  }

  // A field is the collector, inlined: it shows the value the verb reads back and
  // commits what you leave in it. Escape restores, so an abandoned edit costs
  // nothing.
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
        this.commit(spec, input.value)
      } else if (event.key === 'Escape') {
        event.preventDefault()
        input.value = this.shown.get(spec.id) ?? ''
        this.view?.focus?.()
      }
      // Every other key is the field's own: the host must not see it.
      event.stopPropagation()
    })
    input.addEventListener('change', () => this.commit(spec, input.value))
  }

  #picker(_spec: ToolbarSpec): HTMLSelectElement {
    return document.createElement('select')
  }

  #wirePicker(select: HTMLSelectElement, spec: ToolbarSpec) {
    select.setAttribute('aria-label', spec.title ?? spec.label)
    // The blank stands for "no member here" — a readback may be null, and a
    // select with no matching option would otherwise show the first and lie.
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
      if (select.value) this.commit(spec, select.value)
    })
  }

  // Hand the caret back *before* running: a host that moves focus onto its own
  // components during the dispatch (a node view claiming a cell) needs to see a
  // focused editor while the transaction is applied, not one microtask later.
  protected commit(spec: ToolbarSpec, value: string) {
    if (this.shown.get(spec.id) === value) return
    const command = spec.write?.(value)
    if (!command) return
    this.shown.set(spec.id, value)
    this.view?.focus?.()
    command(this.view.state, this.view.dispatch, this.view)
  }

  /** Called by the host whenever its state changes. */
  sync() {
    this.syncControls()
    this.prune()
  }

  // Availability, lit-ness and readbacks — the half of syncing that is the same
  // whatever the surface is.
  protected syncControls() {
    const focused = this.focused()
    for (const { root, control, spec, wiring } of this.controls.values()) {
      const available = !!spec.command(this.view.state)
      ;(control as HTMLInputElement).disabled = !available
      // Dim or vanish, the host's call. Hiding is what lets one surface answer
      // several selections without carrying every group at once; dimming is what
      // keeps its width from jumping. Neither is universally right, so neither is
      // decided here. On the wrapper a container's item template put it in, when
      // there is one — a hidden control must take its `<li>` with it.
      ;(this.wrapped.get(root) ?? root).classList.toggle('gone', !available && spec.unavailable === 'hide')
      if (wiring === 'dropdown') {
        // The face wears the member the readback answers, and falls back to the
        // verb's own name and picture when it answers none.
        const shown = String(spec.value?.(this.view.state) ?? '')
        this.shown.set(spec.id, shown)
        const member = spec.options?.find((option) => option.value === shown) as
          | { value: string; label?: string; icon?: string }
          | undefined
        // A domain member may carry only its value — a plugin naming its own
        // members is taste, and plenty of them decline.
        const named = member ? (member.label ?? member.value) : null
        this.face(control, {
          label: named ?? spec.label,
          icon: member?.icon ?? spec.icon,
          title: named ? `${spec.title ?? spec.label}: ${named}` : (spec.title ?? spec.label),
        })
      } else if (spec.write) {
        const shown = String(spec.value?.(this.view.state) ?? '')
        this.shown.set(spec.id, shown)
        // Never fight the typist: a focused control keeps what is in it.
        if (focused !== control) (control as HTMLInputElement).value = shown
      } else {
        const lit = String(spec.active?.(this.view.state) ?? false)
        // `aria-pressed` for a button, `aria-checked` for a switch — the same
        // reading, in whichever word the role the template chose expects.
        control.setAttribute(control.getAttribute('role') === 'switch' ? 'aria-checked' : 'aria-pressed', lit)
      }
    }
  }

  // Availability empties things, and an empty thing should not draw. A section
  // holding nothing live goes with its contents.
  //
  // Asked of what each section drew, not of the DOM under it. Querying was right
  // only while a control *was* its own box: once a template wraps one,
  // `[data-id]:not(.gone)` finds the inner button of a hidden item — the button
  // is never the thing marked — and a section of hidden items would stay open.
  protected prune() {
    // `groups` is already innermost-first — a section is recorded after the
    // children it drew — so a section holding only empty sections goes too, in
    // one pass. A separator is not a member: it divides, it is not content.
    for (const group of this.groups) {
      const members = this.members.get(group) ?? []
      const showing = members.some(
        (node) => !node.classList.contains('separator') && !(this.wrapped.get(node) ?? node).classList.contains('gone'),
      )
      group.classList.toggle('gone', !showing)
    }
  }
}
