# Foundry — Design System

## Overview

```yaml
name: Foundry
version: alpha
description: Cast iron and molten metal — the visual identity of the Foundry control-plane panel.
```

Foundry's panel is a control room for a software factory: dense, operational, and calm, with one
hot accent that marks work in motion. The identity is **cast iron and molten metal** — near-black
iron surfaces, warm bone text, hairline seams, and a single orange that behaves like heated metal.
It should feel like precision machinery, not a dashboard template.

The emotional target is a quiet workshop at night: most of the room is dark and still, and the one
thing that glows is the job that is running. That contrast is the whole visual idea, so it must not
be spent on decoration.

Principles:

- **One hot accent.** Molten orange is reserved for primary actions, live/running state, focus, and
  the strongest emphasis. If everything glows, nothing does.
- **Iron first, color second.** Hierarchy comes from surface tone and 1px lines. Semantic colors are
  small signals (pills, notices, meters), never large fills.
- **Dense but legible.** 13px monospace body copy, compact 6px radii, generous page margins.
  Optimize for scanning many jobs at once, not for a marketing page.
- **Quiet motion.** Fades and 1px lifts, roughly 150–350ms. No bounce, no spin, no attention-seeking
  chrome.
- **Tokens are normative.** [`apps/web/src/app/globals.css`](apps/web/src/app/globals.css) is the
  implementation of this file. Change both in the same pull request; if they disagree, the CSS is
  what users see.

## Colors

```yaml
colors:
  # Surfaces, darkest to lightest.
  background: "#121110" # --bg
  surface: "#1a1917" # --bg-raised
  surface-container-lowest: "#0c0b0a" # --bg-sunk
  # Content.
  on-background: "#ece6da" # --text
  on-background-variant: "#9b9488" # --text-dim
  on-background-faint: "#6a645a" # --text-faint
  # Lines.
  outline: "#2b2925" # --line
  outline-strong: "#3d3a34" # --line-strong
  # The one hot accent, plus its warm companion.
  primary: "#ff6a1f" # --molten
  on-primary: "#1a0d05" # dark text on primary
  primary-container: "#ffb347" # --ember
  # Supporting and semantic colors.
  secondary: "#7fa7c9" # --steel
  success: "#7cc68d" # --ok
  warning: "#e8c15a" # --warn
  error: "#f0675a" # --bad
```

The palette is a warm near-black stack. Depth is expressed by moving one surface step, not by adding
shadows.

| Role                | Token                             | Value     | CSS variable    |
| ------------------- | --------------------------------- | --------- | --------------- |
| Page                | `colors.background`               | `#121110` | `--bg`          |
| Raised surface      | `colors.surface`                  | `#1a1917` | `--bg-raised`   |
| Sunken surface      | `colors.surface-container-lowest` | `#0c0b0a` | `--bg-sunk`     |
| Primary text        | `colors.on-background`            | `#ece6da` | `--text`        |
| Secondary text      | `colors.on-background-variant`    | `#9b9488` | `--text-dim`    |
| Metadata text       | `colors.on-background-faint`      | `#6a645a` | `--text-faint`  |
| Default line        | `colors.outline`                  | `#2b2925` | `--line`        |
| Interactive line    | `colors.outline-strong`           | `#3d3a34` | `--line-strong` |
| Primary / molten    | `colors.primary`                  | `#ff6a1f` | `--molten`      |
| Text on primary     | `colors.on-primary`               | `#1a0d05` | —               |
| Ember / links       | `colors.primary-container`        | `#ffb347` | `--ember`       |
| Steel / information | `colors.secondary`                | `#7fa7c9` | `--steel`       |
| Success             | `colors.success`                  | `#7cc68d` | `--ok`          |
| Warning             | `colors.warning`                  | `#e8c15a` | `--warn`        |
| Error               | `colors.error`                    | `#f0675a` | `--bad`         |

- **Surfaces.** `background` is the page; `surface` is a card, ticket, nav item hover, or button;
  `surface-container-lowest` is a well — the nav rail, board lanes, log panes, inputs, and code
  blocks. Never use pure `#000` or pure `#fff`.
- **Text.** Use `on-background` for anything the user must read, `on-background-variant` for
  supporting copy, and `on-background-faint` only for non-essential metadata (timestamps, counts,
  labels). Faint text intentionally sits below WCAG AA on these dark surfaces; never use it for
  actions, status, or required information.
- **Molten orange.** Use `primary` for the primary button fill, live/running indicators, focus rings,
  and the brand mark. Use `primary-container` (ember) for links, the meter gradient end, and
  highlighted inline values such as join tokens. Do not use orange for errors; errors are red.
- **Semantic colors.** `success`, `warning`, and `error` appear as pill text, notice borders, and
  small indicators. Never fill a large surface with them.
- **Line weight.** Every boundary is 1px. `outline` is the default seam; `outline-strong` is for
  interactive edges (inputs, buttons, hover) and should feel slightly more present.
- **Derived tones.** Translucent orange is the only allowed alpha tint:
  `rgba(255, 106, 31, 0.18)` for glows and `rgba(255, 106, 31, 0.45)` for a live border. Do not
  introduce new hues or gradients beyond the ember-to-molten meter gradient.
- **Grain.** The page carries a 5% SVG-noise overlay (`body::before`). It is atmosphere, not a
  token: keep it non-interactive and never let it sit above content in the stacking order in a way
  that blocks clicks.

## Typography

```yaml
typography:
  headline-display:
    fontFamily: "Bricolage Grotesque"
    fontSize: 54px
    fontWeight: 800
    lineHeight: 1.1
    letterSpacing: -0.04em
  headline-lg:
    fontFamily: "Bricolage Grotesque"
    fontSize: 34px
    fontWeight: 700
    lineHeight: 1.1
    letterSpacing: -0.02em
  headline-md:
    fontFamily: "Bricolage Grotesque"
    fontSize: 24px
    fontWeight: 800
    lineHeight: 1.1
    letterSpacing: -0.04em
  headline-sm:
    fontFamily: "Bricolage Grotesque"
    fontSize: 19px
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: -0.02em
  title-lg:
    fontFamily: "Bricolage Grotesque"
    fontSize: 15px
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: -0.02em
  title-sm:
    fontFamily: "Bricolage Grotesque"
    fontSize: 14px
    fontWeight: 600
    lineHeight: 1.25
  body-md:
    fontFamily: "IBM Plex Mono"
    fontSize: 13px
    fontWeight: 400
    lineHeight: 1.55
  body-sm:
    fontFamily: "IBM Plex Mono"
    fontSize: 12px
    fontWeight: 400
    lineHeight: 1.55
  label-md:
    fontFamily: "IBM Plex Mono"
    fontSize: 13px
    fontWeight: 500
    lineHeight: 1.55
  label-sm:
    fontFamily: "IBM Plex Mono"
    fontSize: 11px
    fontWeight: 500
    lineHeight: 1.5
    letterSpacing: 0.1em
  label-caps:
    fontFamily: "IBM Plex Mono"
    fontSize: 11px
    fontWeight: 500
    lineHeight: 1.5
    letterSpacing: 0.14em
  stat:
    fontFamily: "Bricolage Grotesque"
    fontSize: 30px
    fontWeight: 700
    lineHeight: 1.1
    letterSpacing: -0.03em
```

Two families, with a hard split of responsibility:

- **Bricolage Grotesque** (display, weights 500–800) for the brand, page titles, section headings,
  ticket titles, and metrics. Fallbacks: Iowan Old Style, Georgia, serif.
- **IBM Plex Mono** (text, weights 400–600) for all body copy, tables, forms, logs, and labels.
  Fallbacks: ui-monospace, SF Mono, Menlo, monospace.

The body defaults to `body-md`: 13px / 1.55 mono, antialiased, on `background`.

Hierarchy:

- `headline-display` (54px, 800, -0.04em) is exclusive to the sign-in hero. Do not use it in the
  panel.
- `headline-lg` (34px, 700, -0.02em) is the page title. One per page.
- `headline-md` (24px, 800, -0.04em) is the brand lockup, not a content heading.
- `headline-sm` (19px, 700) is a card/section heading; `title-lg` (15px, 700) is a subsection
  heading; `title-sm` (14px, 600, 1.25) is a ticket title.
- `stat` (30px, 700, -0.03em) is for a single large metric per card. Never scale it up further.
- `label-sm` (11px, 500, 0.1em tracking, uppercase) is for table headers, lane headers, and pills.
  `label-caps` (11px, 0.14em) is for eyebrows above a page title. `label-md` (13px, 500) is for
  button text.
- `body-sm` (12px) is metadata, log lines, and helper text.

Rules:

- Do not set the display face below 14px; it loses its character and reads as a mistake.
- Do not set body copy or labels in the display face. The mono face is the voice of the product.
- Keep headings tight (negative tracking) and labels open (positive tracking). That contrast is
  intentional.
- Use only the loaded weights (display 500–800, mono 400–600). Do not fake bold or italic.
- Keep body line length under roughly 90 characters; let cards and columns do the wrapping.

## Layout & Spacing

```yaml
spacing:
  unit: 2px
  gap-xs: 4px
  gap-sm: 8px
  gap-md: 12px
  card-gap: 14px
  card-padding: 18px
  section-gap: 26px
  page-padding: 40px
```

- **Shell.** A fixed 216px nav rail on the left and a fluid main column. Main is capped at 1500px
  and padded `34px 40px 80px` on desktop. The rail is sticky, full-height, and separated by a 1px
  `outline`.
- **Rhythm.** The spacing scale is built on a 2px unit, with practical gaps at 4, 8, 12, and 14px.
  Cards use 18px padding; stacked cards are 14px apart; the page head is 26px above the content;
  the page uses 40px horizontal padding.
- **Grids.** Use two, three, or four equal columns (`grid-2`, `grid-3`, `grid-4`) with 14px gaps.
  Never let a grid column shrink below its content; collapse instead.
- **Board.** Lanes scroll horizontally, are at least 230px wide, have a 12px gap, 10px inner
  padding, and a sunken surface. A lane is a column, never a wrapped grid.
- **Tables.** Full width, 10px cell padding, 1px row dividers, uppercase 11px headers with 0.1em
  tracking. Numeric columns align consistently; do not add zebra stripes.
- **Forms.** Label above field with a 5px gap; inputs are 7px / 10px padded with a sunken surface.
  Group related fields in a `.row` with a 10px gap, and wrap rather than overflow.
- **Responsive.** Below 900px the rail becomes a horizontal wrap, the main padding drops to
  `22px 16px`, and all multi-column grids collapse to one column. Preserve reading order; do not
  duplicate content for mobile.

## Elevation & Depth

Foundry has no glassmorphism, no blur, and no heavy drop shadows. Depth is a one-step surface shift
plus a hairline, which keeps a dense screen readable.

- **Level 0 — page.** `background` with the 5% grain overlay.
- **Level 1 — raised.** `surface` with a 1px `outline`: cards, tickets, secondary buttons.
- **Level -1 — sunken.** `surface-container-lowest` with a 1px `outline`: nav rail, board lanes, log
  panes, text inputs, code blocks.

Exception — **live elevation**. A running job's ticket may use a translucent orange border
(`rgba(255, 106, 31, 0.45)`) and this exact shadow:

```css
box-shadow:
  0 0 0 1px rgba(255, 106, 31, 0.18),
  0 6px 22px -10px #ff6a1f;
```

Use it only while the job is live. It is the one element allowed to appear to emit light.

Focus and hover:

- Focus is always visible: border `primary` plus `box-shadow: 0 0 0 3px rgba(255, 106, 31, 0.18)`.
  Never remove the focus ring or replace it with color alone.
- Hover on a neutral control moves the border from `outline` to `outline-strong`. A ticket may lift
  by 1px. The primary button gains `box-shadow: 0 0 18px -2px #ff6a1f` without changing size.
- Do not use elevation to signal importance; use type scale, position, and the one accent.

## Shapes

```yaml
rounded:
  none: 0px
  sm: 6px
  full: 9999px
```

- **Radius.** `rounded.sm` (6px) is the default for cards, buttons, inputs, lanes, tickets, logs,
  and notices. `rounded.full` (9999px) is reserved for status pills. `rounded.none` exists only for
  elements that must align flush, such as table cells and dividers.
- **Edges.** All containers use a 1px border. Do not mix borderless cards with bordered cards in the
  same view, and never use a border thicker than 1px except the focused input's ring.
- **Brand mark.** A 12px square with a 2px radius, filled `primary`, with a soft molten glow. It is
  the only square-with-glow element in the system.
- **Meters.** 6px tall, 3px radius, track `surface-container-lowest`, fill a left-to-right gradient
  from `primary-container` to `primary`.
- **Timeline.** A 1px vertical `outline-strong` line with 9px circular nodes. The node is filled by
  event kind: `primary` for stage changes, `secondary` for resumes, `warning` for questions and
  answers, and `background` with a faint border for everything else.
- **Pills.** Fully rounded, 2px vertical padding, 11px label, and a 6px dot before the text. The dot
  is currentColor, so tone changes require only the text color token.

## Components

```yaml
components:
  app-shell:
    backgroundColor: "{colors.background}"
    textColor: "{colors.on-background}"
    typography: "{typography.body-md}"
  nav:
    backgroundColor: "{colors.surface-container-lowest}"
    textColor: "{colors.on-background-variant}"
    typography: "{typography.body-md}"
    width: 216px
  nav-item-active:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.on-background}"
    typography: "{typography.body-md}"
    rounded: "{rounded.sm}"
    padding: 7px
  card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.on-background}"
    typography: "{typography.body-md}"
    rounded: "{rounded.sm}"
    padding: "{spacing.card-padding}"
  board-lane:
    backgroundColor: "{colors.surface-container-lowest}"
    textColor: "{colors.on-background-variant}"
    typography: "{typography.label-sm}"
    rounded: "{rounded.sm}"
    padding: 10px
  ticket:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.on-background}"
    typography: "{typography.title-sm}"
    rounded: "{rounded.sm}"
    padding: 10px
  ticket-live:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.on-background}"
    typography: "{typography.title-sm}"
    rounded: "{rounded.sm}"
  text-muted:
    textColor: "{colors.on-background-variant}"
    typography: "{typography.body-sm}"
  text-meta:
    textColor: "{colors.on-background-faint}"
    typography: "{typography.label-caps}"
  divider:
    backgroundColor: "{colors.outline}"
    height: 1px
  divider-strong:
    backgroundColor: "{colors.outline-strong}"
    height: 1px
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    typography: "{typography.label-md}"
    rounded: "{rounded.sm}"
    padding: 7px
    height: 34px
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.on-background}"
    typography: "{typography.label-md}"
    rounded: "{rounded.sm}"
    padding: 7px
    height: 34px
  input:
    backgroundColor: "{colors.surface-container-lowest}"
    textColor: "{colors.on-background}"
    typography: "{typography.body-md}"
    rounded: "{rounded.sm}"
    padding: 7px
    height: 36px
  pill:
    textColor: "{colors.on-background-variant}"
    typography: "{typography.label-sm}"
    rounded: "{rounded.full}"
    padding: 2px
  pill-live:
    textColor: "{colors.primary}"
    typography: "{typography.label-sm}"
    rounded: "{rounded.full}"
  pill-info:
    textColor: "{colors.secondary}"
    typography: "{typography.label-sm}"
    rounded: "{rounded.full}"
  pill-success:
    textColor: "{colors.success}"
    typography: "{typography.label-sm}"
    rounded: "{rounded.full}"
  pill-warning:
    textColor: "{colors.warning}"
    typography: "{typography.label-sm}"
    rounded: "{rounded.full}"
  pill-error:
    textColor: "{colors.error}"
    typography: "{typography.label-sm}"
    rounded: "{rounded.full}"
  link:
    textColor: "{colors.primary-container}"
    typography: "{typography.body-md}"
  stat:
    textColor: "{colors.on-background}"
    typography: "{typography.stat}"
  code-token:
    backgroundColor: "{colors.surface-container-lowest}"
    textColor: "{colors.primary-container}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.sm}"
    padding: 10px
  toast:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.on-background}"
    typography: "{typography.body-md}"
    rounded: "{rounded.sm}"
    padding: 12px
```

### Shell and navigation

`app-shell` is `background` + `on-background` body copy. `nav` is a sunken surface with
`on-background-variant` links, 7px / 10px padding, 6px radius, and a 1px right border. The active or
hovered item raises to `surface` with `on-background` text. Keep the rail quiet: no icons-as-color,
no badges with fills.

### Cards and tickets

`card` is a raised surface with 18px padding and a 1px outline. A ticket is the same surface with
10px padding, `title-sm` for its title, and `label-*` / `text-meta` for its metadata. Hover raises
the border; a live ticket adds the live elevation described above. Never nest a card directly inside
another card without a surface change.

### Actions

`button-primary` is the only filled orange control: `primary` fill, `on-primary` text, 6px radius,
7px vertical padding, 34px height. `button-secondary` is a raised surface with `on-background` text.
Both use `label-md`. Danger is expressed as `error` text on a neutral button, not a red fill. Use at
most one primary button per card; secondary actions never compete with it.

### Inputs

`input` sits on the sunken surface with `outline-strong`, `body-md` text, 7px / 10px padding, and a
6px radius. Focus switches the border to `primary` and adds the 3px translucent ring. Placeholder
text uses `on-background-faint`; labels use `on-background-variant` at 12px.

### Status pills

Pills carry the job and runner vocabulary. Default is `on-background-variant`; live uses `primary`
(with its dot pulsing); info uses `secondary`; success, warning, and error use their semantic tokens.
The pill shape and dot never change — only the text color. Semantic colors are never used as a pill
background.

### Toasts

A toast is the panel's transient result channel: a raised `surface`, 6px radius, 12px padding, and
a 1px border tinted with its semantic tone (success, warning, error, or steel for neutral
information). The title is `body-md` at 500 weight; an optional description is `body-sm` in
`on-background-variant`. The tone colors the title and border only — never fill the surface with it.
Toasts stack bottom-right, never take focus, announce through a persistent `aria-live="polite"`
region, dismiss after five seconds, and stay open while hovered or focused. Enter with a 200ms
fade and 6px lift; drop the animation under `prefers-reduced-motion`.

### Data display

Tables use `body-sm`/`body-md` text, 1px `outline` dividers, and `label-sm` uppercase headers.
Metrics use `stat` with a `label-sm` caption below. Logs and code tokens use the sunken surface with
12px mono; `code.token` switches the text to `primary-container` and the border to `primary`.
Links use `primary-container` and gain a 3px underline offset on hover.

## Do's and Don'ts

**Do**

- Treat this file and `apps/web/src/app/globals.css` as one artifact. Change tokens and CSS vars
  together, in the same PR, with a validation run of
  `pnpm dlx @google/design.md lint DESIGN.md`.
- Use surface steps and 1px lines first; reach for color only to signal state.
- Reserve `primary` for one primary action, live work, focus, and the brand mark.
- Keep body copy in IBM Plex Mono at 13px and headings in Bricolage Grotesque at 14px or larger.
- Use `on-background-faint` only for non-essential metadata.
- Verify keyboard focus, AA contrast for required text, and the 900px breakpoint whenever you change
  layout or color.

**Don't**

- Don't invent colors outside these tokens, and don't add blue/purple gradients, glassmorphism, or
  blur effects.
- Don't use semantic colors as large fills, and don't make destructive actions a red button.
- Don't use pure black or pure white, and don't place the same surface tone directly on itself
  without a 1px line.
- Don't use drop shadows for hierarchy; the only shadows are focus rings, the primary-button hover
  glow, and live elevation.
- Don't set body copy in the display face, use unloaded weights, or fake bold/italic.
- Don't remove the grain overlay or the focus ring to "clean up" a screen.
- Don't hard-code a hex value in a component when a token exists.
