// @vitest-environment happy-dom
//
// The element is editor-agnostic by design, so it is testable with a fake host:
// `state` is an opaque token it hands to the projection it was given, and
// everything it does goes out through the one door, `run`.

import { describe, it, expect, vi } from 'vitest'
import { PmToolbar, place, selectionAnchor, type Rect, type ToolbarItem, type ToolbarSpec } from '../src/index.js'

const STATE = { token: true }

function makeToolbar(specs: ToolbarItem[], anchor: (view: any) => Rect | null) {
  const toolbar = document.createElement('pm-toolbar') as PmToolbar
  document.body.append(toolbar)
  toolbar.view = { state: STATE, dispatch: vi.fn() }
  toolbar.run = vi.fn()
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

  it('builds buttons from specs, and a separator between two sections', () => {
    const toolbar = makeToolbar(
      [
        { id: 'one', items: [{ id: 'a', label: 'A', title: 'Verb A' }] },
        { id: 'two', items: [{ id: 'b', label: 'B' }] },
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
    const toolbar = makeToolbar([{ id: 'a', label: 'A' }], () => at)
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
    const toolbar = makeToolbar([{ id: 'a', label: 'A' }], () => at)
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

  it('re-projects for enabled-ness and lit-ness, with the opaque state', () => {
    const project = vi.fn((state: unknown): ToolbarItem[] => [
      { id: 'a', label: 'A', enabled: state === STATE, pressed: state === STATE },
    ])
    const toolbar = makeToolbar([{ id: 'a', label: 'A' }], () => ({ top: 0, left: 0 }))
    toolbar.project = project
    toolbar.sync()
    const button = toolbar.shadowRoot!.querySelector('button')!
    expect(button.disabled).toBe(false)
    expect(button.getAttribute('aria-pressed')).toBe('true')
    expect(project).toHaveBeenCalledWith(STATE)
  })

  it('runs through the door with (id, no args, view) on click', () => {
    const toolbar = makeToolbar([{ id: 'a', label: 'A' }], () => ({ top: 0, left: 0 }))
    toolbar.shadowRoot!.querySelector('button')!.click()
    expect(toolbar.run).toHaveBeenCalledWith('a', undefined, toolbar.view)
  })

  it('lights a value drawn as a button while it holds a value', () => {
    let value: unknown = null
    // Shown (an anchor with a rect), or the strip hides before it syncs its controls.
    const toolbar = makeToolbar([{ id: 'link', kind: 'value', as: 'button', label: 'Link' }], () => ({ top: 100, left: 100, bottom: 110, right: 160 }))
    toolbar.getBoundingClientRect = () => ({ width: 60, height: 28 }) as DOMRect
    toolbar.project = () => [{ id: 'link', kind: 'value', as: 'button', label: 'Link', ...(value != null ? { value } : {}) }]
    toolbar.sync()
    const button = toolbar.shadowRoot!.querySelector('button')!
    expect(button.getAttribute('aria-pressed')).toBe('false')
    value = 'https://example.org'
    toolbar.sync()
    expect(button.getAttribute('aria-pressed')).toBe('true')
    value = ''
    toolbar.sync()
    expect(button.getAttribute('aria-pressed')).toBe('false')
  })

  it('is the outlet: a command fired at it summons the verb it names, through the door', () => {
    const toolbar = makeToolbar([{ id: 'a', label: 'A' }], () => null)
    toolbar.view.focus = vi.fn()
    // What the platform fires at the element a `<button command="--a" commandfor>`
    // names, shaped as a CommandEvent is; a headless DOM has no invokers of its own.
    const summon = (command: string) => {
      const event = new Event('command')
      Object.defineProperty(event, 'command', { value: command })
      toolbar.dispatchEvent(event)
    }
    summon('--a')
    expect(toolbar.run).toHaveBeenCalledWith('a', undefined, toolbar.view)
    // An id this element never drew still goes through the door: a page's own
    // button may summon any verb the host holds.
    summon('--elsewhere')
    expect(toolbar.run).toHaveBeenLastCalledWith('elsewhere', undefined, toolbar.view)
    expect(toolbar.view.focus).toHaveBeenCalledTimes(2)
    // The platform's own commands are not verbs.
    summon('show-popover')
    expect(toolbar.run).toHaveBeenCalledTimes(2)
  })

  it('hands the caret back before running, so a node view finds a focused editor', () => {
    // A no-op on a strip, where the button never took focus. Load-bearing in a
    // palette, where focus is in the query box when the verb runs.
    const order: string[] = []
    const toolbar = makeToolbar([{ id: 'a', label: 'A' }], () => null)
    toolbar.run = () => void order.push('run')
    toolbar.view.focus = () => order.push('focus')
    toolbar.shadowRoot!.querySelector('button')!.click()
    expect(order).toEqual(['focus', 'run'])
  })

  it('publishes what it does not consume, so CSS can reach it', () => {
    // Publish, don't hole. The projection carries a host's own attributes to
    // the spec; this carries them to the DOM, where `content: attr(data-chord)`
    // draws an accessory and `[data-search]` filters — with no sixth hole and
    // no idea here what a chord or a query is.
    const toolbar = makeToolbar(
      [{ id: 'a', label: 'A', enabled: true, chord: '⇧⌘P', search: 'a bullet list', weight: 3, onPick: () => 1 }],
      () => null,
    )
    const button = toolbar.shadowRoot!.querySelector<HTMLElement>('button')!
    expect(button.dataset.chord).toBe('⇧⌘P')
    expect(button.dataset.search).toBe('a bullet list')
    expect(button.dataset.weight).toBe('3')
    // Behaviour is not something to hand to CSS.
    expect(button.dataset.onPick).toBeUndefined()
    // And nothing this element reads for itself leaks out as an attribute.
    expect(button.dataset.enabled).toBeUndefined()
    expect(button.dataset.label).toBeUndefined()
  })

  it('never takes focus: a mousedown on a button is prevented', () => {
    const toolbar = makeToolbar([{ id: 'a', label: 'A' }], () => null)
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
    ...over,
  })

  it('draws an inline section as siblings, and separates two of them', () => {
    const toolbar = makeToolbar(
      [
        { id: 'marks', label: 'Format', items: [button('strong'), button('em')] },
        { id: 'history', label: 'History', items: [button('undo')] },
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
      [{ id: 'table', label: 'Table', as: 'menu', items: [button('table:insert')] }],
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

  it('leaves a closed menu closed — the display belongs to :popover-open', () => {
    // Found by eye, in the field: "it is always open though". The UA hides a
    // closed popover with `display: none`, and *any* author rule saying
    // `display: flex` on the panel beats it — author beats UA whatever the
    // specificity — so the collapsed section sat open from the moment it drew.
    const toolbar = makeToolbar(
      [{ id: 'table', label: 'Table', as: 'menu', items: [button('table:insert')] }],
      at,
    )
    //
    // Asserted on the sheet rather than on computed style: this DOM does not
    // implement the UA popover rules, so a computed `display` here would prove
    // nothing about a browser. The invariant is the one that was broken —
    // **no rule gives a popover a `display` except one that requires it open.**
    const panel = toolbar.shadowRoot!.querySelector<HTMLElement>('[popover]')!
    expect(panel.matches(':popover-open')).toBe(false)

    const rules = [...toolbar.shadowRoot!.adoptedStyleSheets[0]!.cssRules] as CSSStyleRule[]
    const popoverRules = rules.filter((rule) => rule.selectorText?.includes('[popover]'))
    expect(popoverRules.length).toBeGreaterThan(0)
    for (const rule of popoverRules) {
      if (rule.style.display) expect(rule.selectorText).toContain(':popover-open')
    }
    expect(popoverRules.some((rule) => rule.selectorText.includes(':popover-open') && rule.style.display)).toBe(true)
  })

  it('takes a whole section away when nothing in it is available', () => {
    let ok = true
    const tree = (): ToolbarItem[] => [
      { id: 'table', label: 'Table', items: [button('table:insert', { enabled: ok })] },
      { id: 'history', label: 'History', items: [button('undo')] },
    ]
    const toolbar = makeToolbar(tree(), at)
    toolbar.project = tree
    toolbar.unavailable = 'hide'
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
    toolbar.run = vi.fn()
    toolbar.anchor = at
    toolbar.specs = specs
    return toolbar
  }

  it('uses a supplied template, fills its holes, and renders into light DOM', () => {
    const toolbar = withTemplate(
      `<template data-as="button">
         <button type="button" class="mine"><i data-slot="icon"></i><span data-slot="label"></span></button>
       </template>`,
      [{ id: 'strong', label: 'Bold', title: 'Bold', icon: 'bold' }],
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
    expect(toolbar.run).toHaveBeenCalledWith('strong', undefined, toolbar.view)
  })

  it('drops the icon hole when a control has no name for one', () => {
    const toolbar = withTemplate(
      `<template data-as="button"><button type="button"><i data-slot="icon"></i><span data-slot="label"></span></button></template>`,
      [{ id: 'undo', label: 'Undo' }],
    )
    expect(toolbar.querySelector('[data-slot="icon"]')).toBeNull()
    expect(toolbar.querySelector('[data-slot="label"]')!.textContent).toBe('Undo')
  })

  it('falls back to the kind default for an `as` nobody taught it', () => {
    // A typo costs a switch, never a control.
    const toolbar = makeToolbar(
      [{ id: 'strong', label: 'Bold', kind: 'toggle', as: 'swtich' }],
      at,
    )
    expect(toolbar.shadowRoot!.querySelectorAll('button')).toHaveLength(1)
  })

  it('wires from the kind, not the word: a choice a template drew as anything else', () => {
    // The half of the open vocabulary that used to be missing. `as` is any word
    // a venue likes; only `kind` decides behaviour. Drawn as a plain button,
    // this used to reach the select wiring — `<option>`s appended into a
    // button, a `change` listener that could never fire, no error anywhere.
    const toolbar = withTemplate(
      `<template data-as="chip"><button type="button" class="chip"><span data-slot="label"></span></button></template>`,
      [
        {
          id: 'blocktype',
          label: 'Block type',
          kind: 'choice',
          as: 'chip',
          value: 'h1',
          args: [
            {
              name: 'blocktype',
              domain: [
                { value: 'paragraph', label: 'Paragraph' },
                { value: 'h1', label: 'Heading 1' },
              ],
            },
          ],
        },
      ],
    )
    const drawn = toolbar.querySelector('button.chip')!
    expect(drawn.querySelectorAll('option')).toHaveLength(0)
    // No items hole in this template: it asked for a face and nothing else, so
    // it gets the face's own behaviour rather than an invented panel.
    expect(toolbar.querySelector('[popover]')).toBeNull()
  })

  it('wraps each control in the container’s own item template', () => {
    // A `<ul>` may hold only `<li>`, and that is the container's rule — so the
    // container answers it once, instead of every verb inside claiming to be a
    // list item and drifting from the section that required it.
    let ok = true
    const tree = (): ToolbarItem[] => [
      {
        id: 'lists',
        label: 'Lists',
        as: 'menu',
        items: [
          { id: 'bullet_list', label: 'Bulleted', enabled: ok },
          { id: 'ordered_list', label: 'Numbered', enabled: ok },
        ],
      },
    ]
    const toolbar = withTemplate(
      `<template data-as="button"><button type="button" class="ctl"><span data-slot="label"></span></button></template>
       <template data-as="menu">
         <span class="grp">
           <button type="button" data-slot="face"></button>
           <ul popover data-slot="items"><template data-slot="item"><li role="none"></li></template></ul>
         </span>
       </template>`,
      tree(),
    )
    toolbar.project = tree
    toolbar.unavailable = 'hide'
    const list = toolbar.querySelector('ul')!
    expect(list.querySelectorAll(':scope > li')).toHaveLength(2)
    expect(list.querySelector('li > button.ctl')).toBeTruthy()

    toolbar.getBoundingClientRect = () => ({ width: 100, height: 30 }) as DOMRect
    toolbar.sync()
    const item = list.querySelector('li')!
    const control = item.querySelector('button')!
    expect(item.classList.contains('gone')).toBe(false)

    ok = false
    toolbar.sync()
    // The wrapper hides, the control disables — the whole contract in two
    // assertions. A bullet left behind for something that is not there would be
    // the visible cost of getting this wrong.
    expect(item.classList.contains('gone')).toBe(true)
    expect(control.disabled).toBe(true)
    expect(control.classList.contains('gone')).toBe(false)
    // And the section goes with its contents, which the old collapse could not
    // see: it asked the DOM, and the DOM still held an unmarked button.
    expect(toolbar.querySelector('.grp')!.classList.contains('gone')).toBe(true)
  })

  it('collapses a section the venue named itself, because its panel says popover', () => {
    // The open vocabulary, one altitude up. A venue wanting a second kind of
    // section — a column of words beside a row of icons — should not have to
    // call it `menu` to get the behaviour its markup plainly declared.
    const toolbar = withTemplate(
      `<template data-as="listing">
         <span class="grp"><button type="button" data-slot="face"></button><ul popover data-slot="items"></ul></span>
       </template>`,
      [
        {
          id: 'lists',
          label: 'Lists',
          as: 'listing',
          items: [{ id: 'bullet_list', label: 'Bulleted' }],
        },
      ],
    )
    const panel = toolbar.querySelector('ul')!
    expect(toolbar.querySelector('[data-slot="face"]')!.getAttribute('popovertarget')).toBe(panel.id)
    expect(panel.querySelectorAll('button')).toHaveLength(1)
  })

  it('makes a supplied items hole a popover, though the template forgot to', () => {
    // `popovertarget` pointing at an ordinary element is silent: the button
    // does nothing, and nothing anywhere says why.
    const toolbar = withTemplate(
      `<template data-as="menu">
         <span class="grp"><button type="button" data-slot="face"></button><ul data-slot="items"></ul></span>
       </template>`,
      [{ id: 'lists', label: 'Lists', as: 'menu', items: [{ id: 'bullet_list', label: 'Bulleted' }] }],
    )
    const panel = toolbar.querySelector('ul')!
    const face = toolbar.querySelector('[data-slot="face"]')!
    expect(panel.hasAttribute('popover')).toBe(true)
    expect(face.getAttribute('popovertarget')).toBe(panel.id)
    expect(face.getAttribute('aria-expanded')).toBe('false')
  })

  it('gives an icon-only control a real accessible name', () => {
    // With no text node there is no name at all unless one is written, so this
    // is load-bearing rather than a nicety the way a tooltip was.
    const toolbar = withTemplate(
      `<template data-as="button"><button type="button"><i data-slot="icon"></i></button></template>`,
      [{ id: 'strong', label: 'Bold', title: 'Bold', icon: 'bold' }],
    )
    const drawn = toolbar.querySelector('button')!
    expect(drawn.textContent!.trim()).toBe('')
    expect(drawn.getAttribute('aria-label')).toBe('Bold')
  })
})

describe('<pm-toolbar> — fields and selects', () => {
  const at = () => ({ top: 0, left: 0 })

  function makeField(over: Partial<ToolbarSpec> = {}) {
    let standing = 'here'
    let enabled = true
    const tree = (): ToolbarItem[] => [
      {
        id: 'f',
        kind: 'value',
        label: 'Formula',
        title: 'Formula',
        args: [{ name: 'formula' }],
        value: standing,
        enabled,
        ...over,
      },
    ]
    const toolbar = makeToolbar(tree(), at)
    toolbar.project = tree
    toolbar.view.focus = vi.fn()
    const input = toolbar.shadowRoot!.querySelector('input') as HTMLInputElement
    return {
      toolbar,
      input,
      run: toolbar.run!,
      set: (value: string) => (standing = value),
      refuse: () => (enabled = false),
    }
  }

  it('draws an input wearing the label as its placeholder', () => {
    const { toolbar, input } = makeField()
    expect(input).toBeTruthy()
    expect(input.placeholder).toBe('Formula')
    expect(input.getAttribute('aria-label')).toBe('Formula')
    expect(toolbar.shadowRoot!.querySelector('button')).toBeNull()
  })

  it('shows the uncollapsed readback, and disables when the projection withholds it', () => {
    const { toolbar, input, refuse } = makeField()
    toolbar.sync()
    expect(input.value).toBe('here')
    expect(input.disabled).toBe(false)
    refuse()
    toolbar.sync()
    expect((toolbar.shadowRoot!.querySelector('input') as HTMLInputElement).disabled).toBe(true)
  })

  it('commits on Enter through the door, handing the caret back first', () => {
    const { toolbar, input, run } = makeField()
    toolbar.sync()
    input.value = '=SUM(A)'
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
    expect(run).toHaveBeenCalledWith('f', { formula: '=SUM(A)' }, toolbar.view)
    expect(toolbar.view.focus).toHaveBeenCalled()
  })

  it('sends no value for an emptied field, and lets the verb say what absence means', () => {
    // A link emptied of its address is no link; an empty string would only be
    // refused at the door as a malformed URL.
    const { toolbar, input, run } = makeField()
    toolbar.sync()
    input.value = '  '
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
    expect(run).toHaveBeenCalledWith('f', {}, toolbar.view)
  })

  it('never commits twice for one value — Enter, then the change behind it', () => {
    const { toolbar, input, run } = makeField()
    toolbar.sync()
    input.value = 'once'
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('Escape restores what stands and abandons nothing to the document', () => {
    const { toolbar, input, run } = makeField()
    toolbar.sync()
    input.value = 'typed but unwanted'
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    expect(input.value).toBe('here')
    expect(run).not.toHaveBeenCalled()
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
    const { input } = makeField()
    const onField = new MouseEvent('mousedown', { bubbles: true, cancelable: true })
    input.dispatchEvent(onField)
    expect(onField.defaultPrevented).toBe(false)
  })

  it('stays put while engaged, though the anchor has lost sight of the editor', () => {
    let anchored: { top: number; left: number } | null = { top: 5, left: 5 }
    const toolbar = makeToolbar(
      [{ id: 'f', kind: 'value', label: 'F', value: '', args: [{ name: 'f' }] }],
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

  it('hides what the projection withholds, when the host asked for hiding', () => {
    const toolbar = makeToolbar(
      [
        { id: 'a', label: 'A' },
        { id: 'b', label: 'B', enabled: false },
      ],
      at,
    )
    const gone = (id: string) => toolbar.shadowRoot!.querySelector(`[data-id='${id}']`)!.classList.contains('gone')
    toolbar.sync()
    // Asked for nothing, so it dims the way it always did.
    expect([gone('a'), gone('b')]).toEqual([false, false])
    expect((toolbar.shadowRoot!.querySelector("[data-id='b']") as HTMLButtonElement).disabled).toBe(true)
    toolbar.unavailable = 'hide'
    toolbar.sync()
    expect([gone('a'), gone('b')]).toEqual([false, true])
  })

  it('a separator that no longer divides anything goes with its section', () => {
    const toolbar = makeToolbar(
      [
        { id: 'one', items: [{ id: 'a', label: 'A', enabled: false }] },
        { id: 'two', items: [{ id: 'b', label: 'B' }] },
        { id: 'three', items: [{ id: 'c', label: 'C', enabled: false }] },
      ],
      at,
    )
    toolbar.unavailable = 'hide'
    toolbar.sync()
    const rules = [...toolbar.shadowRoot!.querySelectorAll('.separator')]
    // 'a' hid, so the leading rule divides nothing; 'c' hid, so the trailing
    // one is orphaned too. A strip that opened with a stack of loose lines was
    // the visible form of this.
    expect(rules.map((rule) => rule.classList.contains('gone'))).toEqual([true, true])
  })

  it('draws a select with a blank standing for "no member here"', () => {
    let member: string | null = 'body'
    const tree = (): ToolbarItem[] => [
      {
        id: 'r',
        kind: 'choice',
        label: 'Row region',
        value: member,
        args: [
          {
            name: 'region',
            domain: [
              { value: 'head', label: 'Header rows' },
              { value: 'body', label: 'Data rows' },
            ],
          },
        ],
      },
    ]
    const toolbar = makeToolbar(tree(), at)
    toolbar.project = tree
    toolbar.run = (_id, args) => void (member = args?.region as string)
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

describe('<pm-toolbar> — a choice drawn as a dropdown', () => {
  const at = () => ({ top: 0, left: 0 })

  function makeDropdown(value = 'h1') {
    const toolbar = makeToolbar(
      [
        {
          id: 'blocktype',
          label: 'Block type',
          title: 'Block type',
          kind: 'choice',
          as: 'dropdown',
          icon: 'blocktype',
          value,
          args: [
            {
              name: 'blocktype',
              domain: [
                { value: 'paragraph', label: 'Paragraph', icon: 'paragraph' },
                { value: 'h1', label: 'Heading 1', icon: 'heading-1' },
              ],
            },
          ],
        },
      ],
      at,
    )
    toolbar.getBoundingClientRect = () => ({ width: 100, height: 30 }) as DOMRect
    return { toolbar, run: toolbar.run! }
  }

  it('draws a face and one pressable per member of the domain', () => {
    const { toolbar } = makeDropdown()
    const shadow = toolbar.shadowRoot!
    const panel = shadow.querySelector('[popover]')!
    // Nothing new was declared: the argument's `domain` was already there, and
    // this is the same declaration simply not flattened into a native select.
    expect(shadow.querySelectorAll('select')).toHaveLength(0)
    expect(panel.querySelectorAll('button')).toHaveLength(2)
    expect(shadow.querySelector('[data-as="dropdown"] > button')!.getAttribute('popovertarget')).toBe(panel.id)
  })

  it('wears the member the readback answers, and says both halves aloud', () => {
    const { toolbar } = makeDropdown('h1')
    toolbar.sync()
    const face = toolbar.shadowRoot!.querySelector('[data-as="dropdown"] > button')!
    expect(face.textContent).toBe('Heading 1')
    expect(face.getAttribute('aria-label')).toBe('Block type: Heading 1')
  })

  it('wears a member that carries only its value', () => {
    // Found in the field, not here: prosemirror-spreads declares its region
    // domain as `[{ value: 'head' }, …]` — naming your own members is taste, and
    // plenty of plugins decline. The face read "Row region: undefined".
    const toolbar = makeToolbar(
      [
        {
          id: 'table:row-region',
          label: 'Row region',
          kind: 'choice',
          as: 'dropdown',
          value: 'body',
          args: [{ name: 'region', domain: [{ value: 'head' }, { value: 'body' }, { value: 'foot' }] }],
        },
      ],
      at,
    )
    toolbar.getBoundingClientRect = () => ({ width: 100, height: 30 }) as DOMRect
    toolbar.sync()
    const face = toolbar.shadowRoot!.querySelector('[data-as="dropdown"] > button')!
    expect(face.textContent).toBe('body')
    expect(face.getAttribute('aria-label')).toBe('Row region: body')
  })

  it('falls back to the verb’s own name when the readback answers no member', () => {
    // The select's blank, said the other way: a chooser showing a member it is
    // not on would be lying.
    const { toolbar } = makeDropdown('')
    toolbar.sync()
    expect(toolbar.shadowRoot!.querySelector('[data-as="dropdown"] > button')!.textContent).toBe('Block type')
  })

  it('commits the member you pick, and lights the one you are on', () => {
    const { toolbar, run } = makeDropdown('h1')
    toolbar.sync()
    const [paragraph, heading] = [...toolbar.shadowRoot!.querySelectorAll<HTMLElement>('[popover] button')]
    expect(heading!.getAttribute('aria-pressed')).toBe('true')
    expect(paragraph!.getAttribute('aria-pressed')).toBe('false')

    paragraph!.click()
    expect(run).toHaveBeenCalledWith('blocktype', { blocktype: 'paragraph' }, toolbar.view)
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
