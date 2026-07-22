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

/** One button, or a section separator. */
export interface ToolbarSpec {
  id: string
  label: string
  title?: string
  command: ToolbarCommand
  active?: (state: any) => boolean
  keys?: string[]
}
export type ToolbarItem = ToolbarSpec | { separator: true }

/** Where to float, or null for "nothing to show". */
export type ToolbarAnchor = (view: any) => { top: number; left: number } | null

const sheet = new CSSStyleSheet()
sheet.replaceSync(`
  :host {
    position: fixed;
    display: flex;
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

  .separator {
    width: 1px;
    align-self: stretch;
    margin: 2px 3px;
    background: color-mix(in srgb, CanvasText 20%, transparent);
  }
`)

export class PmToolbar extends HTMLElement {
  #shadow: ShadowRoot
  #specs: ToolbarItem[] = []
  #buttons = new Map<string, HTMLButtonElement>()

  /** The opaque host — assigned by the driving plugin. */
  view: any = null
  /** Where to float — assigned by the driving plugin. */
  anchor: ToolbarAnchor | null = null

  constructor() {
    super()
    this.#shadow = this.attachShadow({ mode: 'open' })
    this.#shadow.adoptedStyleSheets = [sheet]

    // Never take focus. A click here must not disturb what the host has targeted —
    // without this, pressing a button destroys the very thing the command acts on.
    this.#shadow.addEventListener('mousedown', (event) => event.preventDefault())
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
    this.#buttons.clear()

    for (const spec of this.#specs) {
      if ('separator' in spec) {
        const rule = document.createElement('div')
        rule.className = 'separator'
        this.#shadow.append(rule)
        continue
      }
      const button = document.createElement('button')
      button.type = 'button'
      button.textContent = spec.label
      button.dataset.id = spec.id
      if (spec.title) button.title = spec.title
      button.addEventListener('click', () => {
        spec.command(this.view.state, this.view.dispatch, this.view)
      })
      this.#shadow.append(button)
      this.#buttons.set(spec.id, button)
    }
  }

  // Called by the host whenever its state changes.
  sync() {
    const at = this.anchor?.(this.view)
    if (!at) {
      this.hidden = true
      return
    }

    this.hidden = false
    this.style.top = `${at.top}px`
    this.style.left = `${at.left}px`

    for (const spec of this.#specs) {
      if ('separator' in spec) continue
      const button = this.#buttons.get(spec.id)
      if (!button) continue
      button.disabled = !spec.command(this.view.state)
      button.setAttribute('aria-pressed', String(spec.active?.(this.view.state) ?? false))
    }
  }
}

if (!customElements.get('pm-toolbar')) customElements.define('pm-toolbar', PmToolbar)
