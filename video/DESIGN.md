# Flock — product film: design spec

Mode: autonomous creation (the user asked for top quality, "treat it as your resume").
Engine: hand-written HTML/CSS/SVG/JS (no Remotion, per the user), rendered frame by frame
through Chrome's DevTools protocol (`tools/capture.mjs`), encoded with ffmpeg.

## 1. Product brief

- **Product.** Flock 0.1.2: a Windows app that runs Claude Desktop with several Claude
  accounts side by side, each in its own window, signed in once and remembered.
- **Audience.** Developers, designers and power users with more than one Claude account
  (personal, work, clients) on Windows; people landing on the GitHub README or a launch post.
- **Use.** Explainer / launch film: what Flock is, how you use it, what it does.
  1920×1080, 60 fps, 95.5 s, English on-screen type, music + SFX, no voice-over.
- **One-line promise.** Every Claude account, side by side.

### Must-show features (all from README / src)
| # | Feature | Evidence in the product |
|---|---|---|
| F1 | One Claude window per account, side by side; signed in once | README "Using it", main/claude.js |
| F2 | The island: one mascot per account at the top of the screen; hover to open list + detail | island.css/js |
| F3 | Open an account / open all (▶▶, `A`) | island.js `openAccount`, `openAll` |
| F4 | Telling windows apart: "Work — Claude" titles, accent edge (focused glows), taskbar button per account, island shows the focused account | identity.js, edge.css, README |
| F5 | Session peek: recent Code sessions, click to open in that account's window, New | sessions.js, island.js |
| F6 | Add account: name, colour, `~/.claude` Shared / Its own / Same as… | settings.html/js |
| F7 | Sign in once: e-mail / Google links routed to the waiting window, not Main | links.js, linkwatch.js, README |
| F8 | Steps aside for other apps; rest on the top edge to bring it back | wintrack.js, `islandYield` |
| F9 | Keyboard: Ctrl+Alt+F, 1–9, A | island.js keydown, README |
| F10 | Mascot states: asleep (closed), launching (walks), awake, alert (needs you) | mascot.js |

### Data and brand rules
- Accounts and sessions are fictional (Flock's own preview-mock data, minus e-mail addresses).
- No Anthropic artwork: Claude windows are neutral stand-ins; only Flock's marks (title, edge)
  carry account colour. Nothing is drawn *over* a window's content (user rule: no overlays).
- No Clawd / Mochi. Flock's own "Beacon" mascot is the character of the film.
- End card says Flock is not made by or affiliated with Anthropic.

## 2. Decisions (request → execution)

| Requirement | Decision |
|---|---|
| "Top tier, SaaS style, cursor showing the app" | Screen-Studio-style desktop: real Flock UI, a Windows pointer with arcs, presses and ripples, camera pushes that follow the action |
| "Pure code, no Remotion" | Own engine (`film/engine.js`): every pixel is a pure function of time; CSS animations paused and seeked via Web Animations API; capture via raw CDP |
| Real UI, not a hand-made replica | Flock's actual CSS (`tools/scope-css.mjs` copies + scopes `src/renderer/*.css`), island/settings markup mirrored from island.js / settings.html, mascot SVG ported verbatim |
| Explain *what it is* | 6.6 s hook (the sign-out/sign-in problem) → brand → island |
| Music | "Cat Walk" — Arulo (Mixkit Stock Music Free License, https://assets.mixkit.co/music/371/371.mp3), 129.95 BPM, grid fitted with `tools/beats_np.py` (median residual 5 ms). Cuts and slams sit on bars |
| SFX | Mixkit cinematic set from the skill library (whoosh / impact / riser / sparkle / transition + keyboard, click); no game UI sounds |

### Conscious deviations from the video-shotcraft pipeline
- **No Remotion** (user's instruction): the shot cards' demo TSX could not be dropped in; their
  tuned numbers (from each card's parameter table) were ported into the film's own engine —
  e.g. cloner offsets 64·k/−34·k + 16° turn, deal curve `bezier(0.3,0,0.2,1)` with settle,
  ripple out-cubic grow / linear fade, 8-frame thumb slide, landing ease `bezier(0.34,1.4,0.44,1)`.
- **No separate HTML styleframe**: the film *is* HTML; its first stills (out/qa) served as the
  styleframes and were reviewed before the other scenes were built.
- **Real UI by real CSS, not by screenshots**: Flock's own stylesheets render the island and the
  settings window live, so they stay sharp at 3× zoom and can react to the pointer.

## 3. Visual direction (from Flock's own tokens)

- **Palette.** Void `#060708`, island `#000`, cards `#0e0f11 / #141518`, ink `#f5f6f8`,
  dims `#9398a1 / #6b7079`. Account colours are the only saturated hues:
  Main `#D97757`, Work `#38BDF8`, Client A `#4ADE80`, Research `#C084FC`, Side project `#FACC15`.
  Wallpaper = the design-preview backdrop in island.css (purple `#3b2f63` + teal `#1d4a5c` on graphite).
- **Type.** Segoe UI Variable Display 600 for titles (−0.03 em), Segoe UI Variable Text for UI,
  Cascadia Mono for kickers, keys and paths. All from tokens.css.
- **Material.** Smooth Coucou-style SaaS: rounded 8–30 px, hairlines at 4–8 % white,
  soft pools of account colour, faint film grain (6 %, 24 fps).
- **Motion personality** — "smooth, friendly, precise":
  UI = Flock's spring `cubic-bezier(0.3, 1.2, 0.4, 1)` (island opens 0.46 s, like the app);
  text = expo-out rise + unblur, 0.7 s, 55–70 ms stagger; camera = `cubic-bezier(0.45,0,0.15,1)`
  glides, no shake; mascots = their own squash-and-stretch keyframes from tokens.css.
  Holds: wordmarks ≥ 1 s, batch moves end with ≥ 0.5 s stillness.

## 4. Feature → shot map (shot cards used as motion grammar)

| Feature | Shot | Grammar (video-shotcraft card) |
|---|---|---|
| Problem | S1 hook | pill-slot-cycle (account name slot, accelerating), title-demote-to-label |
| What it is | S2 brand | cloner-depth-echo (one window → a flock of windows) → morph into mascots → wordmark hold |
| F2 | S3 island hero | transition-travel (mascots fly into the island) + input-trigger A (pointer performance, push-in) |
| F3/F10 | S4 open account | pointer click → launching walk → window grows out of the island |
| F3/F1 | S5 open all | deck-deal-flyin (windows dealt into a 2×2 grid, accelerating, 0.5 s rest) |
| F4 | S6 identity | push to the accent edge + one-line callouts in the wallpaper band (never over a window), Alt+Tab, taskbar preview |
| F5 | S7 session peek | row-embed (rows drop, flatten, seam in the account colour), click-through, fade-through content swap |
| F6 | S8 add account | type-and-filter typing, segmented-thumb-hero on Shared / Its own / Same as… |
| F7 | S9 sign in once | paper-plane-messenger / flyline (link pill re-routed by Flock) |
| F8 | S10 out of the way | island tuck + dwell return (a ring fills while the pointer rests: "Rest on the top edge") |
| F9 | S11 keys | input-trigger C (keycap smash), on beats into the drop |
| All | S12 finale | outro-group-photo-launch (riser → impact → sparkle), hold ≥ 1 s |

## 5. Storyboard (film grid `B(n) = 0.1507 + n·0.46171 s`, bar = 4 beats)

Music sync note (from the independent review): the first beat grid was fitted on the hi-hats.
Measured on the kick band, the track is 130 BPM with kicks 148–176 ms ahead of the film grid, so the
music starts **0.162 s** into the film (`audio.js`, `MUSIC`): every bar cut then lands within ±16 ms
of its kick (< 1 frame at 60 fps) without moving any tuned visual timing.

| # | Time (s) | Music | Shot | Key action |
|---|---|---|---|---|
| S1 | 0.0 – 6.6 | intro | Hook | "Got more than one Claude account?" → one window cycles Personal / Work / Client through sign-out/sign-in, faster each time: "One window. One account at a time." |
| S2 | 6.6 – 14.9 | intro | Brand | Window clones into four ("Main — Claude"… each edge lights its colour) → windows fold into four mascots → white Flock mascot + **Flock** wordmark, "Every Claude account, side by side." hold ~2 s |
| S3 | 14.9 – 22.3 | beat in | Island | Mascots fly up into the compact island on a fresh desktop; pointer rises, island springs open (0.46 s), push-in; hover Main → Work → Client A |
| S4 | 22.3 – 27.9 | groove | Open | Client A (asleep) → Open ↵ → wakes, walks (launching) → its window grows out of the island, green edge; island names it |
| S5 | 27.9 – 33.4 | **full @29.70** | Open all | ▶▶ clicked on the downbeat → three more windows dealt into a 2×2 grid, landing 0.33 s then 0.22 s apart (accelerating), mascots all awake |
| S6 | 33.4 – 44.5 | full | Identity | Click into Work: edge glows, island says "Work"; 3× close-up holds ~2.6 s with two callouts; Alt+Tab (Work → Research → Client A → Main); taskbar close-up, hover preview ~1.2 s, click Client A |
| C1 | 44.5 – 46.3 | dip bar | Card | "Where was I?" (blue mascot glances around) |
| S7 | 46.3 – 57.4 | full | Session peek | Hover Work → rows embed; click "Auth middleware refactor" → opens in Work's window; New → a fresh Code session |
| C2 | 57.4 – 59.3 | | Card | "One more account?" (the new yellow mascot hops) |
| S8 | 59.3 – 68.5 | breakdown | Add account | Settings → Add account; type "Side project"; yellow; Its own ~/.claude; Add & sign in |
| S9 | 68.5 – 77.7 | → build @74.0 | Sign in once | Continue with email → mail → the link pill flies to the island (caught) → into the waiting window; caption: "Sign-in links skip Main and reach the right window." Then a close look at the island naming "Side project" |
| S10 | 77.7 – 83.3 | build | Out of the way | Maximized browser: island tucks away, click passes through to a tab; rest on the edge → back |
| S11 | 83.3 – 88.8 | build | Keys | Ctrl · Alt · F (the compact island drops in, its flock wakes) → 1 · 2 · 3 → A, on beats |
| S12 | 88.8 – 95.5 | **drop @88.80** | Finale | Group photo: island, five mascots, windows behind, **Flock** slam, "All your Claude accounts. One flock.", footer + disclaimer, hold, fade |
