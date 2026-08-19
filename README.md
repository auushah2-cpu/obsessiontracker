# Obsession Meter (SillyTavern extension)

A floating panel that tracks named stats per character — love, trust,
anger, possession, plus two always-present headline meters:
**Obsession** (12 hearts — the more filled, the further gone the
character is) and **Sanity** (a 0–100 bar that starts full and erodes
as things get worse). A character card moves its own stats by
emitting a tag in its reply; you never touch the numbers by hand
unless you want to.

This is a fully standalone extension — its own folder, its own
manifest, its own tag namespace (`STATS`). It doesn't require, share
state with, or conflict with any other extension (including a
phone/social-style one) — install and run it entirely on its own, or
alongside anything else.

## Install

1. In SillyTavern, go to **Extensions -> Install extension**, and
   either:
   - paste the folder path if you're loading it locally, or
   - zip this folder and use "Load from file" (method depends on your
     ST version — check Extensions > Manage extensions for the exact
     import flow on yours).
2. Alternatively, drop this whole `obsession-tracker` folder into
   `SillyTavern/public/scripts/extensions/third-party/`, then restart
   ST and enable it from the Extensions panel.
3. A single heart-crack button ("Obsession Meter") appears pinned
   near the top-right of the screen — click it to open/close the
   panel. It owns its own fixed position rather than living inside
   any SillyTavern-internal container, so it can't be broken by a
   theme that restructures ST's own icon row.
   - Drag the **button** anywhere; it remembers where you drop it.
   - Drag the open **panel** by its header bar to reposition it
     independently of the button.
4. Can't find the button? Three more ways around it, from quickest
   to most reliable:
   - Type `/om` in the chat box and send it. This opens the panel
     directly and doesn't depend on the button (or any UI element)
     existing or being visible at all — the most reliable option if
     the button just never renders for you (this can happen on some
     mobile browsers).
   - Open **Extensions** in ST's own left sidebar — there's an
     **Obsession Meter** drawer there with an "Open panel" button
     that does the same thing, plus a "Reset button/panel position"
     button that snaps both back to their default spot. That drawer
     also has its own full copy of every setting below, so you never
     strictly need the floating panel just to configure things.
   - If the button/panel are genuinely not there at all (not just
     mispositioned), check the browser console for `[ObsessionMeter]`
     messages — if you don't see `[ObsessionMeter] loaded.`, the
     extension isn't initializing on your ST build at all, which is a
     different problem than positioning (worth reporting, with
     whatever error the console shows).

## Teach your character to use it

Add something like this to the character's Author's Note, system
prompt, or a World Info entry:

```
Track your feelings toward {{user}} using a stats tag. At the end of
a reply where your feelings shift, add a line like:
[STATS:YourCharacterName] love+5, possession+3, obsession+1, sanity-8
Use + to increase, - to decrease, = to set an exact value. Obsession
moves in whole hearts (0-12) — use +1 sparingly, for moments that
actually mark an escalation, not every message. Sanity starts at 100
and only goes down when something genuinely shakes you. You can list
several stats in one tag, comma-separated. Only emit this when
something in the scene actually justifies a shift — not every message
needs one.
```

Example output the extension will catch:

```
[STATS:Seek] obsession+1, possession+5, trust-2
```

or, all in one:

```
[STATS:Aiden] love+3, trust+1, anger-4, possession+6, obsession+1, sanity-15
```

## Diary — [DIARY:Name]

A character can also write occasional diary entries:

```
[DIARY:Aiden] Dear diary, {{user}} smiled at someone else today. I don't
think they meant anything by it. I'm sure they didn't. I just need to
know for certain.
```

Everything after the tag (including line breaks) is captured as the
entry, up to the next `[STATS:...]`/`[DIARY:...]`/`[INVENTORY:...]`
tag or the end of the message — so multi-paragraph entries work fine.
You can also write an entry by hand from the Diary tab in a
character's panel (useful for testing, or just journaling for them
yourself).

Each entry **snapshots that character's sanity and obsession at the
moment it's written** and keeps that snapshot forever. The entry
renders as its own torn, slightly-tilted notebook page — ruled lines,
a red margin, a row of spiral-binding holes across the top of the
list — and the page's look is locked to how far gone the character
was *then*:

| Tier | Trigger (blend of low sanity + high obsession) | Look |
|---|---|---|
| 0 — steady | mostly calm | plain ink on clean ruled paper, legible |
| 1 — uneasy | some strain | same hand, a faint restless sway animation |
| 2 — unraveling | notably far gone | switches to the bundled **Yandere** display font, the page itself picks up a warm red stain, words individually jittered |
| 3 — feral | deep in it | bigger Yandere text on a darker scorched page, heavier red glow, trembling words, occasional oversized/red-tinted emphasis |

This means an entry written during a spiral still reads as unhinged
even after the character calms back down later in the story — same as
a real diary page doesn't rewrite itself.

Add a line like this to the character's prompt if you want them to
use it on their own:

```
Occasionally — not every message — write a private diary entry with
[DIARY:YourCharacterName] followed by the entry text. Let it reflect
your actual state of mind at that moment.
```

## Inventory — [INVENTORY:Name]

Characters can also carry items, shown as a pixel-art icon grid:

```
[INVENTORY:Aiden] add "Bloodstained Locket" :: A locket kept close to
the heart, stained with something never explained.
[INVENTORY:Aiden] remove "Bloodstained Locket"
```

- `add "Item Name" :: description` — description is optional.
- `remove "Item Name"` — matches by name, case-insensitive.
- Multiple actions in one tag are **semicolon-separated** (not comma —
  that way a description can use commas freely):
  `add "Locket" :: a gift, worn daily; remove "Old Photo"`.
- Items can also be added by hand from the Inventory tab.

**Pixel-art icon generation** is off by default. It doesn't generate
images itself — it triggers whatever image-generation extension you
already have configured in SillyTavern (e.g. the built-in Stable
Diffusion extension), via a slash command. Turn it on in Settings and
you can customize:
- the **slash command template** (`{prompt}` gets substituted), and
- the **prompt template** (`{item}` gets substituted with the item's
  name; defaults to a pixel-art/16-bit/transparent-background prompt).

Because SillyTavern's slash-command return shape varies across
versions and image-gen setups, this is best-effort: if it can't
extract a usable image URL back, the item just keeps a placeholder
icon (and shows a warning icon rather than silently pretending it
worked). From any item's detail view you can always **paste an image
URL by hand** instead — that always works regardless of whether
auto-generation is enabled or working for your setup.

## Obsession (hearts) and Sanity — how they're different from other stats

These two are always present on every tracked character — they're not
part of the configurable stat list and can't be removed from
Settings, since they're the point of the tracker.

- **Obsession** is a hard 0–12 scale, always, regardless of whatever
  min/max range you've set for ordinary stats. It renders as 12 heart
  icons instead of a bar. `obsession+1` fills exactly one heart;
  there's no fractional or percentage version of it. New characters
  start at 1 heart (not 0), on the read that a character worth
  tracking this way is rarely starting from a total void. As the
  count climbs past 9, the filled hearts pick up a slow red glow/flicker
  in the panel — the display itself should feel like it's escalating,
  not just report a bigger number.
- **Sanity** is a separate fixed 0–100 bar (not affected by the
  ordinary-stat min/max setting either). It starts at 100 for every
  new character and only moves when the card explicitly sends
  `sanity+`/`sanity-`/`sanity=`. There's no automatic link between
  obsession climbing and sanity dropping — if you want them to move
  together, have the character send both in the same tag when a scene
  calls for it (`obsession+1, sanity-10`), rather than expecting the
  extension to infer the connection.
- Both always render at the top of a character's meter list, ahead of
  whatever ordinary stats are configured.

## Tag syntax

`[STATS:CharacterName] key(op)value, key(op)value, ...`

- `op` is `+`, `-`, or `=`. `+`/`-` adjust the current value; `=` sets
  it exactly.
- A bare key with no operator or number (just `obsession`) is treated
  as `+1`.
- Ordinary stats are clamped to the configured range (0–100 by
  default). Obsession is always clamped to 0–12 hearts; sanity is
  always clamped to 0–100. A character can't push any of them past
  their ceiling or floor no matter how large a number it sends.
- Stat keys aren't fixed to `love`/`trust`/`anger`/`possession` —
  those four ship as the default ordinary set (obsession and sanity
  are separate and always present, as above) — but any key name a
  character uses gets created automatically the first time it shows
  up, and then appears in Settings for you to rename, recolor, or
  remove.
- Each character tracked this way gets their own independent set of
  meters — Seek's `obsession` and some other character's `obsession`
  never share a value.
- Malformed tokens (typos, unparseable syntax) are silently skipped
  and logged to the browser console rather than breaking the whole
  tag — one bad token in a comma list doesn't stop the rest from
  applying.

## Settings (gear icon in the panel header, or the Obsession Meter
drawer in ST's Extensions panel)

Both places show and edit the exact same settings — the drawer is
just a second, always-reachable way in if the floating button/panel
isn't cooperating.

- **Tracked stats** — the default four ordinary stats, plus anything a
  character has introduced on the fly. Obsession and sanity don't
  appear here since they're not removable. Remove a chip to stop
  tracking that stat going forward (existing characters keep their
  historical value for it, it just won't show as a bar until it's
  re-added).
- **Range** — the min/max for ordinary stats only. Defaults to
  0–100. Does not affect obsession (always 0–12) or sanity (always
  0–100).
- **Starting value for new characters** — the value every *ordinary*
  stat starts at the first time a character is tracked. Defaults to
  20 (rather than 0), on the read that most fictional relationships
  don't start from an absolute void. Obsession always starts at 1
  heart and sanity always starts at 100, regardless of this setting.
- **Idle decay toward midpoint** — optional. When on, ordinary stats
  and sanity drift by a configurable amount per message toward their
  own midpoint if nothing is actively pushing them — a way to
  represent feelings cooling off, or a shaken character steadying
  out, between events, rather than a value staying frozen forever
  once set. Obsession hearts never decay under this setting — they
  only move when the card explicitly sends the tag, since a heart
  count quietly draining back down between sessions would undercut
  the whole point of an escalating tracker.

## Data & persistence

- Meter **values** are stored per chat (in that chat's metadata), so
  different roleplays don't bleed stats into each other.
  - Reminder for group chats / multiple concurrent stories: this is
    inherent to how SillyTavern scopes chat metadata, not something
    this extension changes.
- **Settings** (tracked stat list, range, decay config, panel/button
  position) are stored globally, same as most ST extensions — they
  follow you into every chat.
- A rolling log of the last 200 stat changes is kept per chat (not
  currently shown in the UI, but there for anyone who wants to extend
  the panel with a history view).

## Notes

- Fixed (1.6.3): the `click` fallback that's supposed to catch
  environments where Pointer Events never fire at all was itself
  broken. It worked by calling the same `endGesture()` used by
  pointerup/touchend, which only does anything while a gesture flag
  (`gestureResolved`) is `false` — but that flag only ever gets set to
  `false` from inside the pointerdown/touchstart handlers. On a
  WebView/browser that dispatches neither Pointer Events nor Touch
  Events for the button at all (still rare, but distinct from — and
  not covered by — the 1.6.2 fix, which only helped when pointer
  events specifically were missing while touch events still worked),
  no gesture was ever started, so `gestureResolved` was still `true`
  when `click` arrived, and the "backstop" silently no-opped: no drag,
  no tap, no console error. Fixed by having the click handler check
  whether pointer or touch ever engaged the element at all; if
  neither did, click is treated as the tap directly instead of being
  routed through a gate that nothing ever opened.
- Fixed (1.6.2): the button/panel's tap detection was built entirely
  on Pointer Events (`pointerdown`/`pointermove`/`pointerup`). Most
  browsers support these, but some WebViews — a real chunk of how
  SillyTavern actually gets used on mobile — never fire them at all.
  On one of those, tapping the button did *nothing whatsoever*: no
  drag, no tap, no error, nothing in the console, because none of the
  event handlers ever ran in the first place. There's now a plain
  `click` fallback that only engages if pointer events genuinely never
  fired on that element, so it can't double-fire on browsers where
  pointer events work normally. Also wrapped `setPointerCapture()` in
  a try/catch, since a capture failure on some browsers could throw
  uncaught and cut a tap off partway through handling it.
- Fixed (1.6.1): the message de-duplication guard (added to stop
  `MESSAGE_RECEIVED`/`CHARACTER_MESSAGE_RENDERED` from double-applying
  the same message) keyed purely on the message's **index**, ignoring
  its actual text. On setups where a message streams/finishes in
  stages, an early firing at index N with partial, tag-less text
  "claimed" that index — so the later firing at the *same* index,
  once the full text (including any `[STATS:...]`/`[DIARY:...]`/
  `[INVENTORY:...]` tag) had actually rendered, was wrongly treated as
  a duplicate and dropped. Nothing errored; the button, panel, and
  tabs all worked fine — the tag itself was just never read, which is
  exactly why the diary (or stats/inventory) could look like it wasn't
  "showing up" with no console error to point at. The de-dup signature
  now folds in the text length too, so two firings only count as
  duplicates when their content actually matches.
- Fixed (1.3.2): SillyTavern's real `getContext()` names the event-type
  map `eventTypes` (camelCase) — confirmed straight from ST's own
  `st-context.js` source. This file was written against `event_types`
  (snake_case), which some ST docs/examples also (incorrectly) show. On
  a build where the object only has `eventTypes`, `context.event_types`
  was `undefined`, so message listeners never got registered at all —
  **no `[STATS:...]`/`[DIARY:...]`/`[INVENTORY:...]` tag was ever read**,
  while the button, panel, and settings all worked completely normally
  since they don't touch that field. This is almost certainly why it
  could look entirely fine on inspection while doing nothing. Both
  spellings are now accepted, and a missing eventTypes/eventSource now
  shows the same loud red banner as any other load failure instead of
  only a console warning.
- Fixed (1.3.1): the heart-crack button's own click handler was being
  swallowed on every single press, not just drags. Dragging is
  implemented on pointerdown/pointerup, and the old drag-end handler
  ran (and set a click-suppressing flag) on every pointerup regardless
  of whether the pointer actually moved — and since the browser fires
  `click` immediately after `pointerup`, before that flag's 50ms
  timeout ever clears, a plain tap could never open the panel. Fixed by
  only treating it as a drag (and only suppressing the click) once the
  pointer has moved past a small threshold.
- Fixed: the extension grabbed SillyTavern's context — including
  the `chat` array and `chat_metadata` object — exactly once at load
  time and cached it forever. ST doesn't mutate those in place when you
  switch chats or characters, it replaces them with new objects, so a
  one-time snapshot silently stops matching whatever chat is actually
  on screen (this is why ST's own extension docs tell you to listen for
  `CHAT_CHANGED`). The result: stat tags looked like they were being
  ignored entirely — no console errors, panel and button both present
  and working — because every read/write was quietly happening against
  an orphaned, stale chat that wasn't the one you were looking at. Chat
  and chat-metadata access now always re-fetches fresh via
  `SillyTavern.getContext()` at the point of use instead of trusting the
  boot-time snapshot, and the panel now also resets/repaints on
  `CHAT_CHANGED` so a stale character/tab from the previous chat doesn't
  linger.
- Fixed: a duplicate-processing bug where, on ST builds that fire both
  `MESSAGE_RECEIVED` and `CHARACTER_MESSAGE_RENDERED` for the same
  message, every tag in that message got applied twice (a `love+5`
  landing as +10, a diary entry or inventory item getting added
  twice, etc). Incoming messages are now de-duplicated so each one is
  only processed once no matter how many ST events fire for it.
- Fixed: the settings gear icon sat inside the panel's draggable
  header without being excluded from the drag hit-area, so it could
  eat the click that was meant to open Settings. It's now excluded
  from dragging like the rest of the interactive controls.
- This extension only reacts to `[STATS:...]`, `[DIARY:...]`, and
  `[INVENTORY:...]` tags. It doesn't read narration or dialogue to
  infer feelings, entries, or items on its own — the character card
  has to actually emit a tag for anything to happen. If a character
  never sends any tags, they'll show up with just their starting stat
  values, an empty diary, and an empty inventory.
- Diary entries and inventory items are stored per chat, same as
  meter values — different roleplays don't bleed into each other.
- Inventory pixel-art generation depends on an image-gen extension
  already being set up in SillyTavern; this extension can't generate
  images on its own.
- If you're running this alongside a phone/social extension or
  similar, there's no shared tag namespace to worry about —
  `STATS`/`DIARY`/`INVENTORY` don't collide with `TEXT`/`POST`/etc.
