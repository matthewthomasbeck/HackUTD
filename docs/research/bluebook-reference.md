# bluebook: a reference G2 app

Source: https://github.com/rishabhroyy/bluebook, shared by Cayden on 2026-11-07, read the same day (latest commit 2026-10-18).
bluebook teaches hands-on tasks one step at a time on Even Realities G2 glasses.
It is a working example of a custom G2 app, so it answers many "how do we put our view on the glasses" questions.

## License

The repo has no LICENSE file, so by default the code is not licensed for reuse.
Use it to learn the SDK patterns, and write our own code against the official SDK.
Do not copy its files unless the author grants permission.

## How a G2 app works (from bluebook's code and docs)

- The glasses app is a web page (TypeScript + Vite) that runs in a WebView inside the Even Realities phone app.
  The glasses only render containers and send input over Bluetooth.
- It uses the official Even Hub SDK from npm: `@evenrealities/even_hub_sdk` (bluebook pins 0.0.16), plus `@evenrealities/evenhub-cli` and `@evenrealities/evenhub-simulator`.
- Development: run the Vite dev server, show a QR code with the CLI (`evenhub qr --url ...`), and scan it in the Even Realities app to load the page.
  A simulator runs the app with no glasses.
- Installable builds are packaged as `.ehpk` files for the Even Hub beta, with an `app.json` manifest that declares permissions (network with a URL whitelist, glasses microphone).
- bluebook needed no Even Realities API key.
  Its only keys were for its own AI models.
- bluebook keeps the glasses app thin: a laptop server sends page layouts and text over a WebSocket, and the app only renders them and sends input back.
  This pattern fits our project: our server or SpacetimeDB client decides what to show, and the glasses app renders it.

## Display and input facts (bluebook's DESIGN.md, partly community-measured)

- Display: 576x288, 4-bit greyscale shown in green, and black is see-through.
- No HTML layout on the glasses: at most 4 image containers and 8 text or list containers, at absolute positions, with exactly one container that captures input.
- Image containers go up to 288x144 each.
  Text holds up to 1000 characters on build and 2000 on update, in one built-in font with no size control.
- Update costs (community measurements): text update about 83 ms, page rebuild about 165 ms, image about 104 ms plus 3.9 ms per KB, so about 5 image updates per second at best.
  Image sends cannot overlap, so writes go through one queue.
- Input events come from the left and right temple touchpads and from the R1 ring (`TOUCH_EVENT_FROM_RING`), so ring taps can drive our app.
- The glasses microphone is available with a permission.
- The glasses report IMU data (`imuControl`, `IMU_DATA_REPORT`), which could estimate head turns.
- Lifecycle: on Android the WebView may be killed when the phone locks, so the app must reconnect.
  The root page must exit with `shutDownPageContainer(1)` on double tap, or the Even Hub store rejects the app.

## Pointing at things

bluebook's experimental Part 3 keeps a highlight on a real object as the wearer moves.
The G2 has no camera, so it uses an iPhone with LiDAR and the TrueDepth camera to track the wearer's head from outside, which is complex.
For our project, a simpler approach is enough: compute the distance and compass bearing from the operator's phone GPS to each survivor, and show text plus an arrow image ("Nearest critical: 40 m, NE").
The arrow can turn with the phone's compass heading, or with the glasses' IMU if a spike shows it is stable enough.

## What this means for our glasses view

- Difficulty: low to medium.
  Static and live-updating text is the easy part, an arrow image is a small extra, and ring input is supported.
- Layout idea within the limits: one text container for "2 CRITICAL within 0.3 mi", one for the nearest survivor (distance, direction, breathing, confidence), one dim status line, and one image container for the arrow.
- Accounts and keys: the Even Realities app on a phone, and Even Hub access only if we want an installable `.ehpk`.
  The QR sideload is enough for a demo.

## Second reference: tesla-even-g2 (a live map on the G2)

Source: https://github.com/nickustinov/tesla-even-g2, shared by Cayden on 2026-11-07, read the same day (latest commit 2026-05-14).
It controls a Tesla from the G2 and shows a live map of the car's location.
It also has no LICENSE file, so learn from it and do not copy its code.

How its map works (`g2/api.ts`):

- It loads a 3x3 grid of free CartoDB "dark matter" map tiles around the car (`https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png`, zoom 15).
  The README says these need no API key, but on 2026-11-07 a test tile came back watermarked "API KEY REQUIRED", so CARTO now needs a key (see `docs/specs/glasses.md`).
- It draws the tiles onto a browser canvas, crops a 200x216 window centred on the car, and draws a ring marker for the car.
- It splits the picture into two 200x108 halves, because one image container holds at most 288x144, and sends each half as a PNG.
- It uses `@evenrealities/even_hub_sdk` (0.0.10) and an `even-toolkit` npm package, with React.

What this means for our map view:

- A 2D map with survivor markers is realistic on the G2: dark tiles suit the display, because black is see-through and the map shows as green lines.
- A full-screen map (576x288) would take all 4 image containers (four 288x144 tiles), which leaves the text containers for the count and directions.
  Whether image black pixels hide text drawn under them is not known (a spike bluebook lists as open), so test the overlay or keep the text in its own band.
- Inference from tile maths: at zoom 15 near Dallas (latitude about 33 degrees) one pixel is about 4 m, so a 288 pixel wide map covers about 1.2 km.
  A 0.3 mile radius is about 1 km across, so it fits the width of one 288x144 image but not its height (144 pixels is about 0.6 km).
  Stack two images into a 288x288 square, or use zoom 14 (about 8 m per pixel) on one image.
- Each image update costs about 100 ms or more, so redraw the map only when markers change, not every second.
- Markers can be drawn on the canvas before sending: a filled ring for critical survivors, a hollow ring for others, and a dot for the operator.
- Map tiles need internet.
  A real disaster site may have none, so pre-download the tiles for the area before the demo.
- CARTO and OpenStreetMap require attribution ("© OpenStreetMap contributors, © CARTO"), and CARTO's free basemaps have usage terms.
  Check them before relying on the tiles beyond the hackathon.
