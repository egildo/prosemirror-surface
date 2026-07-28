// A floating command bar that knows nothing about the editor it serves.
//
// It is handed three things:
//   view    — an opaque host. Only `.state` and `.dispatch` are ever touched.
//   specs   — [{ id, label, title?, command, active? } | { separator: true }]
//   anchor  — (view) => { top, left } | null.  null means "nothing to show".
//
// `state` is a token: it is passed to functions this element was given, and
// never inspected. Nothing here knows what a command is, only that calling one
// without a dispatch asks a question and calling it with one answers it. The
// types say the same thing: `any` below is the honest type of "not mine to
// know" — a spec produced by prosemirror-verbs' toolbarSpecs fits structurally,
// and so does anything else of this shape. No package joins these two; a shape does.

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
  /** How to draw it. Absent means a button — the shape this element began with. */
  kind?: 'button' | 'field' | 'select'
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
export type ToolbarItem = ToolbarSpec | { separator: true }

/** Where to float, or null for "nothing to show". */
export type ToolbarAnchor = (view: any) => { top: number; left: number } | null

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
    /* The host is placed at the top-centre of the target; CSS lifts it clear. */
    transform: translate(-50%, calc(-100% - 8px));
  }

  /* [hidden] is display:none in the UA sheet, which :host's display would win against. */
  :host([hidden]) { display: none; }

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
`)

const isControl = (node: EventTarget | null): boolean =>
  node instanceof HTMLElement && (node.tagName === 'INPUT' || node.tagName === 'SELECT')

export class PmToolbar extends HTMLElement {
  #shadow: ShadowRoot
  #specs: ToolbarItem[] = []
  #controls = new Map<string, HTMLElement>()
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

    // Never take focus — *unless* the thing pressed is a field or a select,
    // which cannot be typed into from a distance. The original law protected
    // the host's target from a button press; a control keeps that protection
    // a different way: the host's selection is state, not focus, and it
    // survives the blur. Commits hand the caret back before they run.
    this.#shadow.addEventListener('mousedown', (event) => {
      if (isControl(event.target)) return
      event.preventDefault()
    })
  }

  // Not the constructor: `createElement` runs it synchronously and then throws
  // NotSupportedError if the element gained an attribute, handing back a dead
  // HTMLUnknownElement instead of propagating. Hiding starts here.
  connectedCallback() {
    this.hidden = true
  }

  set specs(value: ToolbarItem[] | null | undefined) {
    this.#specs = value ?? []
    this.#build()
  }

  get specs(): ToolbarItem[] {
    return this.#specs
  }

  #build() {
    this.#shadow.replaceChildren()
    this.#controls.clear()
    this.#shown.clear()

    for (const spec of this.#specs) {
      if ('separator' in spec) {
        const rule = document.createElement('div')
        rule.className = 'separator'
        this.#shadow.append(rule)
        continue
      }
      const control =
        spec.kind === 'field' ? this.#field(spec) : spec.kind === 'select' ? this.#select(spec) : this.#button(spec)
      control.dataset.id = spec.id
      if (spec.title) control.title = spec.title
      this.#shadow.append(control)
      this.#controls.set(spec.id, control)
    }
  }

  #button(spec: ToolbarSpec): HTMLButtonElement {
    const button = document.createElement('button')
    button.type = 'button'
    button.textContent = spec.label
    button.addEventListener('click', () => {
      spec.command(this.view.state, this.view.dispatch, this.view)
    })
    return button
  }

  // A field is the collector, inlined: it shows the value the verb reads back
  // and commits what you leave in it. Escape restores, so an abandoned edit
  // costs nothing.
  #field(spec: ToolbarSpec): HTMLInputElement {
    const input = document.createElement('input')
    input.type = spec.type === 'number' ? 'number' : 'text'
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
    return input
  }

  #select(spec: ToolbarSpec): HTMLSelectElement {
    const select = document.createElement('select')
    select.setAttribute('aria-label', spec.title ?? spec.label)
    // The blank stands for "no member here" — a readback may be null, and a
    // select with no matching option would otherwise show the first one and lie.
    const blank = document.createElement('option')
    blank.value = ''
    blank.textContent = '—'
    select.append(blank)
    for (const option of spec.options ?? []) {
      const el = document.createElement('option')
      el.value = option.value
      el.textContent = option.label
      select.append(el)
    }
    select.addEventListener('change', () => {
      if (select.value) this.#commit(spec, select.value)
    })
    return select
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
    const engaged = !!this.#shadow.activeElement
    const at = this.anchor?.(this.view)
    if (!at && !engaged) {
      this.hidden = true
      return
    }
    if (at) {
      this.hidden = false
      // A docked bar takes its position from the document, not from us; the
      // anchor's answer still decides whether it is there at all.
      if (this.placement === 'anchored') {
        this.style.top = `${at.top}px`
        this.style.left = `${at.left}px`
      }
    }

    for (const spec of this.#specs) {
      if ('separator' in spec) continue
      const control = this.#controls.get(spec.id)
      if (!control) continue
      const available = !!spec.command(this.view.state)
      ;(control as HTMLInputElement).disabled = !available
      // Dim or vanish, the host's call. Hiding is what lets one strip serve
      // several selections without carrying every group at once; dimming is
      // what keeps its width from jumping as the caret moves. Neither is
      // universally right, so neither is decided here.
      control.classList.toggle('gone', !available && spec.unavailable === 'hide')
      if (spec.kind === 'field' || spec.kind === 'select') {
        const shown = String(spec.value?.(this.view.state) ?? '')
        this.#shown.set(spec.id, shown)
        // Never fight the typist: a focused control keeps what is in it.
        if (this.#shadow.activeElement !== control) (control as HTMLInputElement).value = shown
      } else {
        control.setAttribute('aria-pressed', String(spec.active?.(this.view.state) ?? false))
      }
    }
    this.#trimSeparators()
  }

  // A separator divides two sections; with hiding in play a whole section can
  // vanish and leave its rule behind, so the strip opens with a stack of
  // orphaned lines. Which separators still divide anything is the element's own
  // business — it is the only thing that knows what is currently drawn — unlike
  // *what to hide*, which is the host's.
  #trimSeparators() {
    let lastKept: Element | null = null
    let sinceKept = 0
    for (const el of this.#shadow.children) {
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
