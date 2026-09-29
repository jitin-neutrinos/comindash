/**
 * MultiSelect — shadcn/ui Combobox pattern (Popover + Command on cmdk),
 * vendored 2026-09-28 from https://ui.shadcn.com (MIT) and adapted:
 * - JSX (project has no TS), project Tailwind tokens (surface/line/ink/mist),
 *   lucide-react icons, no cn() helper (template strings).
 * - Multi-select with search, Select all / Clear, count badge, and an
 *   OPTIONS BUDGET: each option lists what remains selectable given the
 *   other active filters (cross-filtering) — disabled when the option
 *   would produce an empty graph.
 *
 * Source pattern: shadcn Combobox + Magic UI/21st-style pill chip row.
 */
import { useMemo, useState } from 'react'
import * as PopoverPrimitive from '@radix-ui/react-popover'
import { Command as CommandPrimitive } from 'cmdk'
import { Check, ChevronsUpDown, Search, X } from 'lucide-react'

const pop = (...xs) => xs.filter(Boolean).join(' ')

/* --- Popover shell (shadcn popover, brand-tokenized) ----------------------- */
function Popover({ open, onOpenChange, children }) {
  return (
    <PopoverPrimitive.Root open={open} onOpenChange={onOpenChange}>
      {children}
    </PopoverPrimitive.Root>
  )
}
const PopoverTrigger = PopoverPrimitive.Trigger
function PopoverContent({ className = '', align = 'start', sideOffset = 6, children, ...props }) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        align={align}
        sideOffset={sideOffset}
        className={`z-50 mt-1 w-64 rounded-xl border border-line bg-surface p-1.5 shadow-lg ${className}`}
        {...props}
      >
        {children}
      </PopoverPrimitive.Content>
    </PopoverPrimitive.Portal>
  )
}

/* --- Command primitives (shadcn command, minimal subset) -------------------- */
const Command = ({ className = '', ...props }) => (
  <CommandPrimitive
    className={`flex flex-col overflow-hidden rounded-lg bg-surface text-ink ${className}`}
    {...props}
  />
)
const CommandInput = ({ className = '', ...props }) => (
  <div className="flex items-center gap-2 border-b border-hairline px-2.5 py-2">
    <Search className="h-3.5 w-3.5 shrink-0 text-muted" aria-hidden="true" />
    <CommandPrimitive.Input
      className="w-full bg-transparent text-small text-ink outline-none placeholder:text-muted"
      {...props}
    />
  </div>
)
const CommandList = ({ className = '', ...props }) => (
  <CommandPrimitive.List className={`max-h-56 overflow-y-auto py-1 ${className}`} {...props} />
)
const CommandEmpty = () => (
  <CommandPrimitive.Empty className="px-3 py-4 text-center text-small text-muted">
    Nothing found.
  </CommandPrimitive.Empty>
)
const CommandItem = ({ className = '', ...props }) => (
  <CommandPrimitive.Item
    className={`flex cursor-pointer select-none items-center gap-2 rounded-lg px-2.5 py-1.5 text-small text-ink outline-none data-[selected=true]:bg-mist data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-40 ${className}`}
    {...props}
  />
)

/**
 * Faceted multi-select dropdown.
 *
 * options: [{ value, label, hint }] — hint is the small right-aligned meta
 * (e.g. "12 links"). available: Set of values still selectable under the
 * other filters. When an option is disabled (not in `available`), it shows
 * but cannot be picked, so the graph can never go empty by accident.
 */
export default function MultiSelect({
  label,
  options,
  selected,
  onChange,
  available,
  single = false,
}) {
  const [open, setOpen] = useState(false)
  const availSet = useMemo(() => available ?? new Set(options.map((o) => o.value)), [available, options])
  const selectedSet = useMemo(() => new Set(selected), [selected])
  const count = selected.length

  const toggle = (value) => {
    if (single) {
      onChange(selected[0] === value ? [] : [value])
      return
    }
    onChange(
      selectedSet.has(value) ? selected.filter((v) => v !== value) : [...selected, value],
    )
  }

  const summary =
    count === 0 ? `All ${label.toLowerCase()}` : count === 1 ? options.find((o) => o.value === selected[0])?.label ?? '1 selected' : `${count} selected`

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`Filter by ${label}`}
          className={
            'group flex min-w-0 items-center justify-between gap-2 rounded-pill border px-3.5 py-2 text-small transition-colors ' +
            (count > 0
              ? 'border-blue/50 bg-blue/[0.06] text-blue'
              : 'border-line bg-surface text-ink hover:border-blue/40')
          }
        >
          <span className="flex min-w-0 items-center gap-2">
            {count > 0 && (
              <span className="flex h-4.5 min-w-4.5 items-center justify-center rounded-full bg-blue px-1 text-[10px] font-semibold leading-none text-white">
                {count}
              </span>
            )}
            <span className="truncate">{summary}</span>
          </span>
          <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-muted group-hover:text-ink" aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent>
        <Command>
          <CommandInput placeholder={`Search ${label.toLowerCase()}…`} />
          <CommandList>
            <CommandEmpty />
            {!single && (
              <div className="flex items-center justify-between gap-2 px-2.5 py-1.5 text-caption">
                <button
                  type="button"
                  onClick={() => onChange(options.filter((o) => availSet.has(o.value)).map((o) => o.value))}
                  className="font-medium text-blue transition-colors hover:text-midnight"
                >
                  Select all
                </button>
                <button
                  type="button"
                  onClick={() => onChange([])}
                  className="font-medium text-muted transition-colors hover:text-ink"
                >
                  Clear
                </button>
              </div>
            )}
            {options.map((o) => {
              const on = selectedSet.has(o.value)
              const enabled = availSet.has(o.value) || on
              return (
                <CommandItem
                  key={o.value}
                  value={o.value}
                  disabled={!enabled}
                  onSelect={() => enabled && toggle(o.value)}
                >
                  <span
                    className={
                      'flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors ' +
                      (on ? 'border-blue bg-blue text-white' : 'border-line bg-surface')
                    }
                  >
                    {on && <Check className="h-3 w-3" aria-hidden="true" />}
                  </span>
                  <span className="flex-1 truncate">{o.label}</span>
                  {o.hint && <span className="shrink-0 text-caption tabular-nums text-muted">{o.hint}</span>}
                </CommandItem>
              )
            })}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
