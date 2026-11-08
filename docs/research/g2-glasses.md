# Even Realities G2 glasses: putting our survivor view on the lens

Researched on 2026-11-07 for HackUTD (Nov 7-8, 2026).
This file covers how the operator's G2 glasses and R1 ring can show the live survivor view from `docs/PROJECT.md`.
A working third-party G2 app (bluebook) is already summarized in [bluebook-reference.md](bluebook-reference.md).
This file links to that summary instead of repeating it, and checks its claims against official sources.

## Key takeaways

- Recommendation: build a small Even Hub plugin with the official SDK, and load it on the glasses with the QR sideload.
  It is a Vite + TypeScript web page that runs in a WebView inside the Even Realities phone app, and the phone app relays it to the glasses over Bluetooth ([docs overview](https://hub.evenrealities.com/docs), [Nervegna tutorial](https://nervegna.substack.com/p/living-with-and-building-for-the)).
- Official developer access exists today and is self-serve.
  Sign in at hub.evenrealities.com with the same account as the phone app, force-quit and reopen the app, and a developer section with "Scan QR" appears ([Hardware quickstart](https://hub.evenrealities.com/docs/get-started/quickstart/hardware)).
  The docs mention no approval step, no waiting period, and no fee for development.
- No Even Realities API key is needed.
  The only approval-gated step is a public store release, and we do not need it.
  The store rules also forbid "emergency-routing functionality" and API keys inside the package, so a public release of this app would likely be rejected anyway ([App submission](https://hub.evenrealities.com/docs/ship/app-submission)).
- The display is 576 x 288 px per eye, 4-bit greyscale shown as 16 levels of green, and black is see-through ([Display docs](https://hub.evenrealities.com/docs/build/display)).
  A page holds at most 4 image containers and 8 text or list containers, and a full-screen text container holds about 400 to 500 characters.
- Live text updates are easy and flicker-free with `textContainerUpgrade`.
  An arrow is possible as a small greyscale image (up to 288 x 144 px per container) sent with `updateImageRawData`, and image sends have a 100 ms minimum spacing ([Display docs](https://hub.evenrealities.com/docs/build/display)).
- R1 ring input reaches custom apps.
  The SDK defines `EventSourceType.TOUCH_EVENT_FROM_RING = 2`, and taps, double taps, and swipes arrive through `bridge.onEvenHubEvent` (verified in the `@evenrealities/even_hub_sdk` 0.0.16 type file, and in the [Device APIs docs](https://hub.evenrealities.com/docs/build/device-apis)).
- Estimated effort for one person who has not used the SDK: about 1 to 2 hours to static text on the lens, 1 to 2 more hours for live data, 1 to 2 hours for an arrow, and under 1 hour for ring input.
- The official Even Realities app must stay open and in the foreground on the phone for the QR sideload path.
  If it backgrounds, the WebView is suspended and the dev connection dies ([Local testing](https://hub.evenrealities.com/docs/test/local-testing)).
- Fallback: a phone or laptop web page drawn as a 576 x 288 green-on-black "glasses view", fed by the same data.
  A second fallback is a community Bluetooth tool on the Mac (for example `even text "..."` from [aluminumio/even](https://github.com/aluminumio/even)), which is unofficial and untested by us.

## 1. Official developer path (Even Hub)

### What it is

Even Hub is Even Realities' app store and developer platform for the G2 ([AndroidGuys](https://androidguys.com/news/even-realities-even-hub-app-store-for-g2-smart-glasses-launches/)).
The docs live at [hub.evenrealities.com/docs](https://hub.evenrealities.com/docs), and the developer portal is reached from the same site.
The docs say plugins are the only live app surface today.
Plugins are web apps (HTML, CSS, JavaScript or TypeScript), and dashboard widgets, dashboard layouts, and AI skills are planned ([docs overview](https://hub.evenrealities.com/docs)).
Apps run on the phone, and the glasses act as the screen ([docs overview](https://hub.evenrealities.com/docs)).

### Packages and versions (checked on npm on 2026-11-07)

- `@evenrealities/even_hub_sdk`: latest 0.0.16, published 2026-09-24 ([npm](https://www.npmjs.com/package/@evenrealities/even_hub_sdk)).
  The package ships an MIT license file.
- `@evenrealities/evenhub-cli`: latest 0.2.0 ([npm](https://www.npmjs.com/package/@evenrealities/evenhub-cli)).
  The binary is `evenhub` ([Nervegna tutorial](https://nervegna.substack.com/p/living-with-and-building-for-the)).
- `@evenrealities/evenhub-simulator`: latest 0.9.5 ([npm](https://www.npmjs.com/package/@evenrealities/evenhub-simulator)).
  The simulator docs still say 0.9.3, so the docs lag npm slightly ([Simulator docs](https://hub.evenrealities.com/docs/test/simulator)).
- Official starter templates: minimal, asr, image, and text-heavy ([even-realities/evenhub-templates](https://github.com/even-realities/evenhub-templates)).
- Official Claude Code plugin with SDK skills: [even-realities/everything-evenhub](https://github.com/even-realities/everything-evenhub).
- Only language: TypeScript or JavaScript in a web page.
  There is no official native (Swift, Kotlin, Python) SDK, and the docs list "direct Bluetooth access" as not available to plugins ([Device APIs](https://hub.evenrealities.com/docs/build/device-apis)).
- A tutorial from late September 2026 warns that the platform changes weekly ([Nervegna tutorial](https://nervegna.substack.com/p/living-with-and-building-for-the)).

### Access and approval

- Account: an Even Realities App account, created in the phone app.
  The web hub has no sign-up flow, and you sign in there with the same credentials ([Sign in quickstart](https://hub.evenrealities.com/docs/get-started/quickstart/sign-in)).
  Cayden already owns the glasses, so he very likely already has this account.
- Developer Mode: there is no toggle.
  Signing in to the web hub enables it, then you force-quit and reopen the phone app ([Hardware quickstart](https://hub.evenrealities.com/docs/get-started/quickstart/hardware)).
- The docs mention no approval or waiting for Developer Mode, QR testing, or private builds.
  We could not confirm from the docs whether a new account can ever be held back, so do the sign-in first and check that the developer section appears.
- Take any glasses firmware update the app offers before starting ([Hardware quickstart](https://hub.evenrealities.com/docs/get-started/quickstart/hardware)).
  Long press events need SDK 0.0.14+ and Even App 2.2.9+ ([Device APIs](https://hub.evenrealities.com/docs/build/device-apis)).

### Three ways to get an app on the glasses

1. QR sideload (use this for the demo).
   Run `npm run dev`, then `evenhub qr --url "http://<laptop-lan-ip>:5173"`, and scan it from the Even Hub tab in the phone app.
   The glasses render the app within about a second, and saving a file redraws them ([Local testing](https://hub.evenrealities.com/docs/test/local-testing)).
   The phone must reach the laptop on the LAN.
   Guest or venue Wi-Fi with client isolation blocks this, so use a phone hotspot or Tailscale ([Local testing](https://hub.evenrealities.com/docs/test/local-testing)).
   Set `server.host: true` in `vite.config.ts`.
2. Private build.
   `npm run build`, `evenhub pack app.json dist -o app.ehpk`, then `evenhub upload app.ehpk`, and install it from Me, Apps, Private builds in the phone app.
   It reaches the glasses within seconds, with no review mentioned, but it is tied to one account ([Private testing](https://hub.evenrealities.com/docs/test/private-testing)).
   This survives the laptop going away, which the QR path does not.
3. Beta and public release.
   Beta builds go to listed testers.
   Public release goes through manual review with no stated turnaround ([App submission](https://hub.evenrealities.com/docs/ship/app-submission)).
   Not needed for HackUTD.

### Simulator

Install with `npm install -g @evenrealities/evenhub-simulator` and run `evenhub-simulator http://localhost:5173` ([Simulator docs](https://hub.evenrealities.com/docs/test/simulator)).
It draws containers and accepts up, down, click, double click, and long press.
With `--automation-port 9898` it serves `GET /api/screenshot/glasses` (a 576 x 288 PNG) and `POST /api/input`, which is handy for recording demo footage ([Simulator docs](https://hub.evenrealities.com/docs/test/simulator)).
It is not a hardware emulator: fonts, greyscale levels, BLE timing, and image size limits differ, so check the final view on real glasses ([Simulator docs](https://hub.evenrealities.com/docs/test/simulator)).
One developer saw the simulator accept about 6 image containers while the glasses hold 4 ([dev.to](https://dev.to/yokomachi/got-an-even-g2-build-your-own-apps-hands-on-impressions-and-dev-tips-1glp)).

### Networking from the plugin

- `fetch()`, `XMLHttpRequest`, and WebSockets work from the WebView ([Networking](https://hub.evenrealities.com/docs/build/networking)).
- Declare a `network` permission in `app.json` with a `whitelist` of full origins (no wildcards).
  The server must also send CORS headers, because the whitelist does not bypass CORS ([Networking](https://hub.evenrealities.com/docs/build/networking)).
- Plain `http://` is described as fine for local development against a LAN dev server ([Networking](https://hub.evenrealities.com/docs/build/networking)).
  The docs do not say whether a LAN IP can go in the whitelist of a packaged build.
  We also did not confirm whether a QR dev session enforces the whitelist (the local testing page says some permission prompts are skipped in dev).
- Simplest design, the same as bluebook: the laptop runs a small server (or the SpacetimeDB client) that computes the view, and pushes ready-to-show strings over one WebSocket.
  The glasses app only renders them.
  We did not test whether the SpacetimeDB TypeScript client runs inside this WebView, so pushing plain strings from a laptop is the lower-risk choice.

## 2. Community and open-source options (Bluetooth, no Even app)

These are unofficial reverse-engineering projects.
None are affiliated with Even Realities, and we have not run any of them.

| Project | G1 or G2 | Platform | What it can send | Notes |
| --- | --- | --- | --- | --- |
| [even-realities/EvenDemoApp](https://github.com/even-realities/EvenDemoApp) | G1 only | Flutter (Android, iOS) | Text (5 lines per screen in the demo), 1-bit 576 x 136 BMP, Even AI pages | Official G1 demo. Each arm has its own BLE link. Not for the G2. |
| [i-soxi/even-g2-protocol](https://github.com/i-soxi/even-g2-protocol) | G2 | Python example | Teleprompter text, calendar widget; notifications partial | BLE auth (7-packet handshake) works. Navigation and Even AI are still research. |
| [Commute773/g2-kit](https://github.com/Commute773/g2-kit) | G2 | TypeScript on Bun or Node 22+ with `@stoprocent/noble` (desktop BLE), or an Android bridge | Text containers, lists with taps, 1-bit bitmaps, mic audio | Pre-1.0. Its gotchas file warns that one unknown config write bricked a pair until a power cycle and re-pair ([gotchas](https://github.com/Commute773/g2-kit/blob/main/ble/docs/gotchas.md)). Desktop pairings "get lost on sleep". |
| [Thepizzapie/OpenEvenSdk](https://github.com/Thepizzapie/OpenEvenSdk) | G2 | Python bridge on Mac or PC, SwiftUI iPhone app, untested Kotlin port | Paged text (25 columns x 10 lines), 4-bpp greyscale images tiled over 576 x 288 | Says "no Even app, no cloud". iOS app tested on real G2. Android not compiled yet. |
| [aluminumio/even](https://github.com/aluminumio/even) | G2 | macOS 12+, Swift, Homebrew | `even text "<message>"`; `even ask` waits for a touchpad hold | Smallest possible path from a Mac. 3 stars. |

More community tools (simulators, gateways, templates) are listed in [awesome-even-realities-g2](https://github.com/pangoleen/awesome-even-realities-g2).

Known limits of the community path:

- We could not confirm from any of these repos whether the official Even app must be closed while they connect.
  Expect a conflict, because a BLE peripheral that is already linked to the phone may not accept or advertise to a second central.
  If we try this path, force-quit the Even app or turn off the phone's Bluetooth first.
- Ring input through these tools is not documented, except R1 authentication in g2-kit-unofficial ([awesome list](https://github.com/pangoleen/awesome-even-realities-g2)).
- Use this only as a fallback, because it bypasses the supported SDK and has bricking reports.

## 3. Display facts

| Fact | Value | Source |
| --- | --- | --- |
| App canvas | 576 x 288 px per eye, origin top-left | [Display docs](https://hub.evenrealities.com/docs/build/display) |
| Physical panel | 640 x 350 (one tutorial); a review says "640x200 virtual screen" | [Nervegna](https://nervegna.substack.com/p/living-with-and-building-for-the); the 640x200 figure came from a web search summary whose review URL we did not confirm - conflicting and not official; build to 576 x 288 |
| Color | 4-bit greyscale, 16 levels of green, black is transparent | [Display docs](https://hub.evenrealities.com/docs/build/display) |
| Containers | Max 4 image + 8 text or list per page, absolute positions, may overlap, exactly one captures input | [Display docs](https://hub.evenrealities.com/docs/build/display) |
| Text | One firmware font, no size, bold, or alignment; about 27 px line height and about 10 lines per screen | [Display docs](https://hub.evenrealities.com/docs/build/display), [Nervegna](https://nervegna.substack.com/p/living-with-and-building-for-the) |
| Text length | 1,000 chars on create or rebuild, 2,000 on `textContainerUpgrade`; full screen holds about 400-500 chars | [Display docs](https://hub.evenrealities.com/docs/build/display) |
| Text brightness | `textColor` 0-4 (SDK 0.0.14+) | [Display docs](https://hub.evenrealities.com/docs/build/display) |
| Borders | `borderWidth` 0-5, `borderRadius` 0-10, on text and list containers | [Display docs](https://hub.evenrealities.com/docs/build/display) |
| Images | Up to 288 x 144 px per container, 4-bit greyscale, sent after page creation with `updateImageRawData`, no concurrent sends, 100 ms minimum spacing, full-screen refresh about 800 ms | [Display docs](https://hub.evenrealities.com/docs/build/display) |
| Drawing | No arbitrary pixel drawing, no background fill, no animation; shapes and arrows only as images or text glyphs | [FAQ](https://hub.evenrealities.com/docs/reference/faq), [Device APIs](https://hub.evenrealities.com/docs/build/device-apis) |
| Missing glyphs | Characters not in the font are silently dropped; no emoji | [Display docs](https://hub.evenrealities.com/docs/build/display), [FAQ](https://hub.evenrealities.com/docs/reference/faq) |
| Refresh rate | Not stated officially; a web search summary of reviews listed 20 Hz | Review URL not confirmed; treat as unknown |
| Field of view, brightness | 27.5 degrees and up to 1,200 nits (tutorial); a review says 25 degrees and 1,000 nits | [Nervegna](https://nervegna.substack.com/p/living-with-and-building-for-the); the 25 degree and 1,000 nit figures came from the same unconfirmed review summary |
| Battery | Up to two days; case holds seven full charges | [Even Realities product page](https://www.evenrealities.com/smart-glasses) |
| Connection | Bluetooth LE 5.2 to the phone | [docs overview](https://hub.evenrealities.com/docs) |
| Weight, rating | 36 g, IP65 | [Even Realities product page](https://www.evenrealities.com/smart-glasses) |

Community-measured update costs (text about 83 ms, page rebuild about 165 ms, image about 104 ms plus 3.9 ms per KB) are in [bluebook-reference.md](bluebook-reference.md).
They fit an update every 2 to 5 seconds easily.
Sending images too often can back up transfers or drop the connection ([dev.to](https://dev.to/yokomachi/got-an-even-g2-build-your-own-apps-hands-on-impressions-and-dev-tips-1glp)).

G1 facts that do not apply to the G2: the 576 x 136 1-bit BMP, the 488 px text width, and the dual per-arm BLE links come from the G1 demo app ([EvenDemoApp](https://github.com/even-realities/EvenDemoApp)).

## 4. The R1 ring

- Yes, a custom app can read ring input.
  The temple touchpads and the R1 send the same event types, told apart by `eventSource` ([Device APIs](https://hub.evenrealities.com/docs/build/device-apis)).
- `EventSourceType` in SDK 0.0.16: `TOUCH_EVENT_FROM_GLASSES_R = 1`, `TOUCH_EVENT_FROM_RING = 2`, `TOUCH_EVENT_FROM_GLASSES_L = 3` (read from `dist/index.d.cts` in the npm tarball).
- Event types in `OsEventTypeList`: `CLICK_EVENT` (0), `SCROLL_TOP_EVENT` (1), `SCROLL_BOTTOM_EVENT` (2), `DOUBLE_CLICK_EVENT` (3), `LONG_PRESS_EVENT` (9), `LONG_PRESS_RELEASE_EVENT` (10) ([Device APIs](https://hub.evenrealities.com/docs/build/device-apis)).
- Gotcha: `CLICK_EVENT` is 0, so it is dropped on the wire and arrives as `undefined`; treat a missing `eventType` as a click ([Nervegna](https://nervegna.substack.com/p/living-with-and-building-for-the)).
- Gotcha: long press is not guaranteed, because the OS uses it for its contextual menu ([Device APIs](https://hub.evenrealities.com/docs/build/device-apis)).
  Use tap and swipe only.
- Gotcha: double tap on the root page should exit with `shutDownPageContainer(1)` ([App submission](https://hub.evenrealities.com/docs/ship/app-submission)).
  Do not map an action to double tap.
- Suggested mapping: tap = "next survivor", swipe up or down = scroll the list, or tap = "I reached this survivor" (sent to SpacetimeDB to start the confirm flow).

## 5. Does the official app have to stay connected?

- For the Even Hub path, yes.
  The plugin runs inside the Even Realities app's WebView, so that app is the host ([docs overview](https://hub.evenrealities.com/docs)).
- QR dev session: keep the app open on screen.
  When it backgrounds, the WebView is suspended and the dev WebSocket dies, and you may see a blank screen until you rescan ([Local testing](https://hub.evenrealities.com/docs/test/local-testing)).
- Installed build: on iOS the WebView keeps running when the phone locks, and an open WebSocket usually holds.
  On Android the WebView may be suspended and the socket dropped, so reconnect on resume ([Background lifecycle](https://hub.evenrealities.com/docs/build/background-lifecycle)).
  The FAQ separately says network calls stall in the background ([FAQ](https://hub.evenrealities.com/docs/reference/faq)), so for the demo keep the phone unlocked with the Even app in front.
- Plugins are foreground-only on the glasses, with no push notifications ([FAQ](https://hub.evenrealities.com/docs/reference/faq)).
- For the community Bluetooth tools, see the conflict note in section 2 (not confirmed).

## 6. Practical plan for the demo

Target view (fits the 576 x 288 canvas, about 4 short lines plus an arrow):

```
2 CRITICAL within 0.3 mi
NEAREST: 40 m N        [arrow image]
breathing 8/min  conf 0.7
tap: next   updated 3s ago
```

Build steps:

1. Cayden signs in at hub.evenrealities.com, force-quits and reopens the Even app, and confirms the "Scan QR" developer section shows.
   Update glasses firmware if offered.
2. `npx degit even-realities/evenhub-templates/minimal g2-view`, install the CLI and simulator, and get "hello" on the simulator, then on the glasses with `evenhub qr`.
3. Page layout: one full-screen text container with `isEventCapture: 1` (receives ring input), plus text containers for the count line, the nearest line, and a dim status line, plus one image container for the arrow.
4. Live data: a laptop service subscribes to SpacetimeDB, computes the count within 0.3 mi and the nearest critical survivor, and pushes the strings over a WebSocket every 2 to 3 seconds.
   The plugin calls `textContainerUpgrade` only when a string changes.
5. Arrow: pre-render 8 arrows (N, NE, E, ... ) as small 4-bit images, for example 96 x 96, on the laptop or at build time, and send one with `updateImageRawData` only when the direction changes.
   Keep a text fallback ("40 m N") in the line next to it, so the view works even if the image fails.
6. Direction: the SDK has no compass API.
   `AppLocation.heading` (from `getAppLocation` or `startAppLocationUpdates`, permission `location`) exists only "when available", which usually means while moving ([Device APIs](https://hub.evenrealities.com/docs/build/device-apis)).
   For the demo, show the absolute bearing (N, NE, ...) from the operator to the survivor, which needs no heading.
   A turn arrow relative to where the operator faces needs heading from the phone or the glasses IMU (`imuControl`, `IMU_DATA_REPORT`), and we have not confirmed that the IMU data is usable as a heading.
   Indoors with LiDAR-map positions, the laptop can compute the bearing in map coordinates and send it as one of the 8 directions.
7. Ring: handle tap in `onEvenHubEvent` to cycle survivors or acknowledge, and send the action back over the same WebSocket.

Difficulty estimates (one person new to the SDK, our estimate, not measured):

| Task | Estimate | Main risk |
| --- | --- | --- |
| Static text on the glasses | 1-2 h | Venue Wi-Fi isolation (use a phone hotspot), firmware update time |
| Live text from the laptop | +1-2 h | CORS and the network whitelist, WebView suspend if the phone locks |
| Simple arrow image | +1-2 h | Packing 4-bit greyscale pixels correctly; test on hardware, not only the simulator |
| Ring input | +0.5-1 h | Click arrives as `undefined`; long press unreliable |
| Turn arrow relative to the operator's facing | +2-4 h, unconfirmed | No compass API; heading only when moving |

Fallbacks if the G2 cannot be programmed in time:

1. Glasses-shaped web view (recommended fallback, about 1 h).
   A web page on a phone or laptop that draws a 576 x 288 black panel with green text and the arrow, fed by the same WebSocket.
   It doubles as the demo's "what the operator sees" screen on the projector.
   The simulator's `GET /api/screenshot/glasses` can also feed a projector view from the real plugin code ([Simulator docs](https://hub.evenrealities.com/docs/test/simulator)).
2. Community Bluetooth from the Mac (about 1 h to try, may not work).
   `brew install aluminumio/tap/even`, then call `even text "2 CRITICAL / 40 m N"` every few seconds from the laptop service ([aluminumio/even](https://github.com/aluminumio/even)).
   Close the Even app first.
   Text only, no ring input, unofficial.
3. Phone notification mirroring (lowest effort, weakest demo).
   The G2 shows phone notifications relayed over Bluetooth by the Even app ([support article](https://support.evenrealities.com/hc/en-us/articles/14274501482639-Notifications)).
   Any app that posts a notification to the phone (for example a message sent to the operator's phone) would appear, but reviewers report pop-ups are not always reliable ([TechCrunch](https://techcrunch.com/2026/07/11/smart-glasses-without-a-camera-even-realities-bets-productivity-beats-recording-everyone/)), and it cannot update in place.

## 7. Accounts, keys, and approvals

| Item | Needed for | Lead time | Source |
| --- | --- | --- | --- |
| Even Realities App account (Cayden's existing one) | Everything on the official path | None if he already has it | [Sign in](https://hub.evenrealities.com/docs/get-started/quickstart/sign-in) |
| Sign-in at hub.evenrealities.com (turns on Developer Mode) | QR sideload, private builds | Minutes (app restart); no approval mentioned | [Hardware quickstart](https://hub.evenrealities.com/docs/get-started/quickstart/hardware) |
| Even Realities API key | Not needed | - | bluebook needed none ([bluebook-reference.md](bluebook-reference.md)); SDK docs mention none |
| Developer approval | Not needed for QR or private builds | - | [Private testing](https://hub.evenrealities.com/docs/test/private-testing) |
| Public store review | Not needed; likely rejected (emergency routing) | No stated turnaround | [App submission](https://hub.evenrealities.com/docs/ship/app-submission) |
| Phone permissions: location (if we use phone GPS) | Distance and bearing from the operator | Prompt at runtime | [Device APIs](https://hub.evenrealities.com/docs/build/device-apis) |
| Node 20 or 22+ on the laptop | CLI and simulator | Minutes | [Nervegna](https://nervegna.substack.com/p/living-with-and-building-for-the) |
| A network where phone and laptop can reach each other (phone hotspot or Tailscale) | QR sideload and live data | Minutes; Tailscale needs its own account | [Local testing](https://hub.evenrealities.com/docs/test/local-testing) |

Not confirmed: whether Cayden's phone is iOS or Android (it changes background behavior), and whether the Even app version on it is 2.2.9 or later.

## Sources

- Even Hub docs overview: https://hub.evenrealities.com/docs
- Display and UI: https://hub.evenrealities.com/docs/build/display
- Device APIs: https://hub.evenrealities.com/docs/build/device-apis
- Networking: https://hub.evenrealities.com/docs/build/networking
- Background lifecycle: https://hub.evenrealities.com/docs/build/background-lifecycle
- Sign in quickstart: https://hub.evenrealities.com/docs/get-started/quickstart/sign-in
- Hardware quickstart (Developer Mode): https://hub.evenrealities.com/docs/get-started/quickstart/hardware
- Local testing (QR): https://hub.evenrealities.com/docs/test/local-testing
- Private testing: https://hub.evenrealities.com/docs/test/private-testing
- Simulator: https://hub.evenrealities.com/docs/test/simulator
- App submission: https://hub.evenrealities.com/docs/ship/app-submission
- FAQ: https://hub.evenrealities.com/docs/reference/faq
- npm SDK: https://www.npmjs.com/package/@evenrealities/even_hub_sdk
- npm CLI: https://www.npmjs.com/package/@evenrealities/evenhub-cli
- npm simulator: https://www.npmjs.com/package/@evenrealities/evenhub-simulator
- Official templates: https://github.com/even-realities/evenhub-templates
- Official Claude Code plugin: https://github.com/even-realities/everything-evenhub
- Official G1 demo app: https://github.com/even-realities/EvenDemoApp
- Even Realities product page: https://www.evenrealities.com/smart-glasses
- Even Realities notifications support: https://support.evenrealities.com/hc/en-us/articles/14274501482639-Notifications
- Even Hub launch news: https://androidguys.com/news/even-realities-even-hub-app-store-for-g2-smart-glasses-launches/
- Developer tutorial (Nervegna): https://nervegna.substack.com/p/living-with-and-building-for-the
- Developer tips (dev.to): https://dev.to/yokomachi/got-an-even-g2-build-your-own-apps-hands-on-impressions-and-dev-tips-1glp
- Community list: https://github.com/pangoleen/awesome-even-realities-g2
- even-g2-protocol: https://github.com/i-soxi/even-g2-protocol
- g2-kit: https://github.com/Commute773/g2-kit
- g2-kit gotchas: https://github.com/Commute773/g2-kit/blob/main/ble/docs/gotchas.md
- OpenEvenSdk: https://github.com/Thepizzapie/OpenEvenSdk
- even CLI: https://github.com/aluminumio/even
- Tom's Guide review: https://www.tomsguide.com/computing/smart-glasses/even-realities-g2-smart-glasses-review
- TechCrunch review: https://techcrunch.com/2026/07/11/smart-glasses-without-a-camera-even-realities-bets-productivity-beats-recording-everyone/
- Team summary of bluebook: [bluebook-reference.md](bluebook-reference.md)
