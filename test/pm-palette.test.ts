// @vitest-environment happy-dom
//
// Every behaviour here was unreachable before the palette became an element.
// While pages were nested popovers and the venue held the keys, back-navigation
// depended on a close watcher this DOM does not implement, and on keydown events
// the browser harness does not deliver — so *back* had no test at all, and lost
// itself once to a stray `stopPropagation()` without anything noticing.
//
// That is the whole argument for the class, and this file is the argument's
// evidence: the stack is a field, the keys are handlers, and both answer to a
// synthetic event.

import { describe, it, expect, vi } from 'vitest'
import { PmPalette, type ToolbarItem } from '../src/index.js'

const STATE = { token: true }

function makePalette(specs: ToolbarItem[], templates = '') {
  const palette = document.createElement('pm-palette') as PmPalette
  if (templates) palette.insertAdjacentHTML('afterbegin', templates)
  document.body.append(palette)
  palette.view = { state: STATE, dispatch: vi.fn(), focus: vi.fn() }
  palette.run = vi.fn()
  palette.specs = specs
  return palette
}

const key = (palette: PmPalette, k: string) =>
  palette.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }))

const labels = (rows: HTMLElement[]) => rows.map((row) => row.textContent?.trim())

// With no templates a surface draws into its shadow root; with templates, into
// its own light DOM. Both are the element's own output, so a test looks in
// whichever one it used.
const find = (palette: PmPalette, selector: string) =>
  palette.querySelector<HTMLElement>(selector) ?? palette.shadowRoot!.querySelector<HTMLElement>(selector)

// A flat list plus one section you descend into — the shape the venue draws.
const SPECS: ToolbarItem[] = [
  {
    id: 'marks',
    label: 'Format',
    as: 'inline',
    items: [
      { id: 'strong', label: 'Bold' },
      { id: 'em', label: 'Italic' },
    ],
  },
  {
    id: 'table',
    label: 'Table',
    as: 'page',
    items: [
      { id: 'row-add', label: 'Add row' },
      { id: 'row-del', label: 'Delete row' },
    ],
  },
]

describe('<pm-palette> — opening and closing', () => {
  it('registers, and starts closed', () => {
    expect(customElements.get('pm-palette')).toBe(PmPalette)
    expect(makePalette(SPECS).open).toBe(false)
  })

  it('opens, focuses the query, and says so to a screen reader', () => {
    const palette = makePalette(SPECS)
    palette.show()
    expect(palette.open).toBe(true)
    expect(palette.dataset.open).toBe('')
    expect(palette.query.getAttribute('aria-expanded')).toBe('true')
    // `aria-controls` points at a real listbox rather than at nothing.
    const list = find(palette, `#${palette.query.getAttribute('aria-controls')}`)
    expect(list?.getAttribute('role')).toBe('listbox')
  })

  it('closes on a pointerdown outside, and not on one inside', () => {
    const palette = makePalette(SPECS)
    palette.show()
    palette.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, composed: true }))
    expect(palette.open).toBe(true)
    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, composed: true }))
    expect(palette.open).toBe(false)
  })

  it('hands the caret back when it closes', () => {
    const palette = makePalette(SPECS)
    palette.show()
    palette.hide()
    expect(palette.view.focus).toHaveBeenCalled()
  })
})

describe('<pm-palette> — Escape means back, then close', () => {
  it('pops one page and leaves the palette open', () => {
    const palette = makePalette(SPECS)
    palette.show()
    const face = find(palette, '[data-descend]')!
    face.click()
    expect(palette.depth).toBe(1)

    key(palette, 'Escape')
    expect(palette.depth).toBe(0)
    // The whole point: still open. A dialog's Escape would have closed it.
    expect(palette.open).toBe(true)
  })

  it('closes only once there is nowhere left to go back to', () => {
    const palette = makePalette(SPECS)
    palette.show()
    key(palette, 'Escape')
    expect(palette.open).toBe(false)
  })

  it('cancels the event, so nothing above it also acts on the key', () => {
    const palette = makePalette(SPECS)
    palette.show()
    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    palette.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
  })

  it('lets an ordinary keystroke through — the mistake that cost back-navigation once', () => {
    // A blanket `stopPropagation` on this handler is what silently removed
    // Escape the first time around. Typing must reach nothing of ours, and be
    // stopped by nothing of ours.
    const palette = makePalette(SPECS)
    palette.show()
    const event = new KeyboardEvent('keydown', { key: 'a', bubbles: true, cancelable: true })
    palette.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(false)
  })

  it('ignores keys while closed', () => {
    const palette = makePalette(SPECS)
    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    palette.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(false)
  })
})

describe('<pm-palette> — walking the list', () => {
  it('moves with the arrows and wraps at both ends', () => {
    const palette = makePalette(SPECS)
    palette.show()
    const rows = labels(palette.reachableRows())
    expect(rows).toEqual(['Bold', 'Italic', 'Table'])

    key(palette, 'ArrowDown')
    expect(palette.at?.textContent?.trim()).toBe('Bold')
    key(palette, 'ArrowDown')
    expect(palette.at?.textContent?.trim()).toBe('Italic')
    key(palette, 'ArrowUp')
    expect(palette.at?.textContent?.trim()).toBe('Bold')
    // Up from the first wraps to the last.
    key(palette, 'ArrowUp')
    expect(palette.at?.textContent?.trim()).toBe('Table')
    key(palette, 'ArrowDown')
    expect(palette.at?.textContent?.trim()).toBe('Bold')
  })

  it('Home and End go to the ends', () => {
    const palette = makePalette(SPECS)
    palette.show()
    key(palette, 'End')
    expect(palette.at?.textContent?.trim()).toBe('Table')
    key(palette, 'Home')
    expect(palette.at?.textContent?.trim()).toBe('Bold')
  })

  it('skips what the projection withheld', () => {
    const palette = makePalette([
      { id: 'a', label: 'A' },
      { id: 'b', label: 'B', enabled: false },
      { id: 'c', label: 'C' },
    ])
    palette.show()
    palette.sync()
    expect(labels(palette.reachableRows())).toEqual(['A', 'C'])
  })

  it('tracks the highlight in aria-activedescendant, and clears it on close', () => {
    const palette = makePalette(SPECS)
    palette.show()
    key(palette, 'ArrowDown')
    expect(palette.query.getAttribute('aria-activedescendant')).toBe(palette.at!.id)
    expect(palette.at!.getAttribute('role')).toBe('option')
    palette.hide()
    expect(palette.query.getAttribute('aria-activedescendant')).toBeNull()
  })

  it('only walks the page you are on', () => {
    const palette = makePalette(SPECS)
    palette.show()
    find(palette, '[data-descend]')!.click()
    expect(labels(palette.reachableRows())).toEqual(['Add row', 'Delete row'])
    palette.pop()
    expect(labels(palette.reachableRows())).toEqual(['Bold', 'Italic', 'Table'])
  })
})

describe('<pm-palette> — pages inside pages', () => {
  // Depth is what a palette is *for*: a strip cannot nest at all, and a flat
  // list of forty commands is the problem pages solve. Nothing in the element
  // counts levels — the stack is a stack — so this is the pin that says so.
  const DEEP: ToolbarItem[] = [
    { id: 'top', label: 'Top' },
    {
      id: 'insert',
      label: 'Insert',
      as: 'page',
      items: [
        { id: 'figure', label: 'Figure' },
        {
          id: 'insert/media',
          label: 'Media',
          as: 'page',
          items: [
            { id: 'image', label: 'Image' },
            { id: 'video', label: 'Video' },
          ],
        },
      ],
    },
  ]

  const into = (palette: PmPalette, label: string) => {
    const face = palette
      .reachableRows()
      .find((row) => row.textContent?.trim() === label)
    face!.click()
  }

  it('descends twice and comes back one level at a time', () => {
    const palette = makePalette(DEEP)
    palette.show()
    expect(labels(palette.reachableRows())).toEqual(['Top', 'Insert'])

    into(palette, 'Insert')
    expect(palette.depth).toBe(1)
    expect(labels(palette.reachableRows())).toEqual(['Figure', 'Media'])

    into(palette, 'Media')
    expect(palette.depth).toBe(2)
    expect(labels(palette.reachableRows())).toEqual(['Image', 'Video'])

    // One level per Escape, all the way out — and only then does it close.
    key(palette, 'Escape')
    expect(palette.depth).toBe(1)
    expect(labels(palette.reachableRows())).toEqual(['Figure', 'Media'])
    key(palette, 'Escape')
    expect(palette.depth).toBe(0)
    expect(palette.open).toBe(true)
    key(palette, 'Escape')
    expect(palette.open).toBe(false)
  })

  it('lifts a match two levels down straight in front of you, with its path', () => {
    // **A query flattens.** The hierarchy is for browsing when you do not know
    // the name; a query is for jumping when you do — so it shows the
    // destination, not the road. This used to answer `['Insert']` and ask you
    // to guess which branch you meant.
    const palette = makePalette(DEEP)
    palette.show()
    palette.query.value = 'video'
    palette.query.dispatchEvent(new Event('input'))
    expect(labels(palette.reachableRows())).toEqual(['Video'])
    expect(palette.reachableRows()[0]!.dataset.path).toBe('Insert › Media')
    // Running it needs no descent at all.
    expect(palette.at?.textContent?.trim()).toBe('Video')
  })

  it('scopes the query to the page you are standing on', () => {
    // Egildo's ruling: at the top a query searches everything, and inside a
    // page it searches only that page. Descending stays meaningful, and Escape
    // never has to choose between clearing a query and going back.
    const palette = makePalette(DEEP)
    palette.show()
    into(palette, 'Insert')
    palette.query.value = 'top' // the one row that is *not* under Insert
    palette.query.dispatchEvent(new Event('input'))
    expect(labels(palette.reachableRows())).toEqual([])
    palette.pop()
    expect(labels(palette.reachableRows())).toEqual(['Top'])
  })

  it('gives way to its contents, unless it matched by its own name', () => {
    const palette = makePalette(DEEP)
    palette.show()
    const type = (text: string) => {
      palette.query.value = text
      palette.query.dispatchEvent(new Event('input'))
    }
    // "media" names a page *and* nothing inside it: one row, still enterable.
    type('media')
    expect(labels(palette.reachableRows())).toEqual(['Media'])
    expect(palette.reachableRows()[0]!.dataset.descend).toBe('')
    // "image" is inside it: the page gives way rather than showing both.
    type('image')
    expect(labels(palette.reachableRows())).toEqual(['Image'])
  })

  it('puts the hierarchy back when the query is cleared', () => {
    const palette = makePalette(DEEP)
    palette.show()
    palette.query.value = 'video'
    palette.query.dispatchEvent(new Event('input'))
    expect(palette.hasAttribute('data-query')).toBe(true)
    palette.query.value = ''
    palette.query.dispatchEvent(new Event('input'))
    expect(palette.hasAttribute('data-query')).toBe(false)
    expect(labels(palette.reachableRows())).toEqual(['Top', 'Insert'])
  })

  it('drops a whole branch whose only candidates were its own sub-pages', () => {
    // The subtle one. A page is kept when anything under it matches — and a
    // page's sub-*faces* are rows too, so a parent asked before its children
    // have settled counts them as matches and survives every query. Pages are
    // registered outermost-first, so the marking has to run the other way.
    const TWO: ToolbarItem[] = [
      {
        id: 'format',
        label: 'Format',
        as: 'page',
        items: [{ id: 'format/script', label: 'Script', as: 'page', items: [{ id: 'sup', label: 'Superscript' }] }],
      },
      {
        id: 'insert',
        label: 'Insert',
        as: 'page',
        items: [{ id: 'insert/blocks', label: 'Blocks', as: 'page', items: [{ id: 'adm', label: 'Admonition' }] }],
      },
    ]
    const palette = makePalette(TWO)
    palette.show()
    expect(labels(palette.reachableRows())).toEqual(['Format', 'Insert'])
    palette.query.value = 'admon'
    palette.query.dispatchEvent(new Event('input'))
    // The match itself, lifted out of two pages; the whole Format branch gone.
    expect(labels(palette.reachableRows())).toEqual(['Admonition'])
    expect(palette.reachableRows()[0]!.dataset.path).toBe('Insert › Blocks')
  })

  it('opens on the first page however deep it was left', () => {
    const palette = makePalette(DEEP)
    palette.show()
    into(palette, 'Insert')
    into(palette, 'Media')
    palette.hide()
    palette.show()
    expect(palette.depth).toBe(0)
    expect(labels(palette.reachableRows())).toEqual(['Top', 'Insert'])
  })
})

describe('<pm-palette> — Enter', () => {
  it('descends into a page rather than closing', () => {
    const palette = makePalette(SPECS)
    palette.show()
    key(palette, 'End') // the Table face
    key(palette, 'Enter')
    expect(palette.depth).toBe(1)
    expect(palette.open).toBe(true)
  })

  it('runs the highlighted row and closes', () => {
    const palette = makePalette([{ id: 'strong', label: 'Bold' }])
    palette.show()
    key(palette, 'ArrowDown')
    key(palette, 'Enter')
    expect(palette.run).toHaveBeenCalledWith('strong', undefined, palette.view)
    expect(palette.open).toBe(false)
  })

  it('closes when a row is clicked, exactly as when it is entered', () => {
    // The mouse used to take a different path from the keyboard: Enter closed
    // the palette, a click ran the command and left it standing over the
    // document — so the change was invisible and the row read as dead. Found in
    // the field, on the first click anyone tried.
    const palette = makePalette([{ id: 'strong', label: 'Bold' }])
    palette.show()
    find(palette, '[data-row]')!.click()
    expect(palette.run).toHaveBeenCalledWith('strong', undefined, palette.view)
    expect(palette.open).toBe(false)
  })

  it('stays open when the click was on a page face', () => {
    const palette = makePalette(SPECS)
    palette.show()
    find(palette, '[data-descend]')!.click()
    expect(palette.depth).toBe(1)
    expect(palette.open).toBe(true)
  })

  it('takes the first reachable row when nothing is highlighted', () => {
    const palette = makePalette([{ id: 'a', label: 'A' }])
    palette.show()
    key(palette, 'Enter')
    expect(palette.run).toHaveBeenCalledWith('a', undefined, palette.view)
  })
})

describe('<pm-palette> — filtering', () => {
  const type = (palette: PmPalette, text: string) => {
    palette.query.value = text
    palette.query.dispatchEvent(new Event('input'))
  }

  it('keeps what matches and hides the rest', () => {
    const palette = makePalette(SPECS)
    palette.show()
    type(palette, 'ital')
    expect(labels(palette.reachableRows())).toEqual(['Italic'])
  })

  it('matches the words when the host stamped no search text', () => {
    const palette = makePalette([{ id: 'a', label: 'Bullet list', title: 'Toggle bullet list' }])
    palette.show()
    type(palette, 'toggle')
    expect(labels(palette.reachableRows())).toEqual(['Bullet list'])
  })

  it("prefers the host's search text when there is one", () => {
    const palette = makePalette([
      { id: 'a', label: 'Bold', search: 'bold strong heavy weight' },
    ])
    palette.show()
    type(palette, 'heavy')
    expect(labels(palette.reachableRows())).toEqual(['Bold'])
  })

  it('keeps a page whose contents match, and drops one whose contents do not', () => {
    // A section carries no words of its own, so a page answers through what is
    // inside it — without this, "Table" sat there answering a search for "bold".
    const palette = makePalette(SPECS)
    palette.show()
    type(palette, 'delete')
    expect(labels(palette.reachableRows())).toEqual(['Delete row'])
    expect(palette.reachableRows()[0]!.dataset.path).toBe('Table')
    type(palette, 'bold')
    expect(labels(palette.reachableRows())).toEqual(['Bold'])
  })

  it('finds a page by the name written on it', () => {
    // A page is a row with a name. Answering only through its contents made the
    // word on the face the one query that lost it.
    const palette = makePalette(SPECS)
    palette.show()
    palette.query.value = 'table'
    palette.query.dispatchEvent(new Event('input'))
    expect(labels(palette.reachableRows())).toEqual(['Table'])
  })

  it('takes a replacement matcher', () => {
    const palette = makePalette(SPECS)
    // Initials, the cheapest fuzzy there is.
    palette.matcher = (text, query) =>
      query.split('').every((letter) => text.split(' ').some((word) => word.startsWith(letter)))
    palette.show()
    type(palette, 'i')
    expect(labels(palette.reachableRows())).toEqual(['Italic'])
  })

  it('forgets the query when it opens again', () => {
    const palette = makePalette(SPECS)
    palette.show()
    type(palette, 'ital')
    palette.hide()
    palette.show()
    expect(palette.query.value).toBe('')
    expect(labels(palette.reachableRows())).toEqual(['Bold', 'Italic', 'Table'])
  })

  it('comes back to the first page when it opens again', () => {
    const palette = makePalette(SPECS)
    palette.show()
    find(palette, '[data-descend]')!.click()
    expect(palette.depth).toBe(1)
    palette.hide()
    palette.show()
    expect(palette.depth).toBe(0)
  })
})

describe('<pm-palette> — templates, shared with the strip', () => {
  it('draws through a venue\'s own markup and lays sections out with no dividers', () => {
    const palette = makePalette(
      SPECS,
      `<template data-as="button">
         <button type="button" class="row"><span data-slot="label"></span></button>
       </template>
       <template data-as="inline">
         <section class="section"><p data-slot="face"><span data-slot="label"></span></p>
         <ul data-slot="items"><template data-slot="item"><li></li></template></ul></section>
       </template>`,
    )
    palette.show()
    expect(find(palette, '.section p')?.textContent).toBe('Format')
    expect(palette.querySelectorAll('.section li .row').length).toBe(2)
    // A strip puts a rule between adjacent sections; a palette gives them
    // headings instead, so nothing divides them.
    expect(palette.querySelectorAll('.separator').length).toBe(0)
  })
})
