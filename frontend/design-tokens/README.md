# Design tokens

`tokens.css` is the one source of colors, type, spacing, and radii for the dashboard, the glasses fallback page, the demo video graphics, and the slides.
It follows design control in `docs/DESIGN.md` (rule 2, "tokens before styling") and the shared file named in `docs/specs/CONTRACTS.md` "Conventions".

## D1 status

This file is the local draft of the D1 token export.
The [HackUTD Rubble Search Design System](https://www.figma.com/design/BGtXIaMoYLUvwgq18SBtYt) contains the matching light and dark Variables collection, starter UI components including active and default navigation buttons, and frames for the priority-first dashboard, Agents panel, glasses layouts, and slides.
Its Components page also includes a default primary button from the Better Futures Design System library as a visual reference.
Values explicitly marked `PROPOSED` in `tokens.css` are placeholders that need a design decision in Figma before product styling uses them.
In particular, the resolved green, agent tints, spacing scale, and most radii remain unapproved because their source specs say TBD or give examples only.
The contrast script checks the current draft values and does not approve the proposed colors.

The local files cover token definitions and contrast checking.
Figma components and frames are starter assets and still need review against finished screens.

## The rule

Code uses only these CSS variables.
No raw hex color, `rgb()` value, font family, font size, spacing, or radius goes in any other file.
If you need a value that is not here, add a token here first (and in Figma), then use it.
After the first design pass, a token change is a team decision, because three surfaces depend on it.

## How to import

Plain HTML:

```html
<link rel="stylesheet" href="/path/to/frontend/design-tokens/tokens.css" />
```

From a CSS file (Vite inlines it, and a browser follows it as a relative URL):

```css
@import "../../design-tokens/tokens.css";
```

From a Vite app's entry module (the dashboard):

```ts
import '../../design-tokens/tokens.css';
```

Then use the variables:

```css
.badge-immediate {
  background: var(--crit-immediate);
  color: var(--crit-immediate-fg);
  font-weight: var(--fw-bold);
  font-size: var(--fs-min);
  padding: var(--space-1) var(--space-2);
  border-radius: var(--radius-sm);
}
```

In a canvas, read a token with `getComputedStyle(document.documentElement).getPropertyValue('--glasses-green')`.

## Themes

- Light is the default, on `:root`, because projected black washes out in a lit hall.
- Dark is opt-in: set `data-theme="dark"` on `<html>`.
- Both themes set `color-scheme` and an explicit `body` background.
- The glasses tokens (`--glasses-*`) are the same in both themes; they are for the glasses fallback page, the video, and the slides only (the lens itself shows 16 levels of green, and black is see-through).

## What is in the file

| Group | Tokens |
| --- | --- |
| Surfaces and text | `--bg`, `--panel`, `--text`, `--text-muted`, `--border`, `--focus` |
| Critical levels | `--crit-immediate`, `--crit-delayed`, `--crit-minor`, `--crit-unknown`, each with `-fg` (badge text) and `-ink` (colored text on `--panel` or `--bg`); `--crit-delayed-outline` |
| Resolved | `--status-resolved`, `--status-resolved-fg`, `--status-resolved-ink` |
| Map | `--robot`, `--rescuer`, `--cell-searched`, `--cell-partial` |
| Agents | `--agent-orchestrator`, `--agent-auditor`, `--agent-comms` (ink), each with `-bg` (pale chip surface) |
| Glasses | `--glasses-bg`, `--glasses-green`, `--glasses-level-0` to `--glasses-level-4` (text brightness as alpha) |
| Type | `--font-ui`, `--font-mono`, `--fw-regular`, `--fw-bold`, `--fs-attrib`, `--fs-min` (18), `--fs-row` (22), `--fs-label` (28), `--fs-headline` (32), `--fs-big` (44), `--fs-commander` (64), `--lh-tight`, `--lh-normal` |
| Spacing | `--space-1` to `--space-8` (4, 8, 12, 16, 24, 32, 48, 64 px) |
| Radii and borders | `--radius-sm` (4), `--radius-md` (8), `--radius-lg` (12, evidence cards), `--radius-pill`, `--border-w`, `--border-w-strong`, `--shadow-card` |

Rules that come with the colors:

- Status is never color only: every critical or resolved token is shown with its label (`IMMEDIATE`, `DELAYED`, `MINOR`, `NOT SCORED`, `RESOLVED`) or an icon.
- `--crit-immediate-fg` on `--crit-immediate` in the light theme is 3.9:1, so that badge text is always bold and 18.66 px or larger.
- The delayed yellow badge always has the `--crit-delayed-outline` border, because yellow on a light panel has almost no contrast.
- No text, label, or token name may say dead, deceased, or expectant.

## Contrast check

```bash
node frontend/design-tokens/check-contrast.mjs
```

It reads `tokens.css`, checks each text and status pair in both themes and the glasses text levels against WCAG 2.2 AA (4.5:1 for text, 3:1 for bold 18.66 px or larger and for outlines), prints one line per pair, and exits 1 if any pair fails.
Run it after every color change, and add a pair to its list when you add a text color.

## Figma

Cayden makes the Figma variables by hand, in one Variables collection with the modes `light` and `dark`.
Each Figma variable must have the same name as its CSS variable without the leading `--` (for example `crit-immediate`, `agent-comms-bg`, `space-4`), and the same value in each mode.
If Figma and this file differ, fix one of them in the same change; this file is what the code reads.
Link to the Figma file: see `docs/DESIGN.md` ("Link it here once it exists").
