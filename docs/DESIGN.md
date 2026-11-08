# Design control and slides

Written 2026-11-07.
Owner: Cayden (PROPOSED, see `docs/TASKS.md`).
Applies to the dashboard, the glasses fallback page, the glasses views, the demo video graphics, and the slides.

## Design control: the rules

One source, one look, one gate.

1. **One design file is the source of truth.**
   A single Figma file (or Canva for the slides only, if the team prefers) holds the tokens, the components, the dashboard frames, the glasses frames, and the slides.
   Figma file: [HackUTD Rubble Search Design System](https://www.figma.com/design/BGtXIaMoYLUvwgq18SBtYt).
2. **Tokens before styling.**
   Colors, type, spacing, radii, and status colors are Figma variables first, then exported to one CSS variables file in the team repo (`frontend/design-tokens/tokens.css`).
   Code never uses a raw hex color, font, or spacing value outside that file.
3. **Components before screens.**
   Build the shared pieces once (survivor card, status chip, agent chip, countdown, map marker, task-board row, button), then compose screens from them.
4. **Every UI change has a frame.**
   A new screen or a visible change starts as a frame in the design file (even a rough one), so the team agrees on it before code.
5. **Screenshot check before merge.**
   Before merging UI code, put a screenshot next to its frame; fix spacing, alignment, overflow, contrast, and empty or loading states that do not match.
   The design owner signs off in the pull request.
6. **Status is never color only.**
   Critical, delayed, unknown, and resolved always carry a text label or an icon too, for color-blind viewers and for a projector that washes out color.
7. **Real data or marked placeholders.**
   Mockups and slides use real or simulated data from our system, and any placeholder number is marked `--` or `TBD` until it is filled.

## Starting tokens (the design owner may change them, once, in the design file)

| Token | Default | Use |
| --- | --- | --- |
| Critical | a strong red-orange | IMMEDIATE survivors, the unattended headline when not 0 |
| Delayed | amber | DELAYED survivors |
| Unknown | neutral gray | not yet scored, no signs of life detected (always with its label and confidence) |
| Resolved | muted green | resolved survivors |
| Agent tints | one tint per agent (orchestrator, auditor, comms) | agent chips, task board, chain view |
| Glasses green | the G2 display green on black | glasses frames and the fallback page only |
| Type | one sans for UI, one mono for numbers and ids | everything |

The dashboard spec chose a light theme because projected black washes out in a lit hall; the glasses views stay green on black because black is see-through on the G2.

## The Assess look (approved 2026-11-08)

The dashboard is built to this look; the review mockup and its versions are in `.lavish/`.
All values are tokens in `frontend/design-tokens/tokens.css` (the "Assess look" block), so code holds no raw colors or fonts.

| Element | Choice |
| --- | --- |
| Name and logo | "Assess"; the dog with the visor (`frontend/dashboard/public/brand/assess-dog.png`, app icon `electron/icon.png`) |
| Colors | HackUTD Zero Day: night `#0A0718` to `#1B0F3F` in the top bar, purple `#7828FF`, lavender, magenta accents; light paper map and white cards; status colors unchanged |
| Type | Satoshi (text), Chakra Petch Bold Italic (titles, big numbers; stands in for Zero Day's Elevon, which is a trial license), IBM Plex Mono (ids, times) |
| Mascot | A cartoon tornado, one per agent, in its agent tint with one prop |
| Map | Paper and ink: OpenStreetMap outlines, no tiles |

## How to reference past work (structure, not content)

These are other projects' files; reuse their process and structure, not their content, colors, or assets.
Some links may need access from their owners.

| Reference | What to take from it | Where it is described |
| --- | --- | --- |
| Better Futures Design System (BFI) library | The primary button states and component variant organization | The Components page in the linked Figma file |
| Stochastic (Cal Hacks 13.0) team Figma file | A versioned UI page (Hi-fi v1, v2, v3), a Components page, one brand color with pale surfaces, one character and tint per agent, and a "Technologies Used" page of evidence cards (real screenshot, 12 px corners, light stroke, soft shadow, title and description) for the pitch | `../Stochastic/docs/design/README.md` |
| Cal Hacks ideation deck plan (Figma Slides) | A 12-slide deck mapped to the rubric, one screen revealed per slide, a two-minute pitch timed by beats, and the Figma workflow: variables, then components, then screens, then a clickable prototype | `../CalHacks/ideation/design-direction.md` |
| Cal Hacks design lessons | Winners had one distinctive identity and one central metaphor, opened with a real person and numbers, and used two colors and two typefaces | `../CalHacks/ideation/design-direction.md` ("What the winners teach") |
| RowdyHacks XII open house deck (Canva) | A short deck (five slides), a palette table with a use for each color, fonts chosen for readability at bullet size | `../RowdyHacks/RowdyHacksXII/decks/README.md` |

## Slides

Tool: Figma Slides (same file as the tokens) or Canva; pick one and keep the deck in that one place.
Rules: one idea per slide, at most one sentence of text plus a visual, real screenshots from our dashboard and glasses, large numbers, the same tokens as the product, no stock photos of disasters unless openly licensed and credited.

### Outline (about 11 slides, mapped to the tracks)

| # | Slide | Shows | Mainly for |
| --- | --- | --- | --- |
| 1 | Title | Name, one-line promise, the robot photo | everyone |
| 2 | The worst day | A real disaster and a real person's story, with sources (TBD: pick a sourced tornado or collapse event) | State Farm |
| 3 | The gap | Two or three sourced numbers about finding trapped people in time (TBD, sourced) | State Farm |
| 4 | What we built | One sentence and one diagram: robot, board, agents, glasses | everyone |
| 5 | Live demo | A single slide that hands over to the live demo or the video | everyone |
| 6 | Agents that plan and act | The hand-off chain for one survivor (`chain_id`), with the auditor's verdict | NVIDIA |
| 7 | No one overlooked | The guarantees in the database, and "Critical survivors unattended over 60 s: 0" with hundreds of simulated survivors | State Farm |
| 8 | Built on SpacetimeDB | Reducers as the whole backend, schedule tables as countdowns, lifecycle reducers, two screens in sync | SpacetimeDB |
| 9 | Results | Measured numbers only: time from find to acknowledgement, breathing accuracy on our clips, thermal range (TBD until measured) | everyone |
| 10 | Safety and honesty | Never labels anyone dead, shows confidence, robot cannot see through walls, privacy | everyone |
| 11 | Team and next steps | Four people and roles, what a real pilot would need | everyone |

### Two-minute pitch (draft timing)

| Time | Beat |
| --- | --- |
| 0:00 | The story in two sentences |
| 0:15 | The gap in one number |
| 0:25 | The robot finds a person (live or video) |
| 0:55 | The agents hand off, and the glasses guide the rescuer |
| 1:20 | Stop the agents: the database still assigns, and unattended stays at 0 |
| 1:40 | Results and honesty in one line, then the ask |

## Demo video graphics

- Record the glasses fallback page and lay it over real footage with a Screen or Add blend, so black disappears (as in the bluebook demo video).
- Lower-thirds and labels use the same tokens and type as the slides.
