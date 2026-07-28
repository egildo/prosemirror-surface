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

  it('floats at the top-centre of the selection', () => {
    expect(selectionAnchor(view({}))).toEqual({ top: 10, left: (10 + 58) / 2 })
  })

  it('answers null for an empty selection or an unfocused editor', () => {
    expect(selectionAnchor(view({ state: { selection: { from: 1, to: 1, empty: true } } }))).toBeNull()
    expect(selectionAnchor(view({ hasFocus: () => false }))).toBeNull()
  })
})
