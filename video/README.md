# Flock — the film

A ~96 s product film for Flock, written as plain HTML/CSS/SVG/JS (no video
framework). Every frame is a pure function of time, rendered by headless
Chrome and encoded with ffmpeg. Flock's island and settings window are drawn
with the app's own CSS (`film/vendor/`, copied from `src/renderer`).

## Preview

```bash
node video/tools/serve.mjs 5190
```

Then open http://127.0.0.1:5190/film/ — space plays (with sound), ← → step a
frame, shift+← → a second, drag the bar to scrub. `?t=48.2` opens at a time.

## Render

```bash
node video/tools/render-final.mjs
```

That renders 60 fps at 2× supersampling in 16-second chunks (`out/parts/`; an
interrupted render resumes from the chunks already done), joins them without
re-encoding, mixes the soundtrack and writes `out/flock-promo.mp4` (~25 min).

`capture.mjs stills 12.5 40` saves single frames to `out/qa/`; `capture.mjs video
--fps 30 --scale 1 --out preview` makes a quick silent preview. ffmpeg comes from
`FFMPEG` (default: the copy bundled with Stremio if installed, else `ffmpeg` on PATH);
Chrome from `CHROME`.

The music and sound effects aren't in the repo: Mixkit's licence allows them inside
the film but not as loose files. To render, download them from
[Mixkit](https://mixkit.co) into `public/audio/` under the names `film/audio.js` uses
(the music is "Cat Walk" by Arulo, https://assets.mixkit.co/music/371/371.mp3).

## Checks

`tools/qa_motion.py` (pops, stalls, seams), `tools/qa_sync.py` (cuts vs. kicks —
run it on `out/stem-bgm.wav` from `MIX_ONLY=bgm node video/tools/mix.mjs`, since
SFX attacks fool it on the full mix), `tools/qa_mix.py` (SFX vs. music levels).

## Where things are

| File | What |
|---|---|
| `film/engine.js` | time, easing (CSS-exact cubic-bezier), springs, keyframes, scene timeline, cue sheet |
| `film/flock-ui.js` | the mascot (mascot.js geometry, keyframes seeked per frame), the island, the settings window |
| `film/desk.js` | desktop + camera, Claude stand-in windows with Flock's accent edge, pointer, taskbar, Alt+Tab, captions |
| `film/s-*.js` | the scenes, in order: open, desk1, cards, desk2, keys, finale |
| `film/audio.js` | the cue sheet (BGM + SFX pinned to scene events) |
| `film/data.js` | accounts, sessions and the music's beat grid |
| `tools/` | static server, frame capture, mixer, CSS scoping, QA helpers, beat analysis |
| `DESIGN.md` | brief, decisions, visual direction, shot map, storyboard |

## Credits

Music: "Cat Walk" by Arulo (Mixkit Stock Music Free License). Sound effects:
Mixkit (Mixkit Sound Effects Free License). Flock is not affiliated with Anthropic;
the Claude windows in the film are neutral stand-ins, not Claude's interface.
