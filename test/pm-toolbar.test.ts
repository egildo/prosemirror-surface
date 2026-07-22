// @vitest-environment happy-dom
//
// The element is editor-agnostic by design, so it is testable with a fake host:
// `state` is an opaque token it passes back to the functions it was given.

import { describe, it, expect, vi } from 'vitest'
import { PmToolbar, selectionAnchor, type ToolbarItem } from '../src/index.js'

const STATE = { token: true }

function makeToolbar(specs: ToolbarItem[], anchor: (view: any) => { top: number; left: number } | null) {
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

  it('hides when the anchor answers null, floats where it points otherwise', () => {
    let at: { top: number; left: number } | null = null
    const toolbar = makeToolbar([{ id: 'a', label: 'A', command: () => true }], () => at)
    toolbar.sync()
    expect(toolbar.hidden).toBe(true)
    at = { top: 40, left: 80 }
    toolbar.sync()
    expect(toolbar.hidden).toBe(false)
    expect(toolbar.style.top).toBe('40px')
    expect(toolbar.style.left).toBe('80px')
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

  it('never takes focus: mousedown in the shadow is prevented', () => {
    const toolbar = makeToolbar([{ id: 'a', label: 'A', command: () => true }], () => null)
    const event = new MouseEvent('mousedown', { bubbles: true, cancelable: true })
    toolbar.shadowRoot!.querySelector('button')!.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
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

  it('floats at the top-centre of the selection', () => {
    expect(selectionAnchor(view({}))).toEqual({ top: 10, left: (10 + 58) / 2 })
  })

  it('answers null for an empty selection or an unfocused editor', () => {
    expect(selectionAnchor(view({ state: { selection: { from: 1, to: 1, empty: true } } }))).toBeNull()
    expect(selectionAnchor(view({ hasFocus: () => false }))).toBeNull()
  })
})
