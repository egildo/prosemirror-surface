// A command palette: the same registry, laid out as a list you search, walk and
// descend into.
//
// It draws through `PmSurface` exactly as the strip does — same templates, same
// holes, same wiring — and what it adds is the behaviour a list has and a strip
// does not. All of that behaviour is **here, in code, under test**, and that is
// the point of the element existing rather than living in a venue.
//
// ## Why this owns Escape
//
// A palette redefines a key. Escape in a dialog means *close*; in a palette with
// a page open it means *back* — and no user agent can know that. The first cut
// of this leaned on the platform: pages were nested popovers, whose close
// watcher pops the innermost one. It reads beautifully and it was the wrong
// call, for three reasons that only showed up in the field:
//
//   * **Nothing owned it.** No code, no test — and a single `stopPropagation()`
//     on a keydown, anywhere in an ancestor, removes back-navigation silently.
//     That happened, in this package's own venue, and went unnoticed.
//   * **It could not be checked.** The close watcher is unobservable in a
//     headless DOM, and the browser harness this was built through delivers no
//     keydown events at all. "Back works, trust me" is not a capability.
//   * **It could not be layered.** Adding our own handler on top needs
//     `preventDefault()` on the keydown to suppress the close request, and
//     neither the HTML spec's text nor MDN says it does. Own it or trust it —
//     there is no safe both.
//
// So: pages are ordinary elements and the stack is a field. The **host** is
// still a popover (`manual`), because the top layer, `::backdrop` and
// `:popover-open` are worth having and cost nothing. What we give up is light
// dismiss, which is the `#outside` listener below — about ten lines, and now a
// thing with a test rather than a thing we hope about.

import { PmSurface, controlSheet } from './pm-surface.js'
import type { ToolbarGroup, ToolbarSpec } from './pm-surface.js'

/** Does this row's text answer this query? The default is the browser's own
 *  idea of a match — case-insensitive substring — and a host that wants fuzzy,
 *  or scoring, or initials, replaces it. Both arguments arrive lowercased. */
export type Matcher = (text: string, query: string) => boolean

const substring: Matcher = (text, query) => text.includes(query)

let rowSeq = 0

const paletteSheet = new CSSStyleSheet()
paletteSheet.replaceSync(`
  /* Closed is the default, and it is said here rather than left to the popover:
     this element tracks its own open state (see the file header), so the CSS
     has to key on something this element controls. */
  :host { display: none; }
  :host([data-open]) {
    display: block;
    position: fixed;
    inset: 12vh 0 auto;
    margin-inline: auto;
    width: min(92vw, 640px);
    max-height: 66vh;
    overflow: hidden;
    z-index: 40;
    border-radius: 12px;
    border: 1px solid color-mix(in srgb, CanvasText 18%, transparent);
    background: Canvas;
    color: CanvasText;
    box-shadow: 0 24px 60px rgb(0 0 0 / 0.32);
  }
  :host::backdrop { background: rgb(0 0 0 / 0.28); }

  .query {
    box-sizing: border-box;
    width: 100%;
    height: 52px;
    padding: 14px 16px;
    border: 0;
    border-bottom: 1px solid color-mix(in srgb, CanvasText 12%, transparent);
    background: transparent;
    color: inherit;
    font: inherit;
    font-size: 16px;
  }
  .query:focus { outline: none; }

  .list { overflow: auto; max-height: calc(66vh - 52px); padding: 6px; }

  /* Where the arrow keys are. Not \`:focus\` — the caret never leaves the query
     box, which is the combobox pattern and the reason typing keeps working. */
  [data-at] { background: color-mix(in srgb, AccentColor 22%, transparent); }

  /* A page, while browsing: an overlay covering the list it replaces. */
  [data-page] { position: absolute; inset: 0; z-index: 1; overflow: auto; background: Canvas; }
  /* A page, while a query is live: no longer a place you are in, just where
     some of these rows came from — so it flows into the list instead. */
  [data-page][data-flat] { position: static; inset: auto; z-index: auto; background: none; }

  /* The path a flattened row was lifted out of. \`order\` puts a \`::before\`
     *after* the label, because \`::after\` is already spoken for by whatever the
     host publishes there — and two pseudo-elements is all there is. */
  [data-row][data-path]::before {
    content: attr(data-path);
    order: 1;
    margin-left: auto;
    padding-left: 12px;
    opacity: 0.55;
    font-size: 0.85em;
  }
  :host(:not([data-query])) [data-row]::before { content: none; }
`)

export class PmPalette extends PmSurface {
  /** Replaceable: how a query decides what stays. */
  matcher: Matcher = substring

  #query: HTMLInputElement
  #list: HTMLElement | null = null
  // The pages you have descended through, innermost last. A field, not a DOM
  // state machine — which is what makes back-navigation testable.
  #stack: HTMLElement[] = []
  #pages = new Map<HTMLElement, HTMLElement>() // face → panel
  // A panel and the words on the face that opens it. Kept as written rather
  // than as the lowercased text the face matches on, because this is what a
  // flattened row shows as the path it came from.
  #titles = new WeakMap<HTMLElement, string>() // panel → label
  #at: HTMLElement | null = null
  #open = false

  constructor() {
    super()
    this.shadow.adoptedStyleSheets = [controlSheet, paletteSheet]

    // Made once and re-seated on every build: `PmSurface.build` clears whatever
    // it did not draw, and a fresh input would lose these listeners.
    this.#query = document.createElement('input')
    this.#query.type = 'text'
    this.#query.className = 'query'
    this.#query.autocomplete = 'off'
    this.#query.setAttribute('role', 'combobox')
    this.#query.setAttribute('aria-autocomplete', 'list')
    this.#query.setAttribute('aria-expanded', 'false')
    this.#query.addEventListener('input', () => {
      this.refine()
      this.#place(1)
    })

    this.addEventListener('keydown', this.#onKey)
    this.addEventListener('click', this.#onClick)
  }

  connectedCallback() {
    // `manual`: the top layer and the backdrop are worth having; light dismiss
    // and Escape are ours, because a palette means something different by both.
    if (!this.hasAttribute('popover')) this.setAttribute('popover', 'manual')
    document.addEventListener('pointerdown', this.#outside, true)
  }

  disconnectedCallback() {
    document.removeEventListener('pointerdown', this.#outside, true)
  }

  /** What the query box says. Placeholder and accessible name are the host's. */
  get query(): HTMLInputElement {
    return this.#query
  }

  get open(): boolean {
    return this.#open
  }

  show() {
    if (this.#open) return
    this.#open = true
    this.dataset.open = ''
    // Optional on purpose: the state above is the truth, so a DOM without
    // popover support still opens, still filters, still navigates.
    try {
      this.showPopover?.()
    } catch {
      /* already open, or unsupported */
    }
    this.reset()
    this.#query.focus()
    this.#query.setAttribute('aria-expanded', 'true')
  }

  hide() {
    if (!this.#open) return
    this.#open = false
    delete this.dataset.open
    try {
      this.hidePopover?.()
    } catch {
      /* already closed, or unsupported */
    }
    this.#query.setAttribute('aria-expanded', 'false')
    this.#query.removeAttribute('aria-activedescendant')
    this.#mark(null)
    this.view?.focus?.()
  }

  toggle() {
    this.#open ? this.hide() : this.show()
  }

  /** Back to the first page, empty query, nothing highlighted. */
  reset() {
    this.#query.value = ''
    while (this.#stack.length) this.pop()
    this.refine()
    this.#mark(null)
  }

  /** Descend into a page. */
  push(panel: HTMLElement) {
    this.#stack.push(panel)
    show(panel, true)
    this.refine()
    this.#place(1)
  }

  /** Back one page. Answers false when there was nowhere to go, which is what
   *  tells Escape to close instead. */
  pop(): boolean {
    const panel = this.#stack.pop()
    if (!panel) return false
    show(panel, false)
    this.refine()
    this.#place(1)
    return true
  }

  /** How deep you are. */
  get depth(): number {
    return this.#stack.length
  }

  // ── The list ───────────────────────────────────────────────────────────────

  /** A palette lays its sections out as headings, so nothing divides them. */
  protected override divider(): HTMLElement | null {
    return null
  }

  /** A section a strip would collapse behind a face is a **page** here. `menu`
   *  and a `popover` panel still count, so a venue that names its sections for
   *  the strip gets pages without renaming anything. */
  protected override collapses(as: string, hole: HTMLElement | null): boolean {
    return as === 'page' || super.collapses(as, hole)
  }

  /** A palette's half of the seam: a collapsed section is a page you push. */
  protected override collapse(face: HTMLElement, panel: HTMLElement, group: ToolbarGroup) {
    // A page that arrived from a strip's template may say `popover`; it is not
    // one here, and leaving the attribute on would let the UA hide it out from
    // under us.
    panel.removeAttribute('popover')
    panel.dataset.page = ''
    panel.setAttribute('role', 'listbox')
    show(panel, false)
    this.#pages.set(face, panel)
    this.#titles.set(panel, group.label ?? '')
    face.dataset.descend = ''
    // A page is a row with a name on it, so it answers a query by that name as
    // well as by what is inside it. Without this, typing the word written on
    // the face was the one way to *lose* the page it names.
    face.dataset.search = (group.label ?? '').toLowerCase()
    face.setAttribute('aria-haspopup', 'listbox')
    face.addEventListener('click', () => this.push(panel))
  }

  protected override build() {
    // Cleared **before**, not after: `collapse` is called from inside
    // `super.build()`, so a tidy-up afterwards wipes the very pages it just
    // registered — and every page face silently stops being a row.
    this.#stack = []
    this.#pages.clear()
    this.#at = null
    super.build()

    // Everything drawn goes inside one listbox, so the combobox above it has
    // something true to point `aria-controls` at.
    const list = document.createElement('div')
    list.className = 'list'
    list.id = list.id || `pm-list-${(rowSeq += 1)}`
    list.setAttribute('role', 'listbox')
    for (const child of [...this.target.childNodes]) {
      if (child instanceof HTMLTemplateElement) continue
      if (child === this.#query) continue
      list.append(child)
    }
    this.target.append(this.#query, list)
    this.#list = list
    this.#query.setAttribute('aria-controls', list.id)

    // Every row this palette can walk: the controls, and the faces you descend
    // through — which are rows too, because arrowing onto one and pressing Enter
    // is how you get into a page.
    for (const { control } of this.controls.values()) this.#row(control)
    for (const face of this.#pages.keys()) this.#row(face)
    this.refine()
  }

  #row(node: HTMLElement) {
    node.dataset.row = ''
    node.setAttribute('role', 'option')
    if (!node.id) node.id = `pm-row-${(rowSeq += 1)}`
    // Where this row lives, for when a query lifts it out of there. A row on the
    // first page has no path and gets no attribute, so a stylesheet drawing
    // `attr(data-path)` draws nothing rather than an empty box.
    const path = this.#pathTo(node)
    if (path) node.dataset.path = path
    else delete node.dataset.path
  }

  /** The names of the pages this row sits inside, outermost first. */
  #pathTo(node: HTMLElement): string {
    const names: string[] = []
    for (
      let panel = node.parentElement?.closest<HTMLElement>('[data-page]') ?? null;
      panel;
      panel = panel.parentElement?.closest<HTMLElement>('[data-page]') ?? null
    ) {
      const name = this.#titles.get(panel)
      if (name) names.unshift(name)
    }
    return names.join(this.separator)
  }

  /** What comes between the names in a flattened row's path. Yours to change —
   *  it is punctuation, which is nobody's business but the host's. */
  separator = ' › '

  /** What a query is matched against. A host that stamped `search` on the spec
   *  decides; otherwise it is the words, which is what makes a palette work with
   *  no host cooperation at all. */
  protected searchText(spec: ToolbarSpec): string {
    if (spec.search) return spec.search.toLowerCase()
    const keywords = (spec as { keywords?: string[] }).keywords ?? []
    return [spec.label, spec.title, ...keywords].filter(Boolean).join(' ').toLowerCase()
  }

  /** Apply the query. **The element decides what is visible, CSS draws it** —
   *  because navigation and `aria-activedescendant` both have to know what is
   *  reachable, and reading that back out of layout is both slow and wrong the
   *  moment a venue hides something its own way. */
  protected refine() {
    const query = this.#query.value.trim().toLowerCase()
    // Published, not consumed: a stylesheet needs to know a query is live, so
    // that a flattened page can drop the overlay it only wears while browsing.
    this.toggleAttribute('data-query', !!query)
    // **`data-off` is why the query needs its own mark.** A closed page is
    // hidden, so every row inside one *looks* hidden — and asking "is anything
    // in here still showing" would answer no for every page you are not
    // standing on, which hid them all the moment you typed. What a query
    // excluded and what is merely off-screen are two different facts.
    for (const { root, spec } of this.controls.values()) {
      const hit = !query || this.matcher(this.searchText(spec), query)
      mark(this.wrapped.get(root) ?? root, hit)
    }
    // A page's face belongs to a *section*, and a section carries no words of
    // its own — so a page answers the query through its contents. Without this,
    // "Table" sat there answering a search for "bold".
    //
    // **Innermost first.** Pages are registered outermost-first, because a
    // section is collapsed before its children are drawn — so in that order a
    // parent is asked while its own sub-faces are still unmarked, and any page
    // with pages inside it survives every query. Reversed, a child settles
    // before the parent that has to count it.
    for (const [face, panel] of [...this.#pages].reverse()) {
      const named = !!query && this.matcher(face.dataset.search ?? '', query)
      const inside = [...panel.querySelectorAll<HTMLElement>('[data-row]')].some(live)
      // **A query flattens; the hierarchy is for browsing.** A page that merely
      // *contains* matches gives way to what it contains — otherwise the palette
      // shows a road and never its destination, and you must guess a branch and
      // descend to find out whether you guessed right. A page that matches by
      // its own **name** is a different thing: it stays one row you can enter,
      // because showing its face *and* everything inside it is the same list
      // twice.
      const flat = !!query && !named && inside
      mark(this.wrapped.get(face) ?? face, !query || named)
      panel.toggleAttribute('data-flat', flat)
      // Flattened, or on the stack — the two reasons a panel is on screen.
      show(panel, flat || this.#stack.includes(panel))
    }
    // And a heading with nothing left under it goes too. **Hidden, not marked**:
    // `data-off` is read by walking up from a row, so putting one on a section
    // makes its own children look excluded — and then a section emptied by one
    // query could never come back for the next, because every row inside it
    // answered to the mark still sitting overhead.
    for (const group of this.groups) {
      const rows = [...group.querySelectorAll<HTMLElement>('[data-row]')]
      if (!rows.length) continue
      show(group, rows.some(live))
    }
  }

  /** The rows you can reach right now: on the open page, not filtered out, not
   *  refused by the dry run. Public because it is the honest answer to "what
   *  would the arrows do", and a host testing its own palette deserves it. */
  reachableRows(): HTMLElement[] {
    const page = this.#stack.at(-1) ?? null
    const flattening = !!this.#query.value.trim()
    return [...(this.#list ?? this.target).querySelectorAll<HTMLElement>('[data-row]')].filter((row) => {
      if ((row as HTMLButtonElement).disabled) return false
      if (hidden(row)) return false
      // **Browsing asks which page you are on; a query asks which subtree.** So
      // while one is live a row counts if the page you stand on *contains* it,
      // however deep — which is what puts a match two levels down in front of
      // you instead of the road to it. Rows inside a page that only matched by
      // name are still excluded, because that panel stayed closed and `hidden`
      // has already answered for them.
      if (flattening) return page ? page.contains(row) : true
      // Browsing: the *nearest* page ancestor, so nested pages answer for their
      // own rows — and a page's face answers to the page it sits in, not the
      // one it opens.
      return (row.closest('[data-page]') as HTMLElement | null) === page
    })
  }

  /** Move the highlight. Wraps at both ends; skips everything unreachable. */
  move(step: number) {
    const rows = this.reachableRows()
    if (!rows.length) return this.#mark(null)
    const at = this.#at ? rows.indexOf(this.#at) : -1
    const next = at < 0 ? (step > 0 ? 0 : rows.length - 1) : (at + step + rows.length) % rows.length
    this.#mark(rows[next]!)
  }

  #place(step: number) {
    // Keep the highlight if it survived the change; otherwise start again.
    if (this.#at && this.reachableRows().includes(this.#at)) return
    this.#at = null
    this.move(step)
  }

  #mark(row: HTMLElement | null) {
    if (this.#at) delete this.#at.dataset.at
    this.#at = row
    if (!row) {
      this.#query.removeAttribute('aria-activedescendant')
      return
    }
    row.dataset.at = ''
    this.#query.setAttribute('aria-activedescendant', row.id)
    row.scrollIntoView?.({ block: 'nearest' })
  }

  /** The highlighted row, if any. */
  get at(): HTMLElement | null {
    return this.#at
  }

  /** Do what the highlight is on: descend into a page, or run and close.
   *
   *  A click, not a second path. Enter used to close the palette itself, which
   *  meant *using a row with the mouse behaved differently from using it with
   *  the keyboard* — the command ran and the palette stayed open over the
   *  document, so the change was invisible and the whole thing read as dead.
   *  One behaviour now: whatever a row does when clicked, it does here too. */
  activate() {
    const row = this.#at ?? this.reachableRows()[0]
    row?.click()
  }

  // A row was used — by pointer or by `activate`. The command has already run
  // (its own listener sits on the row and fires first); what is left is whether
  // we are done. Descending is not done: you asked for the next page.
  #onClick = (event: Event) => {
    if (!this.#open) return
    const row = event.composedPath().find(
      (node): node is HTMLElement => node instanceof HTMLElement && node.dataset.row !== undefined,
    )
    if (!row || row.dataset.descend !== undefined) return
    this.hide()
  }

  // ── The keys ───────────────────────────────────────────────────────────────

  #onKey = (event: KeyboardEvent) => {
    if (!this.#open) return
    switch (event.key) {
      case 'Escape':
        // **Back, then close.** The whole reason this element exists rather than
        // a venue's fifty lines.
        event.preventDefault()
        event.stopPropagation()
        if (!this.pop()) this.hide()
        return
      case 'ArrowDown':
        event.preventDefault()
        event.stopPropagation()
        this.move(1)
        return
      case 'ArrowUp':
        event.preventDefault()
        event.stopPropagation()
        this.move(-1)
        return
      case 'Home':
      case 'End': {
        const rows = this.reachableRows()
        if (!rows.length) return
        event.preventDefault()
        event.stopPropagation()
        this.#mark(event.key === 'Home' ? rows[0]! : rows[rows.length - 1]!)
        return
      }
      case 'Enter':
        event.preventDefault()
        event.stopPropagation()
        this.activate()
        return
      default:
        // Everything else is typing. Deliberately **not** stopped: swallowing
        // every key at this level is exactly how back-navigation was lost once
        // already, and nothing of ours needs the protection.
        return
    }
  }

  #outside = (event: Event) => {
    if (!this.#open) return
    if (event.composedPath().includes(this)) return
    this.hide()
  }

  override sync() {
    super.sync()
    // Availability may have taken the highlighted row away.
    if (this.#open) {
      this.refine()
      this.#place(1)
    }
  }
}

// Shown or hidden, decisively. `hidden` says what it means to a screen reader;
// the inline display is what actually wins, because an author rule in a venue's
// stylesheet beats the UA's `[hidden]` — which is the same lesson a "collapsed"
// popover taught this package when it sat open forever under one `display: flex`.
function show(el: HTMLElement, on: boolean) {
  el.hidden = !on
  el.style.display = on ? '' : 'none'
}

// Excluded *by the query*, which is a different fact from being off-screen.
function mark(el: HTMLElement, on: boolean) {
  el.toggleAttribute('data-off', !on)
  show(el, on)
}

/** Not excluded by the query — said of a row, or of anything it sits in. */
const live = (el: HTMLElement): boolean => !el.closest('[data-off]')

/** Not on screen at all: filtered out, refused by the dry run, or on a page you
 *  are not standing on. */
const hidden = (el: HTMLElement): boolean => !!el.closest('[hidden], .gone')

if (!customElements.get('pm-palette')) customElements.define('pm-palette', PmPalette)
