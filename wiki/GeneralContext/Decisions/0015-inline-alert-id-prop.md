---
type: decision
---

# 0015 - InlineAlert takes an id

Decision: 2026-10-07, the human.

## Context

When a field's error *is* an `InlineAlert` (the composer's image field), the
control's `aria-describedby` has to name it. `UI-006` first put the id on a
`<div>` wrapping the alert, because `src/components/ui/**` was outside its
paths.

## Choice

- **A prop, not a wrapper.** When a field's error *is* an `InlineAlert`, the
  control's `aria-describedby` names the alert itself through `InlineAlert`'s
  `id` prop. The human preferred the prop as the better practice: the element
  that describes the control is the alert, with no extra node whose text has
  to stay identical to it.
- **Only `id`.** No `className` or general attribute passthrough; the role,
  classes and icon are what make it this component.

## Consequences

- **Performance:** none expected (one optional attribute, and one element fewer
  than the wrapper). If that ever proves wrong, revisit it with a new decision.
- The props as built: `wiki/CodeContext/FrontendUI/components-shared.md` §2 "As built".
