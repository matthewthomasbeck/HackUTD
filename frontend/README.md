# Frontend

Browser apps read `VITE_STDB_URI` and `VITE_STDB_DATABASE` (`assess-0hw81`) from a git-ignored `.env`; copy each `.env.example` first.
All styling comes from `frontend/design-tokens/tokens.css` and follows design control in `docs/DESIGN.md`.

## `dashboard/` - Assess, the coordinator dashboard (desktop app)

Spec: `docs/specs/dashboard.md` (sections "Desktop app" and "Layout").
It runs as a desktop app (Electron) and, from the same build, in a browser.
`.env`: `VITE_STDB_URI=https://maincloud.spacetimedb.com`, `VITE_STDB_DATABASE=assess-0hw81`, `VITE_STDB_URI_LOCAL=ws://<laptop-a-ip>:3000`, and for Camera View `VITE_GLASSES_PAGE_URL` and `VITE_GLASSES_WS_URL`.

```bash
cd frontend/dashboard
npm run app                      # desktop app with hot reload
npm run app -- --db=local --local-uri=ws://127.0.0.1:3000
npm run app:pack                 # Assess.app in release/mac-arm64/ (unsigned: right-click > Open the first time)
npm run app:dmg                  # .dmg installer in release/
npm run dev                      # the same dashboard in a browser on 0.0.0.0:5180 (/?screen=A, /?screen=B)
npm test && npm run build
```

In the app, the Server menu switches between Maincloud (judging) and a local SpacetimeDB server without a rebuild.

## `glasses/` - Even Hub plugin, fallback page, phone page

Spec: `docs/specs/glasses.md`.
`.env`: `VITE_GLASSES_WS_URL=ws://<laptop-ip>:8787/glasses` (`npm run set-ip -- <ip>` writes it and `app.json`).
The pages talk to the glasses service in `backend/glasses-service/`, not to SpacetimeDB directly.

```bash
cd frontend/glasses
npm run dev                      # Vite on 0.0.0.0:5173: plugin, fallback.html, phone.html
npm run sim                      # Even Hub simulator with --automation-port 9898
npm run qr                       # QR code for the Even app developer section
npm test && npm run build
```

Fallback page: `http://localhost:5173/fallback.html?rescuer=cayden&ws=ws://localhost:8787/view` (add `&primary=1` to stand in for the glasses, `&record=1` for recording).

## `design-tokens/`

`tokens.css` and a contrast check; see `frontend/design-tokens/README.md`.
