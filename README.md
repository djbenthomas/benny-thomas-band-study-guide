# Benny Thomas Band — Study Guide

Private mobile-friendly study guide for the **Aug 29 Nashville original-song showcase**.
**Study mode** (full chart + audio + band notes) and **Live Scroll mode** (big chords/lyrics that auto-scroll on a phone while the band plays), plus shared **voting** and a **setlist builder**.

Live at: https://djbenthomas.github.io/benny-thomas-band-study-guide/

---

## Adding a new song (no rebuild needed)

1. Drop the MP3 into `songs/` → e.g. `songs/one-more-drink.mp3`
2. Create `songs/<song-id>.json` — copy `songs/_TEMPLATE.json` and fill it in (or just send the lyrics/chart to Dale).
3. Add one line to `songs/manifest.json`:
   ```json
   { "id": "one-more-drink", "title": "One More Drink" }
   ```
4. Commit and push. The site picks it up automatically (hard-refresh phones).

Song JSON fields: `id`, `title`, `artist`, `meta` (key, capo, bpm, timeSig, duration, ugUrl, videoUrl), `mp3` (filename only — app prepends `songs/`), `sections[]` (name, type, start/end seconds, lines), `bandNotes` (countIn, drums, bass, guitar, harmonies, stops, dynamics, solos, ending), `notes[]`.

Line types inside a section:
- Chord over lyric: `{"segments":[{"chord":"E","text":"Line one "},{"chord":"A","text":"line two"}]}`
- Plain lyric: `{"plain":"..."}` · Blank: `{"blank":true}` · Stage note: `{"comment":"..."}`
- Chord-only row: segments with empty text, e.g. `[{"chord":"D","text":" "},{"chord":"A","text":""}]`

## Editing lyrics / chords / notes

**Quick edits on any device:** tap ✏️ in the top bar. Simple format, Save (per-device). Reset restores the uploaded version.
Format: `key: E`, `capo: 2`, `bpm: 92`, `time: 4/4`, `duration: 3:04`, `ug: URL` → `## Chorus [25-45]` → lines like `[E]Line one [A]line two`; chord-only rows `[D] [A] [G] | [E] [G] [A]`; `{comment: ...}` for stage directions; `## Band Notes` with `count-in:` / `drums:` / `bass:` / `guitar:` / `harmonies:` / `stops:` / `dynamics:` / `solos:` / `ending:` lines.

**Master edits:** edit the JSON files and push — that's the source of truth for every device.

## Live Scroll Mode

- **▶ Start** = 5-second countdown, then scroll (and MP3 if loaded). **⏸** pause/resume, **↺** restart, **⏮/⏭** previous/next song.
- **Tap anywhere on the chart** to pause/resume. Swipe = manual scrolling (auto pauses ~2.5s).
- **🐢/🐇** speed, **A−/A+** font size, **☀️/🌙** dark toggle — saved per musician profile (name selector top-right, ＋ to add).
- **⛓ audio sync**: with section timing markers (`## Verse 1 [8-32]`) the chart follows the MP3 exactly — seeking/rewinding jumps the chart to the right place. Without timings it still follows the MP3 proportionally; with no MP3 it scrolls at the set speed.
- Screen-wake protection is on while Live mode is open (where supported).

## Voting & cross-device sync

Votes (name, 1–5 rating, Yes/Maybe/No, comments) are shared across devices:

1. **At the venue (recommended):** run `./serve.sh` on a laptop. Every phone connects to `http://<laptop-LAN-IP>:8080` — the built-in API shares all votes instantly. Zero internet needed.
2. **On the web:** the app tries a free cloud JSON store (jsonblob.com) so remote devices can sync. Some networks block it — the app falls back to on-device saving and keeps retrying. Use **⬇ Export / ⬆ Import** in the Vote tab as a manual backup.

## Setlist Builder

Drag rows (or use ▲▼) to order. Tap the time box to set each song's length (defaults to the uploaded duration). The total updates live and turns red if the showcase runs **over 25:00**. Excluded songs (checkbox) don't count.

## Running locally

```bash
./serve.sh        # starts server on port 8080 (static + vote sync)
# or: python3 -m http.server 8080   (static only)
```
The site must be served over http — `file://` won't work (fetch is blocked).

## Deploying to GitHub Pages

```bash
gh repo create benny-thomas-band-study-guide --private --source=. --push
gh api repos/djbenthomas/benny-thomas-band-study-guide/pages -X POST \
  -f 'source[branch]=main' -f 'source[path]=/'
```
Note: GitHub Pages on a **private** repo requires a paid plan. If this account is free, either the repo (and site) must be public, or keep it private and use the local-server option.

## Privacy

Optional PIN gate (🔒 top bar) — device-level, casual protection only. For real privacy use a private repo + invite-only sharing, or a password-protected host.
