// @vitest-environment happy-dom
//
// The element is editor-agnostic by design, so it is testable with a fake host:
// `state` is an opaque token it passes back to the functions it was given.

import { describe, it, expect, vi } from 'vitest'
import { PmToolbar, place, selectionAnchor, type Rect, type ToolbarItem, type ToolbarSpec } from '../src/index.js'

const STATE = { token: true }

function makeToolbar(specs: ToolbarItem[], anchor: (view: any) => Rect | null) {
  const toolbar = document.createElement('pm-toolbar') as PmToolbar
  document.body.append(toolbar)
  toolbar.view = { state: STATE, dispatch: vi.fn() }
  toolbar.anchor = anchor
  toolbar.specs = specs
  return toolbar
}

describe('<pm-toolbar>', () => {
  it('registers once, guarded', () => {
    expect(customElements.get('pm-toolbar')).toBe(PmToolbar)
  })

  it('hides on connection, before any sync', () => {
    const toolbar = document.createElement('pm-toolbar') as PmToolbar
    document.body.append(toolbar)
    expect(toolbar.hidden).toBe(true)
  })

  it('builds buttons and separators from specs', () => {
    const toolbar = makeToolbar(
      [
        { id: 'a', label: 'A', title: 'Verb A', command: () => true },
        { separator: true },
        { id: 'b', label: 'B', command: () => true },
      ],
      () => null,
    )
    const shadow = toolbar.shadowRoot!
    expect(shadow.querySelectorAll('button')).toHaveLength(2)
    expect(shadow.querySelectorAll('.separator')).toHaveLength(1)
    expect(shadow.querySelector('button')!.title).toBe('Verb A')
  })

  it('hides when the anchor answers null, and places itself against the rect otherwise', () => {
    let at: Rect | null = null
    const toolbar = makeToolbar([{ id: 'a', label: 'A', command: () => true }], () => at)
    // A headless DOM measures every box as zero, so the element is given a real
    // one: placement is a function of the size it *measures*, and a test that
    // lets it measure nothing is testing nothing.
    toolbar.getBoundingClientRect = () => ({ width: 200, height: 30 }) as DOMRect
    toolbar.sync()
    expect(toolbar.hidden).toBe(true)

    // A selection near the top-left corner. There is no room above for a 30px
    // strip, and centring a 200px one on x=80 would hang half of it off-screen.
    // Both of those used to happen; now it flips and it clamps.
    at = { top: 40, left: 80, bottom: 56, right: 80 }
    toolbar.sync()
    expect(toolbar.hidden).toBe(false)
    expect(toolbar.dataset.side).toBe('below')
    expect(toolbar.style.top).toBe('64px') // anchor.bottom + gap
    expect(toolbar.style.left).toBe('8px') // pulled back to the viewport margin
  })

  it('re-places itself on scroll and resize, and stops when it leaves the document', () => {
    // A strip pinned in viewport coordinates detaches from what it serves the
    // moment the page scrolls, and no transaction fires to tell it. Scrolling
    // and resizing are the two things that change the answer without changing
    // the state.
    //
    // What this pins is the *wiring* — listener attached, guard right, removed
    // on disconnect. That the browser emits these events on a real user scroll
    // is the platform's business, and it could not be checked from here: in the
    // harness this was verified through, a genuine programmatic scroll fires no
    // scroll event on window, document or the scrolling element. The placement
    // itself was verified live instead (above → below at the viewport's top).
    let at: Rect | null = { top: 300, left: 400, bottom: 316, right: 500 }
    const toolbar = makeToolbar([{ id: 'a', label: 'A', command: () => true }], () => at)
    toolbar.getBoundingClientRect = () => ({ width: 200, height: 30 }) as DOMRect
    toolbar.sync()
    const syncs = vi.spyOn(toolbar, 'sync')

    window.dispatchEvent(new Event('scroll'))
    window.dispatchEvent(new Event('resize'))
    expect(syncs).toHaveBeenCalledTimes(2)

    // Nothing to re-place while hidden — a scroll must not resurrect a strip
    // the anchor already dismissed.
    at = null
    toolbar.sync()
    syncs.mockClear()
    window.dispatchEvent(new Event('scroll'))
    expect(syncs).not.toHaveBeenCalled()

    // And an element the host removed stops listening to the world.
    at = { top: 300, left: 400, bottom: 316, right: 500 }
    toolbar.sync()
    toolbar.remove()
    syncs.mockClear()
    window.dispatchEvent(new Event('scroll'))
    expect(syncs).not.toHaveBeenCalled()
  })

  it('dry-runs for enabled-ness and reads active for lit-ness, with the opaque state', () => {
    const command = vi.fn((state) => state === STATE)
    const active = vi.fn((state) => state === STATE)
    const toolbar = makeToolbar([{ id: 'a', label: 'A', command, active }], () => ({ top: 0, left: 0 }))
    toolbar.sync()
    const button = toolbar.shadowRoot!.querySelector('button')!
    expect(button.disabled).toBe(false)
    expect(button.getAttribute('aria-pressed')).toBe('true')
    expect(command).toHaveBeenCalledWith(STATE)
  })

  it('runs the command with (state, dispatch, view) on click', () => {
    const command = vi.fn(() => true)
    const toolbar = makeToolbar([{ id: 'a', label: 'A', command }], () => ({ top: 0, left: 0 }))
    toolbar.shadowRoot!.querySelector('button')!.click()
    expect(command).toHaveBeenCalledWith(STATE, toolbar.view.dispatch, toolbar.view)
  })

  it('never takes focus: a mousedown on a button is prevented', () => {
    const toolbar = makeToolbar([{ id: 'a', label: 'A', command: () => true }], () => null)
    // `composed` because the guard sits on the host now, not the shadow root —
    // controls may be drawn into either, and a real mousedown is always
    // composed. The target is read from `composedPath()[0]`, since a listener
    // on the host would otherwise see everything retargeted to the host itself.
    const event = new MouseEvent('mousedown', { bubbles: true, cancelable: true, composed: true })
    toolbar.shadowRoot!.querySelector('button')!.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
  })
})

describe('<pm-toolbar> — sections', () => {
  const at = () => ({ top: 300, left: 400, bottom: 316, right: 500 })
  const button = (id: string, over: Partial<ToolbarSpec> = {}): ToolbarSpec => ({
    id,
    label: id,
    command: () => true,
    ...over,
  })

  it('draws an inline section as siblings, and separates two of them', () => {
    const toolbar = makeToolbar(
      [
        { group: 'marks', label: 'Format', items: [button('strong'), button('em')] },
        { group: 'history', label: 'History', items: [button('undo')] },
      ],
      at,
    )
    const shadow = toolbar.shadowRoot!
    expect(shadow.querySelectorAll('button')).toHaveLength(3)
    // `display: contents` keeps an inline section out of the layout, so the
    // arrangement is what the flat strip always produced.
    expect(shadow.querySelectorAll('.group[data-as="inline"]')).toHaveLength(2)
    expect(shadow.querySelectorAll('.separator')).toHaveLength(1)
  })

  it('collapses a section behind a popover when it is drawn as a menu', () => {
    const toolbar = makeToolbar(
      [{ group: 'table', label: 'Table', as: 'menu', items: [button('table:insert')] }],
      at,
    )
    const shadow = toolbar.shadowRoot!
    const panel = shadow.querySelector('[popover]')!
    const face = shadow.querySelector('.group[data-as="menu"] > button')!
    expect(panel).toBeTruthy()
    // The platform does open and close: the element writes the wiring and no
    // more. There is no click handler anywhere for this.
    expect(face.getAttribute('popovertarget')).toBe(panel.id)
    expect(face.getAttribute('aria-label')).toBe('Table')
    expect(panel.querySelectorAll('button')).toHaveLength(1)
  })

  it('takes a whole section away when nothing in it is available', () => {
    let ok = true
    const toolbar = makeToolbar(
      [
        {
          group: 'table',
          label: 'Table',
          items: [button('table:insert', { command: () => ok, unavailable: 'hide' })],
        },
        { group: 'history', label: 'History', items: [button('undo')] },
      ],
      at,
    )
    toolbar.getBoundingClientRect = () => ({ width: 100, height: 30 }) as DOMRect
    toolbar.sync()
    const group = toolbar.shadowRoot!.querySelector('[data-group="table"]')!
    expect(group.classList.contains('gone')).toBe(false)

    ok = false
    toolbar.sync()
    // The section goes with its contents, and the divider that no longer
    // divides anything goes too — separator-trimming, one altitude up.
    expect(group.classList.contains('gone')).toBe(true)
    expect(toolbar.shadowRoot!.querySelector('.separator')!.classList.contains('gone')).toBe(true)
  })
})

describe('<pm-toolbar> — templates', () => {
  const at = () => ({ top: 300, left: 400, bottom: 316, right: 500 })

  function withTemplate(html: string, specs: ToolbarItem[]) {
    const toolbar = document.createElement('pm-toolbar') as PmToolbar
    document.body.append(toolbar)
    toolbar.innerHTML = html
    toolbar.view = { state: STATE, dispatch: vi.fn(), focus: vi.fn() }
    toolbar.anchor = at
    toolbar.specs = specs
    return toolbar
  }

  it('uses a supplied template, fills its holes, and renders into light DOM', () => {
    const command = vi.fn(() => true)
    const toolbar = withTemplate(
      `<template data-as="button">
         <button type="button" class="mine"><i data-slot="icon"></i><span data-slot="label"></span></button>
       </template>`,
      [{ id: 'strong', label: 'Bold', title: 'Bold', icon: 'bold', command }],
    )
    // Light DOM, so the venue's own stylesheet reaches it with no ::part.
    const drawn = toolbar.querySelector('button.mine')!
    expect(drawn).toBeTruthy()
    expect(toolbar.shadowRoot!.querySelector('slot')).toBeTruthy()
    expect(drawn.querySelector('[data-slot="label"]')!.textContent).toBe('Bold')
    // The **name**, handed on untouched. What it draws is the stylesheet's business.
    expect(drawn.querySelector('[data-slot="icon"]')!.getAttribute('data-icon')).toBe('bold')
    // The template owns the shape; the element still owns the behaviour, which
    // is the line that keeps this from being a framework.
    ;(drawn as HTMLElement).click()
    expect(command).toHaveBeenCalledWith(STATE, toolbar.view.dispatch, toolbar.view)
  })

  it('drops the icon hole when a control has no name for one', () => {
    const toolbar = withTemplate(
      `<template data-as="button"><button type="button"><i data-slot="icon"></i><span data-slot="label"></span></button></template>`,
      [{ id: 'undo', label: 'Undo', command: () => true }],
    )
    expect(toolbar.querySelector('[data-slot="icon"]')).toBeNull()
    expect(toolbar.querySelector('[data-slot="label"]')!.textContent).toBe('Undo')
  })

  it('falls back to the kind default for an `as` nobody taught it', () => {
    // A typo costs a switch, never a control.
    const toolbar = makeToolbar(
      [{ id: 'strong', label: 'Bold', kind: 'toggle', as: 'swtich', command: () => true }],
      at,
    )
    expect(toolbar.shadowRoot!.querySelectorAll('button')).toHaveLength(1)
  })

  it('gives an icon-only control a real accessible name', () => {
    // With no text node there is no name at all unless one is written, so this
    // is load-bearing rather than a nicety the way a tooltip was.
    const toolbar = withTemplate(
      `<template data-as="button"><button type="button"><i data-slot="icon"></i></button></template>`,
      [{ id: 'strong', label: 'Bold', title: 'Bold', icon: 'bold', command: () => true }],
    )
    const drawn = toolbar.querySelector('button')!
    expect(drawn.textContent!.trim()).toBe('')
    expect(drawn.getAttribute('aria-label')).toBe('Bold')
  })
})

describe('<pm-toolbar> — fields and selects', () => {
  const at = () => ({ top: 0, left: 0 })

  function makeField(over: Partial<ToolbarItem> = {}) {
    const write = vi.fn(() => vi.fn(() => true))
    let standing = 'here'
    const toolbar = makeToolbar(
      [
        {
          id: 'f',
          kind: 'field',
          label: 'Formula',
          title: 'Formula',
          command: () => true,
          value: () => standing,
          write,
          ...over,
        } as ToolbarItem,
      ],
      at,
    )
    toolbar.view.focus = vi.fn()
    const input = toolbar.shadowRoot!.querySelector('input') as HTMLInputElement
    return { toolbar, input, write, set: (value: string) => (standing = value) }
  }

  it('draws an input wearing the label as its placeholder', () => {
    const { toolbar, input } = makeField()
    expect(input).toBeTruthy()
    expect(input.placeholder).toBe('Formula')
    expect(input.getAttribute('aria-label')).toBe('Formula')
    expect(toolbar.shadowRoot!.querySelector('button')).toBeNull()
  })

  it('shows the uncollapsed readback, and disables from the dry run', () => {
    const { toolbar, input } = makeField()
    toolbar.sync()
    expect(input.value).toBe('here')
    expect(input.disabled).toBe(false)
    toolbar.specs = [{ id: 'f', kind: 'field', label: 'F', command: () => false, value: () => 'x' }]
    toolbar.sync()
    expect((toolbar.shadowRoot!.querySelector('input') as HTMLInputElement).disabled).toBe(true)
  })

  it('commits on Enter through write, handing the caret back first', () => {
    const { toolbar, input, write } = makeField()
    toolbar.sync()
    input.value = '=SUM(A)'
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
    expect(write).toHaveBeenCalledWith('=SUM(A)')
    expect(toolbar.view.focus).toHaveBeenCalled()
  })

  it('never commits twice for one value — Enter, then the change behind it', () => {
    const { toolbar, input, write } = makeField()
    toolbar.sync()
    input.value = 'once'
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
    expect(write).toHaveBeenCalledTimes(1)
  })

  it('Escape restores what stands and abandons nothing to the document', () => {
    const { toolbar, input, write } = makeField()
    toolbar.sync()
    input.value = 'typed but unwanted'
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    expect(input.value).toBe('here')
    expect(write).not.toHaveBeenCalled()
  })

  it('never fights the typist: a focused field keeps what is in it', () => {
    const { toolbar, input, set } = makeField()
    toolbar.sync()
    input.focus()
    input.value = 'half-typ'
    set('something else entirely')
    toolbar.sync()
    expect(input.value).toBe('half-typ')
    input.blur()
    toolbar.sync()
    expect(input.value).toBe('something else entirely')
  })

  it('a control may take focus where a button may not', () => {
    const { toolbar, input } = makeField()
    const onField = new MouseEvent('mousedown', { bubbles: true, cancelable: true })
    input.dispatchEvent(onField)
    expect(onField.defaultPrevented).toBe(false)
  })

  it('stays put while engaged, though the anchor has lost sight of the editor', () => {
    let anchored: { top: number; left: number } | null = { top: 5, left: 5 }
    const toolbar = makeToolbar(
      [{ id: 'f', kind: 'field', label: 'F', command: () => true, value: () => '', write: () => () => true }],
      () => anchored,
    )
    toolbar.sync()
    expect(toolbar.hidden).toBe(false)
    const input = toolbar.shadowRoot!.querySelector('input') as HTMLInputElement
    input.focus()
    anchored = null // the editor lost focus — to this very field
    toolbar.sync()
    expect(toolbar.hidden).toBe(false)
    input.blur()
    toolbar.sync()
    expect(toolbar.hidden).toBe(true)
  })

  it('hides what the dry run refuses, when the host asked for hiding', () => {
    const toolbar = makeToolbar(
      [
        { id: 'a', label: 'A', command: () => true, unavailable: 'hide' },
        { id: 'b', label: 'B', command: () => false, unavailable: 'hide' },
        { id: 'c', label: 'C', command: () => false },
      ],
      at,
    )
    toolbar.sync()
    const gone = (id: string) => toolbar.shadowRoot!.querySelector(`[data-id='${id}']`)!.classList.contains('gone')
    expect([gone('a'), gone('b'), gone('c')]).toEqual([false, true, false])
    // 'c' asked for nothing, so it dims the way it always did.
    expect((toolbar.shadowRoot!.querySelector("[data-id='c']") as HTMLButtonElement).disabled).toBe(true)
  })

  it('a separator that no longer divides anything goes with its section', () => {
    const toolbar = makeToolbar(
      [
        { id: 'a', label: 'A', command: () => false, unavailable: 'hide' },
        { separator: true },
        { id: 'b', label: 'B', command: () => true, unavailable: 'hide' },
        { separator: true },
        { id: 'c', label: 'C', command: () => false, unavailable: 'hide' },
      ],
      at,
    )
    toolbar.sync()
    const rules = [...toolbar.shadowRoot!.querySelectorAll('.separator')]
    // 'a' hid, so the leading rule divides nothing; 'c' hid, so the trailing
    // one is orphaned too. A strip that opened with a stack of loose lines was
    // the visible form of this.
    expect(rules.map((rule) => rule.classList.contains('gone'))).toEqual([true, true])
  })

  it('draws a select with a blank standing for "no member here"', () => {
    let member: string | null = 'body'
    const toolbar = makeToolbar(
      [
        {
          id: 'r',
          kind: 'select',
          label: 'Row region',
          command: () => true,
          value: () => member,
          write: (value) => () => ((member = value as string), true),
          options: [
            { value: 'head', label: 'Header rows' },
            { value: 'body', label: 'Data rows' },
          ],
        },
      ],
      at,
    )
    toolbar.view.focus = vi.fn()
    const select = toolbar.shadowRoot!.querySelector('select') as HTMLSelectElement
    expect([...select.options].map((option) => option.value)).toEqual(['', 'head', 'body'])
    toolbar.sync()
    expect(select.value).toBe('body')
    select.value = 'head'
    select.dispatchEvent(new Event('change', { bubbles: true }))
    expect(member).toBe('head')
    // A readback with no matching member falls back to the blank, never lies.
    member = null
    toolbar.sync()
    expect(select.value).toBe('')
  })
})

describe('selectionAnchor', () => {
  const view = (over: Record<string, unknown>) =>
    ({
      state: { selection: { from: 1, to: 5, empty: false } },
      hasFocus: () => true,
      coordsAtPos: (pos: number) => ({ top: pos * 10, left: pos * 10, right: pos * 10 + 8, bottom: pos * 10 + 12 }),
      ...over,
    }) as any

  it('answers the rect the selection occupies, not a point', () => {
    // Both edges, because placement needs both: the top to sit above, the
    // bottom to flip below when there is no room. A multi-line selection's
    // rect is the union of its ends — the strip belongs over the selection,
    // not over its last line.
    expect(selectionAnchor(view({}))).toEqual({ top: 10, bottom: 62, left: 10, right: 58 })
  })

  it('answers null for an empty selection or an unfocused editor', () => {
    expect(selectionAnchor(view({ state: { selection: { from: 1, to: 1, empty: true } } }))).toBeNull()
    expect(selectionAnchor(view({ hasFocus: () => false }))).toBeNull()
  })
})

describe('place — the geometry, alone', () => {
  const size = { width: 200, height: 30 }
  const viewport = { width: 1000, height: 600 }
  const at = (rect: Rect) => place(rect, size, { viewport })

  it('sits above and centred when there is room', () => {
    // Chrome that covers what you just selected is chrome you have to move.
    expect(at({ top: 300, bottom: 316, left: 400, right: 600 })).toEqual({
      top: 300 - 30 - 8,
      left: 500 - 100,
      side: 'above',
    })
  })

  it('flips below when there is no room above', () => {
    const spot = at({ top: 20, bottom: 36, left: 400, right: 600 })
    expect(spot.side).toBe('below')
    expect(spot.top).toBe(36 + 8)
  })

  it('pulls itself back inside the viewport at either edge', () => {
    // The bug this replaces: a selection near the left margin put half the
    // strip off-screen, first buttons unreachable.
    expect(at({ top: 300, bottom: 316, left: 5, right: 20 }).left).toBe(8)
    expect(at({ top: 300, bottom: 316, left: 980, right: 995 }).left).toBe(1000 - 200 - 8)
  })

  it('takes the roomier side when neither fits, rather than hanging off one', () => {
    const tall = { width: 200, height: 500 }
    // 40px above, 44px below in a 600px viewport: below wins, and the result is
    // clamped rather than being allowed to run past the edge.
    const spot = place({ top: 40, bottom: 556, left: 400, right: 600 }, tall, { viewport })
    expect(spot.side).toBe('below')
    expect(spot.top).toBe(600 - 500 - 8)
  })

  it('takes a preferred side, and still flips when that side has no room', () => {
    // A strip over a selection wants above; a menu hanging off its own button
    // wants below. One rule, told which way to lean.
    const below = place({ top: 300, bottom: 316, left: 400, right: 600 }, size, { viewport, prefer: 'below' })
    expect(below).toEqual({ top: 316 + 8, left: 500 - 100, side: 'below' })
    // No room below: it goes above, exactly as the default does in reverse.
    const cramped = place({ top: 550, bottom: 580, left: 400, right: 600 }, size, { viewport, prefer: 'below' })
    expect(cramped.side).toBe('above')
  })

  it('treats a point anchor as a zero-size rect, so an older anchor still works', () => {
    expect(place({ top: 300, left: 500 }, size, { viewport })).toEqual({
      top: 300 - 30 - 8,
      left: 500 - 100,
      side: 'above',
    })
  })

  it('prefers the near edge when the thing is wider than the room it has', () => {
    expect(place({ top: 300, left: 500 }, { width: 5000, height: 30 }, { viewport }).left).toBe(8)
  })
})
