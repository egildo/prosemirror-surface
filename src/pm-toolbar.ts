// A floating command bar that knows nothing about the editor it serves.
//
// Everything about *drawing* a registry — templates, holes, wiring, publishing,
// availability — is `PmSurface`, which this shares with `PmPalette`. What is
// here is what makes a surface a **strip**:
//
//   anchor      — (view) => a rect to float near, or null for "nothing to show".
//   placement   — floating by the selection, or docked in the document's flow.
//   separators  — the rules between sections, and the trimming of orphans.
//   collapse    — a section behind one face is a **popover** beside that face.
//
// That last line is this file's half of the seam. The base decides a section is
// collapsed; a strip opens it next to its button, and a palette pushes it as a
// page. Same tree, same templates, two navigations.

import { place } from './place.js'
import type { Rect } from './place.js'
import { PmSurface, controlSheet } from './pm-surface.js'
import type { ToolbarGroup } from './pm-surface.js'

export type {
  ToolbarRun,
  ToolbarSpec,
  ToolbarGroup,
  ToolbarItem,
} from './pm-surface.js'

/** What to float near, or null for "nothing to show".
 *
 *  A **rect** in viewport coordinates. A point still works — `bottom` and
 *  `right` default to `top` and `left`, a zero-size rect — so an anchor written
 *  against the older contract keeps working and simply gains the clamping. */
export type ToolbarAnchor = (view: any) => Rect | null

const stripSheet = new CSSStyleSheet()
stripSheet.replaceSync(`
  :host {
    position: fixed;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    /* Controls are wider than glyphs, so a mixed strip can outgrow the viewport.
       It wraps rather than overflowing — a second row of chrome is a smaller
       cost than a button nobody can reach. */
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
       box's real corner, and clamping them clamps the wrong number. */
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

  .separator {
    width: 1px;
    align-self: stretch;
    margin: 2px 3px;
    background: color-mix(in srgb, CanvasText 20%, transparent);
  }

  /* An inline section is an arrangement, not a box: display:contents lifts its
     children into the strip's own flex line, so nesting costs no layout. */
  .group[data-as='inline'] { display: contents; }

  /* A section collapsed behind its face. */
  .group[data-as='menu'] { position: relative; display: inline-flex; }

  /* Docked, an unbounded field has the whole bar to grow into. */
  :host([data-placement='docked']) input[data-room='unbounded'] { flex: 1; width: auto; min-width: 12ch; }
`)

export class PmToolbar extends PmSurface {
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
    this.shadow.adoptedStyleSheets = [controlSheet, stripSheet]
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

  /** A strip's half of the seam: a collapsed section opens beside its face. */
  protected override collapse(face: HTMLElement, panel: HTMLElement, _group: ToolbarGroup) {
    this.wirePopover(face, panel)
  }

  override sync() {
    // A control that holds focus holds it *from* the host — whose anchor then
    // sees an unfocused editor and says "nothing to show". Staying put is the
    // truthful answer: the selection the strip serves has not gone anywhere.
    const engaged = !!this.focused()
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
    super.sync()
  }

  protected override prune() {
    super.prune()
    this.#trimSeparators(this.target)
    for (const group of this.groups) this.#trimSeparators(group)
  }

  // Measure, then decide, then apply. The measuring has to happen while the
  // element is visible — a hidden box has no size — which is why `sync` unhides
  // first; there is no flash, because layout is computed synchronously here and
  // paint happens after this task.
  //
  // `side` rides out as an attribute rather than being consumed here: which way
  // a strip ended up flipping is exactly the sort of thing a stylesheet wants (a
  // pointer arrow that must swap ends), and drawing one is not our business.
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
  // that change the answer without changing the state. Capture, because scroll
  // does not bubble from an inner scroller.
  #follow = () => {
    if (this.view && !this.hidden) this.sync()
  }

  // A separator divides two sections; with hiding in play a whole section can
  // vanish and leave its rule behind, so the strip opens with a stack of orphaned
  // lines. Which separators still divide anything is the element's own business —
  // it is the only thing that knows what is currently drawn — unlike *what to
  // hide*, which is the host's.
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
