// Obsession Meter — a floating stat-tracker panel for SillyTavern.
// Standalone extension: separate manifest/folder from any other
// extension you may also be running (e.g. Phone UI) — no dependency
// between them.
//
// Lets a character card move named stats (love, trust, anger,
// possession, or any custom set you define) via a tag in its own
// output, e.g.:
//
//   [STATS:Aiden] love+8, possession+5, trust-2
//   [STATS:Aiden] love=60
//
// Two stats are always present and specially rendered rather than
// configurable bars: "obsession" as a 0-12 heart row (more hearts =
// more insanity), and "sanity" as its own 0-100 bar that starts full
// and erodes over the story. Ordinary stats are 0-100 by default
// (configurable), clamped, persisted per chat, shown as animated
// bars in a draggable floating panel. Each character gets their own
// independent set of meters.

(function () {
  "use strict";

  // Fires the instant this file is parsed and executed by the browser
  // — before any async work, retries, or context resolution. If this
  // line never shows up in the console, the script itself never ran
  // (wrong install path, index.js 404ing, filename/case mismatch, or
  // the manifest pointing somewhere that doesn't exist) — that's a
  // loading/serving problem, not a bug in this file's logic, and no
  // amount of code here can fix it. If this line DOES show up but
  // nothing after it ever does, the problem is inside init() itself,
  // narrowed by the retry-count logs added below.
  console.log("[ObsessionMeter] index.js executing (script loaded).");

  // ---------------------------------------------------------------
  // ST module access (same defensive pattern as Phone UI: SillyTavern
  // exposes its context differently across versions/builds, so probe
  // a few known shapes rather than assuming one).
  // ---------------------------------------------------------------

  let context = null;

  // Shows a small dismissible banner at the top of the screen, in
  // addition to the console/toastr paths below. BUGFIX: previously
  // this only logged to console.error and toastr — but toastr is
  // frequently not loaded yet this early in page load, and console
  // output is easy to miss (or, on mobile, hard to even get to). That
  // meant a load failure could be completely invisible: no button, no
  // /om command, and no indication anything went wrong at all. The
  // banner below is created with plain DOM APIs and doesn't depend on
  // ST or any other library being ready, so it always shows.
  function showLoadError(message) {
    console.error(`[ObsessionMeter] ${message}`);
    try {
      if (window.toastr) {
        window.toastr.error(message, "Obsession Meter failed to load");
      }
    } catch (e) {
      /* toastr not available yet; banner below still covers it */
    }
    try {
      const d = document.createElement("div");
      d.textContent = "[ObsessionMeter] " + message;
      d.style.cssText =
        "position:fixed;top:0;left:0;right:0;z-index:2147483647;" +
        "background:#b91c1c;color:#fff;font-size:12px;padding:8px 12px;" +
        "text-align:center;font-family:sans-serif;cursor:pointer;";
      d.title = "Tap to dismiss";
      d.addEventListener("click", () => d.remove());
      document.body.appendChild(d);
    } catch (e) {
      /* if this fails too, there's nothing left to do */
    }
  }

  // BUGFIX: previously this made exactly one synchronous attempt at
  // page-load time. SillyTavern's own extension APIs
  // (window.SillyTavern.getContext) aren't guaranteed to be attached
  // the instant this script runs — on a slower load, that single
  // attempt could simply miss the window, and since nothing retried,
  // the extension silently never initialized (no button, no /om,
  // nothing in the console because showLoadError's own dependencies
  // weren't ready yet either). This now retries for ~15s against the
  // modern getContext() API, then falls back to importing ST's own
  // modules directly (for older builds that don't expose
  // window.SillyTavern.getContext at all), retried a few times too.
  //
  // THE BUG: SillyTavern's real getContext() return object names this
  // field `eventTypes` (camelCase) — see st-context.js:
  // `eventTypes: event_types`. Some of ST's own docs/examples show
  // `event_types` (snake_case) instead, which is what this file was
  // written against throughout. On any build where the object really
  // only has `eventTypes`, `context.event_types` is undefined,
  // wireEvents() below silently no-ops (see its own guard clause), and
  // MESSAGE_RECEIVED/CHARACTER_MESSAGE_RENDERED never get listened to
  // at all — so no [STATS:...]/[DIARY:...]/[INVENTORY:...] tag is ever
  // read, while the button/panel/settings (which don't depend on this
  // field) work completely normally. That mismatch — UI fine, tags
  // never applied, nothing in the console because nothing actually
  // threw — is exactly this bug's signature. Normalizing both spellings
  // onto ctx.event_types here means the rest of the file doesn't need
  // to change and works regardless of which one a given ST build uses.
  async function resolveContext() {
    for (let i = 0; i < 60; i++) {
      try {
        if (window.SillyTavern && typeof window.SillyTavern.getContext === "function") {
          const ctx = window.SillyTavern.getContext();
          if (ctx) {
            if (!ctx.event_types && ctx.eventTypes) ctx.event_types = ctx.eventTypes;
            console.log(`[ObsessionMeter] context resolved via window.SillyTavern.getContext() after ${i} retr${i === 1 ? "y" : "ies"}.`);
            return ctx;
          }
        }
      } catch (e) {
        /* not ready yet, retry */
      }
      // Visible progress instead of a silent 15s black box — if you
      // see this counting up, the script IS running and IS trying;
      // it just hasn't found window.SillyTavern.getContext yet.
      if (i === 0 || i === 19 || i === 39 || i === 59) {
        console.log(`[ObsessionMeter] waiting for window.SillyTavern.getContext (attempt ${i + 1}/60)...`);
      }
      await new Promise((r) => setTimeout(r, 250));
    }

    console.warn("[ObsessionMeter] window.SillyTavern.getContext never became available after 15s — falling back to direct module import.");

    let lastErr = null;
    for (let i = 0; i < 5; i++) {
      try {
        const extMod = await import("../../../extensions.js");
        const scriptMod = await import("../../../../script.js");
        if (extMod.extension_settings) {
          console.log(`[ObsessionMeter] context resolved via fallback module import after ${i} retr${i === 1 ? "y" : "ies"}.`);
          return {
            extensionSettings: extMod.extension_settings,
            saveSettingsDebounced: scriptMod.saveSettingsDebounced,
            eventSource: scriptMod.eventSource,
            event_types: scriptMod.event_types,
            chat: scriptMod.chat,
            chatMetadata: scriptMod.chat_metadata,
            saveMetadataDebounced: scriptMod.saveMetadataDebounced,
            saveMetadata: scriptMod.saveMetadata,
            characters: scriptMod.characters,
            this_chid: scriptMod.this_chid,
            name1: scriptMod.name1,
            name2: scriptMod.name2,
            executeSlashCommandsWithOptions: scriptMod.executeSlashCommandsWithOptions,
            executeSlashCommands: scriptMod.executeSlashCommands,
          };
        }
      } catch (e) {
        lastErr = e;
      }
      await new Promise((r) => setTimeout(r, 500));
    }

    console.error("[ObsessionMeter] Could not resolve SillyTavern context via fallback import either.", lastErr);
    return null;
  }

  // ---------------------------------------------------------------
  // Defaults & constants
  // ---------------------------------------------------------------

  const EXT_ID = "obsession-meter";
  // "obsession" and "sanity" are special-cased below (hearts / inverted
  // bar) and always present — they're excluded from this list, which is
  // only the ordinary 0-100 bar stats.
  const DEFAULT_STAT_KEYS = ["love", "trust", "anger", "possession"];
  const DEFAULT_MIN = 0;
  const DEFAULT_MAX = 100;
  const DEFAULT_START = 20;

  const OBSESSION_KEY = "obsession";
  const OBSESSION_MAX_HEARTS = 12;
  const OBSESSION_START_HEARTS = 1;
  // Animated heart glyph used for every heart icon in the panel
  // (character list preview + detail meter). Swap this URL to
  // reskin the hearts.
  const OBSESSION_HEART_GIF = "https://files.catbox.moe/assj0n.gif";

  const SANITY_KEY = "sanity";
  const SANITY_MIN = 0;
  const SANITY_MAX = 100;
  const SANITY_START = 100; // starts intact, erodes as obsession climbs

  // ---------------------------------------------------------------
  // Diary — a character occasionally writes an entry via
  // [DIARY:Name] free text (captures everything up to the next tag
  // or end of message, so multi-line/paragraph entries work). Each
  // entry snapshots sanity+obsession *at the moment it was written*
  // and keeps that snapshot forever — an entry written during a
  // spiral should still read as unhinged months later even after the
  // character calms back down, same way a real diary page doesn't
  // rewrite itself.
  // ---------------------------------------------------------------
  const DIARY_TAG = /\[DIARY:([^\]]+)\]\s*([\s\S]*?)(?=\[(?:STATS|DIARY|INVENTORY):|$)/g;

  // ---------------------------------------------------------------
  // Inventory — [INVENTORY:Name] add "Item Name" :: description,
  // remove "Item Name"; semicolon-separated so descriptions can use
  // commas freely. New items optionally kick off AI pixel-art
  // generation (see generateItemImage below).
  // ---------------------------------------------------------------
  const INVENTORY_TAG = /\[INVENTORY:([^\]]+)\]\s*([^\n\[]+)/g;

  // Obsession heart color ramps from a soft pink at low counts toward
  // a saturated red/black as it nears the 12-heart ceiling — the meter
  // should visually communicate "this is getting dangerous," not just
  // count up neutrally.
  const OBSESSION_COLOR_STOPS = [
    { at: 0, color: "#e0558f" },
    { at: 5, color: "#d9503f" },
    { at: 9, color: "#a3132f" },
    { at: 12, color: "#5c0018" },
  ];

  const STAT_COLORS = {
    love: "#e0558f",
    trust: "#4fa3d9",
    anger: "#d9503f",
    possession: "#9a5fd1",
    sanity: "#4fa3d9",
  };
  const FALLBACK_COLORS = ["#5fb3a3", "#c97fc9", "#7f9fd1", "#d1a05f", "#8fbf6f", "#d15f8f"];

  // [STATS:Name] key+5, key-3, key=60, key (bare = +1)
  // Ordinary keys are 0-100 by default (configurable). "obsession" is
  // always 0-12 hearts regardless of that range, and "sanity" is
  // always its own fixed 0-100.
  const STATS_TAG = /\[STATS:([^\]]+)\]\s*([^\n\[]+)/g;

  function safeClone(value) {
    try {
      return structuredClone(value);
    } catch (e) {
      return JSON.parse(JSON.stringify(value));
    }
  }

  // ---------------------------------------------------------------
  // Settings (global config lives in extension_settings; per-chat
  // meter values live in chat metadata, same split as Phone UI uses
  // for its own settings vs. thread data — config should follow you
  // everywhere, but meter values belong to the specific story).
  // ---------------------------------------------------------------

  function getGlobalSettings() {
    if (!context.extensionSettings[EXT_ID]) {
      context.extensionSettings[EXT_ID] = {};
    }
    const s = context.extensionSettings[EXT_ID];
    if (!Array.isArray(s.statKeys) || s.statKeys.length === 0) {
      s.statKeys = safeClone(DEFAULT_STAT_KEYS);
    }
    if (typeof s.min !== "number") s.min = DEFAULT_MIN;
    if (typeof s.max !== "number") s.max = DEFAULT_MAX;
    if (typeof s.startValue !== "number") s.startValue = DEFAULT_START;
    if (typeof s.panelX !== "number") s.panelX = null;
    if (typeof s.panelY !== "number") s.panelY = null;
    if (typeof s.buttonX !== "number") s.buttonX = null;
    if (typeof s.buttonY !== "number") s.buttonY = null;
    if (typeof s.topBtnX !== "number") s.topBtnX = null;
    if (typeof s.topBtnY !== "number") s.topBtnY = null;
    if (typeof s.collapsed !== "boolean") s.collapsed = false;
    if (typeof s.decayEnabled !== "boolean") s.decayEnabled = false;
    if (typeof s.decayAmount !== "number") s.decayAmount = 1;
    if (typeof s.imageGenEnabled !== "boolean") s.imageGenEnabled = false;
    if (typeof s.imageGenCommand !== "string") s.imageGenCommand = "/sd {prompt}";
    if (typeof s.imageGenPromptTemplate !== "string") {
      s.imageGenPromptTemplate =
        "pixel art icon, {item}, 16-bit rpg inventory item, transparent background, centered, no text, no watermark";
    }
    return s;
  }

  function saveGlobalSettings() {
    try {
      if (context && typeof context.saveSettingsDebounced === "function") {
        context.saveSettingsDebounced();
      }
    } catch (e) {
      /* persistence is best-effort — never let a save failure break the UI */
    }
  }

  // THE BUG: `context` (and context.chat / context.chatMetadata inside
  // it) is captured exactly ONCE at boot, in resolveContext(). But ST
  // does not mutate `chat` / `chat_metadata` in place when you switch
  // chats or characters — it *reassigns* them to new objects/arrays for
  // the newly-loaded chat (that's why ST's own docs tell extension
  // authors to listen for CHAT_CHANGED and refresh their references).
  // A snapshot taken once at load therefore keeps pointing at whatever
  // chat happened to be open (or no chat at all) the moment the
  // extension finished initializing, forever — every stat change gets
  // read from and written to that stale, orphaned object instead of the
  // chat you're actually looking at. Nothing throws, nothing logs nothing
  // errors — the panel just never reflects reality. This is why it can
  // look completely fine on inspection (init succeeded, no console
  // errors, button/panel work) while tags silently go nowhere.
  //
  // Fix: re-fetch a fresh context via getContext() every time we touch
  // chat-scoped data, instead of trusting the cached snapshot for it.
  function getFreshContext() {
    try {
      if (window.SillyTavern && typeof window.SillyTavern.getContext === "function") {
        return window.SillyTavern.getContext();
      }
    } catch (e) {
      /* fall through to cached context below */
    }
    return null;
  }

  function getChatMetadataStore() {
    const fresh = getFreshContext();
    try {
      if (fresh && fresh.chatMetadata) return fresh.chatMetadata;
    } catch (e) {
      /* fall through */
    }
    // Fallbacks below only matter on older ST builds that don't expose
    // window.SillyTavern.getContext() at all (resolveContext()'s import
    // fallback path) — on any modern build the fresh fetch above always
    // wins and this stale cache is never used.
    try {
      if (context.chatMetadata) return context.chatMetadata;
    } catch (e) {
      /* fall through */
    }
    try {
      if (window.chat_metadata) return window.chat_metadata;
    } catch (e) {
      /* fall through */
    }
    return null;
  }

  function getChatData() {
    const store = getChatMetadataStore();
    if (!store) return { characters: {}, log: [] };
    if (!store[EXT_ID]) {
      store[EXT_ID] = { characters: {}, log: [] };
    }
    const d = store[EXT_ID];
    if (!d.characters) d.characters = {};
    if (!d.log) d.log = [];
    return d;
  }

  function saveChatData() {
    try {
      if (typeof context.saveMetadataDebounced === "function") {
        context.saveMetadataDebounced();
        return;
      }
    } catch (e) {
      /* fall through */
    }
    try {
      if (typeof window.saveMetadataDebounced === "function") {
        window.saveMetadataDebounced();
        return;
      }
    } catch (e) {
      /* fall through */
    }
    // Last resort: some ST versions persist chat metadata as part of
    // the regular settings save cycle.
    saveGlobalSettings();
  }

  function ensureCharacterStats(name) {
    const d = getChatData();
    const s = getGlobalSettings();
    if (!d.characters[name]) {
      const values = {};
      for (const key of s.statKeys) values[key] = s.startValue;
      values[OBSESSION_KEY] = OBSESSION_START_HEARTS;
      values[SANITY_KEY] = SANITY_START;
      // Obsession and sanity always render first, ahead of whatever
      // ordinary stats are configured — they're the headline meters.
      d.characters[name] = {
        values,
        order: [OBSESSION_KEY, SANITY_KEY, ...safeClone(s.statKeys)],
        diary: [],
        inventory: [],
      };
    } else {
      // A stat key added to settings after this character already
      // existed shouldn't silently vanish from their card — backfill
      // any new keys at the configured start value.
      for (const key of s.statKeys) {
        if (!(key in d.characters[name].values)) {
          d.characters[name].values[key] = s.startValue;
        }
      }
      if (!(OBSESSION_KEY in d.characters[name].values)) {
        d.characters[name].values[OBSESSION_KEY] = OBSESSION_START_HEARTS;
      }
      if (!(SANITY_KEY in d.characters[name].values)) {
        d.characters[name].values[SANITY_KEY] = SANITY_START;
      }
      const rest = s.statKeys.filter((k) => k !== OBSESSION_KEY && k !== SANITY_KEY);
      d.characters[name].order = [OBSESSION_KEY, SANITY_KEY, ...safeClone(rest)];
      if (!Array.isArray(d.characters[name].diary)) d.characters[name].diary = [];
      if (!Array.isArray(d.characters[name].inventory)) d.characters[name].inventory = [];
    }
    return d.characters[name];
  }

  function clampValue(key, v) {
    if (key === OBSESSION_KEY) {
      return Math.max(0, Math.min(OBSESSION_MAX_HEARTS, Math.round(v)));
    }
    if (key === SANITY_KEY) {
      return Math.max(SANITY_MIN, Math.min(SANITY_MAX, v));
    }
    const s = getGlobalSettings();
    return Math.max(s.min, Math.min(s.max, v));
  }

  // ---------------------------------------------------------------
  // Tag parsing
  //
  // [STATS:Name] love+5, trust-2, obsession+1, sanity-10, anger
  //
  // Comma-separated list of key(+|-|=)value, or a bare key (treated
  // as +1). Unknown keys are added on the fly rather than dropped —
  // a character improvising a stat the user didn't pre-configure is
  // more useful than silently losing it, and it shows up in settings
  // afterward so it can be renamed/removed/colored.
  // ---------------------------------------------------------------

  function parseStatsBody(body) {
    const changes = [];
    const parts = body.split(",");
    for (let raw of parts) {
      raw = raw.trim();
      if (!raw) continue;
      const m = raw.match(/^([a-zA-Z_][a-zA-Z0-9_ ]*?)\s*(\+|-|=)?\s*(-?\d+(?:\.\d+)?)?$/);
      if (!m) {
        console.warn(`[ObsessionMeter] Skipped unparseable stat token: "${raw}"`);
        continue;
      }
      const key = m[1].trim().toLowerCase().replace(/\s+/g, "_");
      const op = m[2] || "+";
      const num = m[3] !== undefined ? parseFloat(m[3]) : 1;
      changes.push({ key, op, num });
    }
    return changes;
  }

  function applyStatsChanges(name, changes) {
    if (!changes.length) return null;
    const s = getGlobalSettings();
    const char = ensureCharacterStats(name);
    const before = safeClone(char.values);
    let touchedNewKey = false;

    for (const { key, op, num } of changes) {
      if (!(key in char.values)) {
        char.values[key] = s.startValue;
        char.order.push(key);
        if (!s.statKeys.includes(key)) {
          s.statKeys.push(key);
          touchedNewKey = true;
        }
      }
      const current = char.values[key];
      let next = current;
      if (op === "+") next = current + num;
      else if (op === "-") next = current - num;
      else if (op === "=") next = num;
      char.values[key] = clampValue(key, next);
    }

    if (touchedNewKey) saveGlobalSettings();
    saveChatData();

    const d = getChatData();
    d.log.push({ name, before, after: safeClone(char.values), ts: Date.now() });
    if (d.log.length > 200) d.log.splice(0, d.log.length - 200);
    saveChatData();

    return { before, after: safeClone(char.values) };
  }

  function applyDecayTick() {
    const s = getGlobalSettings();
    if (!s.decayEnabled) return;
    const d = getChatData();
    let any = false;
    for (const name of Object.keys(d.characters)) {
      const char = d.characters[name];
      for (const key of Object.keys(char.values)) {
        // Obsession hearts never passively drain — an idle stat
        // quietly resetting the character's whole arc between
        // sessions defeats the point of an escalating heart count.
        // It only moves when the card explicitly sends the tag.
        if (key === OBSESSION_KEY) continue;

        // Every other stat (sanity included) decays toward its own
        // midpoint rather than toward its floor — an idle "anger"
        // stat settling back to neutral is a reasonable read; an idle
        // stat draining to 0 usually isn't.
        const min = key === SANITY_KEY ? SANITY_MIN : s.min;
        const max = key === SANITY_KEY ? SANITY_MAX : s.max;
        const mid = (min + max) / 2;
        const cur = char.values[key];
        if (Math.abs(cur - mid) < 0.01) continue;
        const dir = cur > mid ? -1 : 1;
        char.values[key] = clampValue(key, cur + dir * s.decayAmount);
        any = true;
      }
    }
    if (any) saveChatData();
  }

  // ---------------------------------------------------------------
  // Diary
  // ---------------------------------------------------------------

  // 0 = steady, 1 = uneasy, 2 = unraveling, 3 = feral. Blends how far
  // sanity has eroded with how many obsession hearts are filled, so
  // either stat alone can tip an entry into "crazier font" territory.
  function derangementTier(sanity, obsessionHearts) {
    const sanityFactor = (SANITY_MAX - sanity) / (SANITY_MAX - SANITY_MIN || 1);
    const obsessionFactor = obsessionHearts / OBSESSION_MAX_HEARTS;
    const madness = sanityFactor * 0.5 + obsessionFactor * 0.5;
    if (madness < 0.25) return 0;
    if (madness < 0.5) return 1;
    if (madness < 0.75) return 2;
    return 3;
  }

  function applyDiaryEntry(name, text) {
    const trimmed = String(text || "").trim();
    if (!trimmed) return null;
    const char = ensureCharacterStats(name);
    const sanity = char.values[SANITY_KEY];
    const obsession = char.values[OBSESSION_KEY];
    const entry = {
      id: `d${Date.now()}${Math.floor(Math.random() * 10000)}`,
      text: trimmed,
      ts: Date.now(),
      sanity,
      obsession,
      tier: derangementTier(sanity, obsession),
    };
    if (!Array.isArray(char.diary)) char.diary = [];
    char.diary.push(entry);
    if (char.diary.length > 200) char.diary.splice(0, char.diary.length - 200);
    saveChatData();
    return entry;
  }

  // Wraps each word in its own span with a small randomized rotation/
  // offset/scale so higher-tier entries read as visibly unsteady
  // rather than just swapping fonts. `html` is expected pre-escaped.
  function wrapJitterWords(html, intensity) {
    return html
      .split(/\n/)
      .map((line) =>
        line
          .split(" ")
          .map((word) => {
            if (!word) return "";
            const rot = (Math.random() * 10 * intensity - 5 * intensity).toFixed(1);
            const y = (Math.random() * 5 * intensity - 2.5 * intensity).toFixed(1);
            const big = Math.random() < 0.1 * intensity;
            const scale = big
              ? (1.1 + Math.random() * 0.3 * intensity).toFixed(2)
              : (1 - Math.random() * 0.08 * intensity).toFixed(2);
            const tint = Math.random() < 0.15 * intensity ? "color:#ff8fa3;" : "";
            return `<span class="om-diary-word" style="display:inline-block;transform:rotate(${rot}deg) translateY(${y}px) scale(${scale});${tint}">${word}</span>`;
          })
          .join(" ")
      )
      .join("<br>");
  }

  // Small deterministic hash so each entry gets a fixed, slight page
  // tilt (scattered-notebook-page look) that doesn't jump around on
  // every re-render.
  function tiltForId(id) {
    let h = 0;
    for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
    return ((Math.abs(h) % 33) - 16) / 10; // roughly -1.6deg .. +1.6deg
  }

  function renderDiaryEntry(entry) {
    const dateStr = new Date(entry.ts).toLocaleString();
    const escaped = escapeHtml(entry.text);
    const body =
      entry.tier >= 2 ? wrapJitterWords(escaped, entry.tier - 1) : escaped.replace(/\n/g, "<br>");
    const tilt = tiltForId(entry.id);
    return `<div class="om-diary-entry om-diary-tier-${entry.tier}" style="transform: rotate(${tilt}deg);">
      <div class="om-diary-meta">${dateStr} · Sanity ${Math.round(entry.sanity)} · ${entry.obsession}${" "}&#9829;</div>
      <div class="om-diary-text">${body}</div>
    </div>`;
  }

  function renderDiaryTab(name) {
    const char = ensureCharacterStats(name);
    const entries = (char.diary || []).slice().reverse();
    const list = entries.length
      ? entries.map(renderDiaryEntry).join("")
      : `<div class="om-empty">No diary entries yet. A character card sends
          <code>[DIARY:Name] entry text</code> to write one, or write one below.</div>`;
    return `<div class="om-diary">
      <div class="om-diary-compose">
        <textarea class="om-new-diary-text" placeholder="Write an entry as ${escapeHtml(name)}..."></textarea>
        <button class="om-add-diary-btn menu_button">Write entry</button>
      </div>
      <div class="om-diary-list">${list}</div>
    </div>`;
  }

  // ---------------------------------------------------------------
  // Inventory
  //
  // [INVENTORY:Name] add "Item Name" :: optional description; remove
  // "Item Name"; add "Another" :: desc
  //
  // Actions are semicolon-separated (descriptions can contain commas
  // freely that way). New items are pixel-art icons generated through
  // whatever image-gen extension/API the user already has configured
  // in SillyTavern (see generateItemImage) — this extension doesn't
  // generate images itself, it just triggers one.
  // ---------------------------------------------------------------

  function parseInventoryBody(body) {
    const actions = [];
    for (let raw of String(body || "").split(";")) {
      raw = raw.trim();
      if (!raw) continue;
      let m = raw.match(/^add\s+"([^"]+)"\s*(?:::\s*(.*))?$/i);
      if (m) {
        actions.push({ op: "add", name: m[1].trim(), description: (m[2] || "").trim() });
        continue;
      }
      m = raw.match(/^remove\s+"([^"]+)"$/i);
      if (m) {
        actions.push({ op: "remove", name: m[1].trim() });
        continue;
      }
      console.warn(`[ObsessionMeter] Skipped unparseable inventory token: "${raw}"`);
    }
    return actions;
  }

  function applyInventoryChanges(name, actions) {
    if (!actions || !actions.length) return false;
    const char = ensureCharacterStats(name);
    if (!Array.isArray(char.inventory)) char.inventory = [];
    let changed = false;
    for (const action of actions) {
      if (action.op === "add") {
        const item = {
          id: `i${Date.now()}${Math.floor(Math.random() * 10000)}`,
          name: action.name,
          description: action.description || "",
          imageUrl: null,
          imageStatus: "placeholder",
          addedAt: Date.now(),
        };
        char.inventory.push(item);
        changed = true;
        generateItemImage(item); // fire-and-forget; re-renders/saves when settled
      } else if (action.op === "remove") {
        const idx = char.inventory.findIndex((i) => i.name.toLowerCase() === action.name.toLowerCase());
        if (idx !== -1) {
          char.inventory.splice(idx, 1);
          changed = true;
        }
      }
    }
    if (changed) saveChatData();
    return changed;
  }

  // Attempts to trigger whatever image-generation extension the user
  // already has set up in SillyTavern (Stable Diffusion, Horde,
  // ComfyUI front-ends, etc. all typically expose a slash command).
  // This is inherently best-effort: ST's slash-command return shape
  // varies across versions, so several response shapes are probed.
  // If nothing usable comes back, the item just sits as a placeholder
  // icon — the user can always paste an image URL by hand from the
  // item detail view instead.
  async function generateItemImage(item) {
    const s = getGlobalSettings();
    if (!s.imageGenEnabled) {
      item.imageStatus = "placeholder";
      renderPanel();
      return;
    }
    item.imageStatus = "pending";
    renderPanel();

    const prompt = s.imageGenPromptTemplate.replace(/\{item\}/g, item.name);
    const commandText = s.imageGenCommand.replace(/\{prompt\}/g, prompt);

    try {
      let resultUrl = null;
      if (typeof context.executeSlashCommandsWithOptions === "function") {
        const res = await context.executeSlashCommandsWithOptions(commandText, {
          handleParserErrors: true,
          handleExecutionErrors: true,
        });
        const pipe = res && (res.pipe ?? res.result);
        if (typeof pipe === "string" && pipe.trim()) resultUrl = extractImageUrl(pipe.trim());
      } else if (typeof context.executeSlashCommands === "function") {
        const res = await context.executeSlashCommands(commandText);
        if (typeof res === "string" && res.trim()) resultUrl = extractImageUrl(res.trim());
      } else {
        console.warn("[ObsessionMeter] No slash-command execution API found on context; can't auto-generate images this ST version.");
      }

      if (resultUrl) {
        item.imageUrl = resultUrl;
        item.imageStatus = "ready";
      } else {
        item.imageStatus = "error";
      }
    } catch (e) {
      console.warn("[ObsessionMeter] Image generation failed:", e);
      item.imageStatus = "error";
    }
    saveChatData();
    renderPanel();
  }

  function extractImageUrl(text) {
    if (/^(https?:\/\/|\/|data:image\/)/i.test(text) && /\.(png|jpe?g|webp|gif)(\?|$)|^data:image\//i.test(text)) {
      return text;
    }
    const m = text.match(/(https?:\/\/[^\s"']+\.(?:png|jpe?g|webp|gif))/i);
    return m ? m[1] : null;
  }

  function renderItemSlot(item) {
    let inner;
    if (item.imageStatus === "ready" && item.imageUrl) {
      inner = `<img src="${escapeHtml(item.imageUrl)}" alt="${escapeHtml(item.name)}" />`;
    } else if (item.imageStatus === "pending") {
      inner = `<div class="om-item-slot-pending"><i class="fa-solid fa-spinner fa-spin"></i></div>`;
    } else {
      inner = `<div class="om-item-slot-placeholder"><i class="fa-solid fa-cube"></i></div>`;
    }
    return `<div class="om-item-slot" data-item-id="${escapeHtml(item.id)}">
      ${inner}
      <div class="om-item-name-label">${escapeHtml(item.name)}</div>
    </div>`;
  }

  function renderItemDetail(item) {
    const s = getGlobalSettings();
    let img;
    if (item.imageStatus === "ready" && item.imageUrl) {
      img = `<img src="${escapeHtml(item.imageUrl)}" alt="" />`;
    } else if (item.imageStatus === "pending") {
      img = `<div class="om-item-detail-placeholder"><i class="fa-solid fa-spinner fa-spin"></i></div>`;
    } else if (item.imageStatus === "error") {
      img = `<div class="om-item-detail-placeholder"><i class="fa-solid fa-triangle-exclamation"></i></div>`;
    } else {
      img = `<div class="om-item-detail-placeholder"><i class="fa-solid fa-cube"></i></div>`;
    }
    return `<div class="om-item-detail">
      <div class="om-detail-head">
        <i class="fa-solid fa-arrow-left om-item-back-btn"></i>
        <div class="om-detail-name">${escapeHtml(item.name)}</div>
      </div>
      <div class="om-item-detail-image">${img}</div>
      <p class="om-item-detail-desc">${escapeHtml(item.description || "No description.")}</p>
      <div class="om-item-detail-actions">
        <button class="om-item-regen-btn menu_button" data-item-id="${escapeHtml(item.id)}" ${
      s.imageGenEnabled ? "" : "disabled"
    }>
          <i class="fa-solid fa-wand-magic-sparkles"></i> ${
            s.imageGenEnabled ? "Regenerate" : "Enable AI gen in settings"
          }
        </button>
        <button class="om-item-remove-btn menu_button" data-item-id="${escapeHtml(item.id)}">
          <i class="fa-solid fa-trash"></i> Remove
        </button>
      </div>
      <div class="om-item-url-row">
        <input type="text" class="om-item-url-input" placeholder="or paste an image URL" />
        <button class="om-item-url-btn menu_button" data-item-id="${escapeHtml(item.id)}">Set</button>
      </div>
    </div>`;
  }

  function renderInventoryTab(name) {
    const char = ensureCharacterStats(name);
    const items = char.inventory || [];
    if (activeItem) {
      const item = items.find((i) => i.id === activeItem);
      if (item) return renderItemDetail(item);
      activeItem = null;
    }
    const empty = items.length
      ? ""
      : `<div class="om-empty">No items yet. A character card sends
          <code>[INVENTORY:Name] add "Item Name" :: description</code> to add
          one, or add one below.</div>`;
    const slots = items.map(renderItemSlot).join("");
    return `<div class="om-inventory">
      ${empty}
      <div class="om-inventory-grid">${slots}</div>
      <div class="om-add-item-row">
        <input type="text" class="om-new-item-name" placeholder="item name" />
        <input type="text" class="om-new-item-desc" placeholder="short description" />
        <button class="om-add-item-btn menu_button">Add</button>
      </div>
    </div>`;
  }

  function handleIncomingMessage(rawText) {
    if (!rawText) return;
    let sawSomething = false;
    for (const match of rawText.matchAll(STATS_TAG)) {
      const [, rawName, body] = match;
      const name = rawName.trim();
      if (!name) continue;
      const changes = parseStatsBody(body);
      const result = applyStatsChanges(name, changes);
      if (result) {
        sawSomething = true;
        flashChangedCharacter = name;
        setTimeout(() => {
          if (flashChangedCharacter === name) flashChangedCharacter = null;
          renderPanel();
        }, 1400);
      }
    }
    for (const match of rawText.matchAll(DIARY_TAG)) {
      const [, rawName, body] = match;
      const name = rawName.trim();
      if (!name) continue;
      const entry = applyDiaryEntry(name, body);
      if (entry) sawSomething = true;
    }
    for (const match of rawText.matchAll(INVENTORY_TAG)) {
      const [, rawName, body] = match;
      const name = rawName.trim();
      if (!name) continue;
      const actions = parseInventoryBody(body);
      const changed = applyInventoryChanges(name, actions);
      if (changed) sawSomething = true;
    }
    if (sawSomething) {
      renderPanel();
      updateToggleGlow();
    }
  }

  // ---------------------------------------------------------------
  // UI state (module-level, not persisted — matches activeTab-style
  // ephemeral state in Phone UI)
  // ---------------------------------------------------------------

  let panelOpen = false;
  let activeCharacter = null;
  let activeDetailTab = "meters"; // "meters" | "diary" | "inventory"
  let activeItem = null;
  let flashChangedCharacter = null;
  let panelEl = null;
  let buttonEl = null;

  function colorForStat(key, index) {
    if (STAT_COLORS[key]) return STAT_COLORS[key];
    return FALLBACK_COLORS[index % FALLBACK_COLORS.length];
  }

  // Interpolates between the OBSESSION_COLOR_STOPS for a given heart
  // count, so the color ramps continuously (pink -> red -> near-black)
  // rather than jumping in hard steps at each stop.
  function colorForObsession(hearts) {
    const stops = OBSESSION_COLOR_STOPS;
    for (let i = 0; i < stops.length - 1; i++) {
      const a = stops[i];
      const b = stops[i + 1];
      if (hearts >= a.at && hearts <= b.at) {
        const span = b.at - a.at || 1;
        const t = (hearts - a.at) / span;
        return lerpColor(a.color, b.color, t);
      }
    }
    return stops[stops.length - 1].color;
  }

  function lerpColor(hex1, hex2, t) {
    const c1 = hexToRgb(hex1);
    const c2 = hexToRgb(hex2);
    const r = Math.round(c1.r + (c2.r - c1.r) * t);
    const g = Math.round(c1.g + (c2.g - c1.g) * t);
    const b = Math.round(c1.b + (c2.b - c1.b) * t);
    return `rgb(${r}, ${g}, ${b})`;
  }

  function hexToRgb(hex) {
    const clean = hex.replace("#", "");
    return {
      r: parseInt(clean.substring(0, 2), 16),
      g: parseInt(clean.substring(2, 4), 16),
      b: parseInt(clean.substring(4, 6), 16),
    };
  }

  function labelForStat(key) {
    return key
      .split("_")
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ");
  }

  function percentFor(key, value) {
    if (key === SANITY_KEY) {
      const span = SANITY_MAX - SANITY_MIN || 1;
      return Math.max(0, Math.min(100, ((value - SANITY_MIN) / span) * 100));
    }
    const s = getGlobalSettings();
    const span = s.max - s.min || 1;
    return Math.max(0, Math.min(100, ((value - s.min) / span) * 100));
  }

  // 12 heart icons, filled up to the current count. Hearts at or past
  // the danger stops (9+) get a subtle glow class so the panel reads
  // as "this is bad" at a glance, not just as a higher number.
  function renderHeartsRow(hearts) {
    const danger = hearts >= 9 ? " om-hearts-danger" : "";
    let icons = "";
    for (let i = 1; i <= OBSESSION_MAX_HEARTS; i++) {
      const filled = i <= hearts;
      icons += `<img src="${OBSESSION_HEART_GIF}" class="om-heart-img om-heart${
        filled ? " om-heart-filled-img" : " om-heart-empty-img"
      }" alt="" />`;
    }
    return `<div class="om-hearts-row${danger}">${icons}</div>`;
  }

  function renderCharacterList() {
    const d = getChatData();
    const names = Object.keys(d.characters);
    if (names.length === 0) {
      return `<div class="om-empty">No tracked characters yet. A character card sends
        <code>[STATS:Name] key+5</code> in its reply to start showing up here.</div>`;
    }
    return names
      .map((name) => {
        const char = d.characters[name];
        const hearts = char.values[OBSESSION_KEY] || 0;
        const sanity = char.values[SANITY_KEY];
        const flashClass = flashChangedCharacter === name ? " om-flash" : "";
        const sanitySub = typeof sanity === "number" ? ` · Sanity: ${Math.round(sanity)}` : "";
        const diaryCount = (char.diary || []).length;
        const itemCount = (char.inventory || []).length;
        const extras = [];
        if (diaryCount) extras.push(`<i class="fa-solid fa-book"></i> ${diaryCount}`);
        if (itemCount) extras.push(`<i class="fa-solid fa-box"></i> ${itemCount}`);
        const extraSub = extras.length ? ` · ${extras.join(" ")}` : "";
        return `<div class="om-char-row${flashClass}" data-name="${escapeHtml(name)}">
          <div class="om-char-avatar">${escapeHtml(initials(name))}</div>
          <div class="om-char-info">
            <div class="om-char-name">${escapeHtml(name)}</div>
            <div class="om-char-sub">${renderHeartsRow(hearts)}<span class="om-char-sanity">${sanitySub}${extraSub}</span></div>
          </div>
          <i class="fa-solid fa-chevron-right"></i>
        </div>`;
      })
      .join("");
  }

  function renderMeters(name) {
    const d = getChatData();
    const char = d.characters[name];
    if (!char) return `<div class="om-empty">No data for ${escapeHtml(name)} yet.</div>`;
    const keys = char.order.filter((k) => k in char.values);
    return keys
      .map((key, i) => {
        const val = char.values[key];

        if (key === OBSESSION_KEY) {
          return `<div class="om-meter om-meter-hearts" data-key="${escapeHtml(key)}">
            <div class="om-meter-head">
              <span class="om-meter-label">${escapeHtml(labelForStat(key))}</span>
              <span class="om-meter-value">${Math.round(val)} / ${OBSESSION_MAX_HEARTS}</span>
            </div>
            ${renderHeartsRow(val)}
          </div>`;
        }

        const pct = percentFor(key, val);
        const color = colorForStat(key, i);
        return `<div class="om-meter" data-key="${escapeHtml(key)}">
          <div class="om-meter-head">
            <span class="om-meter-label">${escapeHtml(labelForStat(key))}</span>
            <span class="om-meter-value">${Math.round(val)}</span>
          </div>
          <div class="om-meter-track">
            <div class="om-meter-fill" style="width:${pct}%;background:${color};"></div>
          </div>
        </div>`;
      })
      .join("");
  }

  function renderDetailView(name) {
    const tab = activeDetailTab;
    let body;
    if (tab === "diary") body = renderDiaryTab(name);
    else if (tab === "inventory") body = renderInventoryTab(name);
    else body = `<div class="om-meters">${renderMeters(name)}</div>`;
    return `<div class="om-detail">
      <div class="om-detail-head">
        <i class="fa-solid fa-arrow-left om-back-btn"></i>
        <div class="om-detail-name">${escapeHtml(name)}</div>
      </div>
      <div class="om-detail-tabs">
        <div class="om-detail-tab${tab === "meters" ? " om-tab-active" : ""}" data-tab="meters">Meters</div>
        <div class="om-detail-tab${tab === "diary" ? " om-tab-active" : ""}" data-tab="diary">Diary</div>
        <div class="om-detail-tab${tab === "inventory" ? " om-tab-active" : ""}" data-tab="inventory">Inventory</div>
      </div>
      ${body}
    </div>`;
  }

  // Fields shared between the floating panel's Settings tab and the
  // extension's own drawer in the ST Extensions panel (see
  // buildSettingsDrawer) — same markup, same handlers, two places to
  // reach it from.
  function renderSettingsFieldsHtml() {
    const s = getGlobalSettings();
    const keysHtml = s.statKeys
      .map(
        (k) => `<span class="om-key-chip">${escapeHtml(labelForStat(k))}
          <i class="fa-solid fa-xmark om-remove-key" data-key="${escapeHtml(k)}"></i></span>`
      )
      .join("");
    return `
      <div class="om-settings-section">
        <label>Tracked stats</label>
        <div class="om-key-chips">${keysHtml}</div>
        <div class="om-add-key-row">
          <input type="text" class="om-new-key-input" placeholder="new stat name" />
          <button class="om-add-key-btn menu_button">Add</button>
        </div>
      </div>
      <div class="om-settings-section">
        <label>Range</label>
        <div class="om-range-row">
          <input type="number" class="om-min-input" value="${s.min}" /> to
          <input type="number" class="om-max-input" value="${s.max}" />
        </div>
      </div>
      <div class="om-settings-section">
        <label>Starting value for new characters</label>
        <input type="number" class="om-start-input" value="${s.startValue}" />
      </div>
      <div class="om-settings-section">
        <label class="om-checkbox-label">
          <input type="checkbox" class="om-decay-toggle" ${s.decayEnabled ? "checked" : ""} />
          Idle decay toward midpoint
        </label>
        <div class="om-range-row om-decay-amount-row" style="${s.decayEnabled ? "" : "display:none;"}">
          Amount per message: <input type="number" class="om-decay-amount-input" value="${s.decayAmount}" min="0" step="0.5" />
        </div>
      </div>
      <div class="om-settings-section">
        <label class="om-checkbox-label">
          <input type="checkbox" class="om-imagegen-toggle" ${s.imageGenEnabled ? "checked" : ""} />
          Generate pixel art for new inventory items
        </label>
        <p class="om-imagegen-help">Requires an image-generation extension already set
        up in SillyTavern (e.g. the built-in Stable Diffusion extension). This
        just triggers it through a slash command — it doesn't generate images
        itself. If it can't get an image back, the item keeps a placeholder
        icon and you can paste a URL manually from its detail view instead.</p>
        <div class="om-imagegen-fields" style="${s.imageGenEnabled ? "" : "display:none;"}">
          <label>Slash command template ({prompt} is replaced)</label>
          <input type="text" class="om-imagegen-command-input" value="${escapeHtml(s.imageGenCommand)}" />
          <label style="margin-top:8px;">Prompt template ({item} is replaced with the item name)</label>
          <input type="text" class="om-imagegen-prompt-input" value="${escapeHtml(s.imageGenPromptTemplate)}" />
        </div>
      </div>
      <div class="om-settings-section om-tag-help">
        <label>Tag reference</label>
        <code>[STATS:CharacterName] love+5, trust-2, obsession+1, sanity-10</code>
        <code>[DIARY:CharacterName] free-form entry text, any length</code>
        <code>[INVENTORY:CharacterName] add "Item Name" :: description; remove "Old Item"</code>
        <p>Add these to the character's system prompt or Author's Note so
        they know to emit them. Stats: comma-separated, +/-/= all work, bare
        key name means +1. Obsession is hearts (0-${OBSESSION_MAX_HEARTS}) no
        matter what range is set below — one heart per +1. Sanity is
        always 0-100 and starts full. Diary entries snapshot the character's
        current sanity/obsession and render "crazier" the further gone they
        were when written. Inventory actions are semicolon-separated.</p>
      </div>`;
  }

  function renderSettingsView() {
    return `<div class="om-settings">
      <div class="om-detail-head">
        <i class="fa-solid fa-arrow-left om-back-btn"></i>
        <div class="om-detail-name">Settings</div>
      </div>
      ${renderSettingsFieldsHtml()}
    </div>`;
  }

  // Wires up every control rendered by renderSettingsFieldsHtml.
  // `root` is whatever element they were rendered into (the floating
  // panel, or the ST Extensions-tab drawer) and `onChange` is called
  // after anything that needs the fields' HTML rebuilt (adding a key,
  // toggling decay/imagegen visibility, etc) — the two call sites
  // pass their own re-render function.
  function attachSettingsFieldHandlers(root, onChange) {
    const imagegenToggle = root.querySelector(".om-imagegen-toggle");
    if (imagegenToggle) {
      imagegenToggle.addEventListener("change", () => {
        const s = getGlobalSettings();
        s.imageGenEnabled = imagegenToggle.checked;
        saveGlobalSettings();
        onChange();
      });
    }
    const imagegenCommandInput = root.querySelector(".om-imagegen-command-input");
    if (imagegenCommandInput) {
      imagegenCommandInput.addEventListener("change", () => {
        const s = getGlobalSettings();
        s.imageGenCommand = imagegenCommandInput.value;
        saveGlobalSettings();
      });
    }
    const imagegenPromptInput = root.querySelector(".om-imagegen-prompt-input");
    if (imagegenPromptInput) {
      imagegenPromptInput.addEventListener("change", () => {
        const s = getGlobalSettings();
        s.imageGenPromptTemplate = imagegenPromptInput.value;
        saveGlobalSettings();
      });
    }

    const addKeyBtn = root.querySelector(".om-add-key-btn");
    const newKeyInput = root.querySelector(".om-new-key-input");
    if (addKeyBtn && newKeyInput) {
      const doAdd = () => {
        const raw = newKeyInput.value.trim().toLowerCase().replace(/\s+/g, "_");
        if (!raw) return;
        const s = getGlobalSettings();
        if (!s.statKeys.includes(raw)) {
          s.statKeys.push(raw);
          saveGlobalSettings();
        }
        onChange();
      };
      addKeyBtn.addEventListener("click", doAdd);
      newKeyInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") doAdd();
      });
    }

    root.querySelectorAll(".om-remove-key").forEach((el) => {
      el.addEventListener("click", () => {
        const key = el.getAttribute("data-key");
        const s = getGlobalSettings();
        s.statKeys = s.statKeys.filter((k) => k !== key);
        saveGlobalSettings();
        onChange();
      });
    });

    const minInput = root.querySelector(".om-min-input");
    const maxInput = root.querySelector(".om-max-input");
    if (minInput) {
      minInput.addEventListener("change", () => {
        const s = getGlobalSettings();
        const v = parseFloat(minInput.value);
        if (!isNaN(v)) s.min = v;
        saveGlobalSettings();
      });
    }
    if (maxInput) {
      maxInput.addEventListener("change", () => {
        const s = getGlobalSettings();
        const v = parseFloat(maxInput.value);
        if (!isNaN(v)) s.max = v;
        saveGlobalSettings();
      });
    }

    const startInput = root.querySelector(".om-start-input");
    if (startInput) {
      startInput.addEventListener("change", () => {
        const s = getGlobalSettings();
        const v = parseFloat(startInput.value);
        if (!isNaN(v)) s.startValue = v;
        saveGlobalSettings();
      });
    }

    const decayToggle = root.querySelector(".om-decay-toggle");
    if (decayToggle) {
      decayToggle.addEventListener("change", () => {
        const s = getGlobalSettings();
        s.decayEnabled = decayToggle.checked;
        saveGlobalSettings();
        onChange();
      });
    }
    const decayAmountInput = root.querySelector(".om-decay-amount-input");
    if (decayAmountInput) {
      decayAmountInput.addEventListener("change", () => {
        const s = getGlobalSettings();
        const v = parseFloat(decayAmountInput.value);
        if (!isNaN(v) && v >= 0) s.decayAmount = v;
        saveGlobalSettings();
      });
    }
  }

  function renderPanelBody() {
    if (activeCharacter === "__settings__") return renderSettingsView();
    if (activeCharacter) return renderDetailView(activeCharacter);
    return `<div class="om-list">${renderCharacterList()}</div>`;
  }

  function renderPanel() {
    if (!panelEl) return;
    const s = getGlobalSettings();
    const header = activeCharacter
      ? ""
      : `<div class="om-panel-header">
          <span>Obsession Meter</span>
          <i class="fa-solid fa-gear om-settings-btn om-no-drag"></i>
        </div>`;
    panelEl.innerHTML = `${header}<div class="om-panel-body">${renderPanelBody()}</div>`;
    attachPanelHandlers();
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function initials(name) {
    const parts = String(name).trim().split(/\s+/);
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }

  // ---------------------------------------------------------------
  // Event handlers
  // ---------------------------------------------------------------

  function attachPanelHandlers() {
    if (!panelEl) return;

    const settingsBtn = panelEl.querySelector(".om-settings-btn");
    if (settingsBtn) {
      settingsBtn.addEventListener("click", () => {
        activeCharacter = "__settings__";
        renderPanel();
      });
    }

    const backBtn = panelEl.querySelector(".om-back-btn");
    if (backBtn) {
      backBtn.addEventListener("click", () => {
        activeCharacter = null;
        activeDetailTab = "meters";
        activeItem = null;
        renderPanel();
      });
    }

    panelEl.querySelectorAll(".om-char-row").forEach((row) => {
      row.addEventListener("click", () => {
        activeCharacter = row.getAttribute("data-name");
        activeDetailTab = "meters";
        activeItem = null;
        renderPanel();
      });
    });

    panelEl.querySelectorAll(".om-detail-tab").forEach((tabEl) => {
      tabEl.addEventListener("click", () => {
        activeDetailTab = tabEl.getAttribute("data-tab");
        activeItem = null;
        renderPanel();
      });
    });

    const diaryBtn = panelEl.querySelector(".om-add-diary-btn");
    const diaryText = panelEl.querySelector(".om-new-diary-text");
    if (diaryBtn && diaryText) {
      diaryBtn.addEventListener("click", () => {
        const text = diaryText.value;
        if (!text.trim() || !activeCharacter) return;
        applyDiaryEntry(activeCharacter, text);
        renderPanel();
      });
    }

    const addItemBtn = panelEl.querySelector(".om-add-item-btn");
    if (addItemBtn) {
      addItemBtn.addEventListener("click", () => {
        const nameInput = panelEl.querySelector(".om-new-item-name");
        const descInput = panelEl.querySelector(".om-new-item-desc");
        const itemName = nameInput.value.trim();
        if (!itemName || !activeCharacter) return;
        applyInventoryChanges(activeCharacter, [
          { op: "add", name: itemName, description: descInput.value.trim() },
        ]);
        renderPanel();
      });
    }

    panelEl.querySelectorAll(".om-item-slot").forEach((slot) => {
      slot.addEventListener("click", () => {
        activeItem = slot.getAttribute("data-item-id");
        renderPanel();
      });
    });

    const itemBackBtn = panelEl.querySelector(".om-item-back-btn");
    if (itemBackBtn) {
      itemBackBtn.addEventListener("click", () => {
        activeItem = null;
        renderPanel();
      });
    }

    const regenBtn = panelEl.querySelector(".om-item-regen-btn");
    if (regenBtn) {
      regenBtn.addEventListener("click", () => {
        const id = regenBtn.getAttribute("data-item-id");
        const char = ensureCharacterStats(activeCharacter);
        const item = (char.inventory || []).find((i) => i.id === id);
        if (item) generateItemImage(item);
      });
    }

    const removeItemBtn = panelEl.querySelector(".om-item-remove-btn");
    if (removeItemBtn) {
      removeItemBtn.addEventListener("click", () => {
        const id = removeItemBtn.getAttribute("data-item-id");
        const char = ensureCharacterStats(activeCharacter);
        char.inventory = (char.inventory || []).filter((i) => i.id !== id);
        saveChatData();
        activeItem = null;
        renderPanel();
      });
    }

    const itemUrlBtn = panelEl.querySelector(".om-item-url-btn");
    if (itemUrlBtn) {
      itemUrlBtn.addEventListener("click", () => {
        const id = itemUrlBtn.getAttribute("data-item-id");
        const input = panelEl.querySelector(".om-item-url-input");
        const url = input.value.trim();
        if (!url) return;
        const char = ensureCharacterStats(activeCharacter);
        const item = (char.inventory || []).find((i) => i.id === id);
        if (item) {
          item.imageUrl = url;
          item.imageStatus = "ready";
          saveChatData();
          renderPanel();
        }
      });
    }

    attachSettingsFieldHandlers(panelEl, renderPanel);
  }

  function updateToggleGlow() {
    // BUGFIX: this used to target buttonEl, which is always null now
    // that the round floating button was removed — the pulse never
    // fired on anything. The real, currently-shipped button is
    // #om-topbar-button; target that instead.
    const btn = document.getElementById("om-topbar-button");
    if (!btn) return;
    btn.classList.add("om-toggle-pulse");
    setTimeout(() => btn && btn.classList.remove("om-toggle-pulse"), 1200);
  }

  // BUGFIX: panelX/panelY (saved so the panel reopens wherever it was
  // last dragged to) can end up pointing off-screen — most commonly
  // because they were saved during an earlier session/window size, or
  // because an older/experimental version of this extension dragged
  // it somewhere before the current button existed to get it back.
  // When that happens the panel *does* open (display:flex, fully
  // rendered, no error anywhere) — it's just sitting outside the
  // visible viewport, which looks identical to "clicking does
  // nothing." This runs every time the panel opens and snaps it back
  // to the default corner if its saved position isn't actually
  // visible, so a bad saved coordinate can never permanently hide it.
  function ensurePanelOnScreen() {
    if (!panelEl) return;
    const r = panelEl.getBoundingClientRect();
    const visible =
      r.width > 0 &&
      r.height > 0 &&
      r.right > 0 &&
      r.bottom > 0 &&
      r.left < window.innerWidth &&
      r.top < window.innerHeight;
    if (!visible) {
      panelEl.style.left = "";
      panelEl.style.top = "";
      panelEl.style.right = "20px";
      panelEl.style.bottom = "150px";
      const gs = getGlobalSettings();
      gs.panelX = null;
      gs.panelY = null;
      saveGlobalSettings();
    }
  }

  // ---------------------------------------------------------------
  // Popover positioning — ported from Phone UI's
  // positionPanelNearButton() / positionPanelForOpen(). This is about
  // where the panel appears on screen when it opens, not how it's
  // styled: previously the panel always opened at a single hard-coded
  // fallback spot (bottom-right corner) regardless of where the
  // topbar icon actually is, and only got nudged back on-screen
  // *after* the fact (ensurePanelOnScreen) if that fixed spot happened
  // to be off-screen. Phone UI instead treats the panel like a
  // popover anchored to its own toggle button: measure the panel,
  // pick a side with room, hug the button, clamp fully on-screen —
  // computed and applied *before* the panel is revealed, so it opens
  // already in the right place instead of flashing at the old one
  // first. A manually dragged position is sticky and always wins,
  // exactly like Phone UI's panelPos.
  //
  // One deliberate adaptation for this extension: Phone UI's button
  // floats bottom-right, so its popover prefers opening *above* the
  // button when there's room. This extension's icon instead lives in
  // ST's own top icon row, pinned to the very top of the viewport —
  // there's essentially never room above it — so this prefers
  // opening *below* the icon instead, only falling back upward if
  // there's truly more room that way.
  function positionPanelNearButton() {
    const btn = document.getElementById("om-topbar-button");
    if (!btn || !panelEl) return false;
    const btnRect = btn.getBoundingClientRect();

    // The panel needs real dimensions to measure, but it's normally
    // display:none while closed (om-hidden). Make it measurable
    // without letting it actually flash on screen mid-measurement —
    // same "swap to visibility:hidden instead of display:none for a
    // moment" trick Phone UI uses.
    const wasHidden = panelEl.classList.contains("om-hidden");
    if (wasHidden) {
      panelEl.style.setProperty("visibility", "hidden", "important");
      panelEl.classList.remove("om-hidden");
    }
    const panelW = panelEl.offsetWidth || 300;
    const panelH = panelEl.offsetHeight || 400;
    if (wasHidden) {
      panelEl.classList.add("om-hidden");
      panelEl.style.removeProperty("visibility");
    }
    if (!panelW || !panelH) return false; // couldn't measure — leave existing position alone

    const margin = 12;
    const spaceBelow = window.innerHeight - btnRect.bottom;
    const spaceAbove = btnRect.top;
    const top =
      spaceBelow >= panelH + margin || spaceBelow > spaceAbove
        ? btnRect.bottom + margin
        : btnRect.top - panelH - margin;

    // Horizontally, hug the icon's right edge like a popover, then
    // clamp fully on-screen so it can never hang off either edge.
    const left = btnRect.right - panelW;

    const clampedLeft = Math.min(Math.max(margin, left), window.innerWidth - panelW - margin);
    const clampedTop = Math.min(Math.max(margin, top), window.innerHeight - panelH - margin);

    panelEl.style.left = `${clampedLeft}px`;
    panelEl.style.top = `${clampedTop}px`;
    panelEl.style.right = "auto";
    panelEl.style.bottom = "auto";
    return true;
  }

  // Decides how to place the panel right before it opens: a manually
  // dragged spot (sticky — set by dragging the panel's own header,
  // saved as panelX/panelY) wins if one exists; otherwise it
  // auto-follows the topbar icon. Mirrors Phone UI's
  // positionPanelForOpen() exactly.
  function positionPanelForOpen() {
    if (!panelEl) return;
    const gs = getGlobalSettings();
    if (gs.panelX !== null && gs.panelY !== null) {
      const [px, py] = clampToViewport(gs.panelX, gs.panelY, 300, 400);
      panelEl.style.left = `${px}px`;
      panelEl.style.top = `${py}px`;
      panelEl.style.right = "auto";
      panelEl.style.bottom = "auto";
    } else {
      positionPanelNearButton();
    }
  }

  function togglePanel() {
    panelOpen = !panelOpen;
    // BUGFIX: build the panel on demand if it isn't there yet, so the
    // button always opens it even if the init-time build step failed.
    // CRITICAL FIX: ensurePanelBuilt() can throw (e.g. a render error
    // inside it). If it throws, the exception aborts this function
    // BEFORE the display:flex line below runs — the panel element gets
    // created and appended (with .om-hidden) but never shown, which is
    // exactly "button works, panel never appears." So we wrap it: even
    // if building/render throws, we still force the panel visible.
    try {
      ensurePanelBuilt();
    } catch (e) {
      console.error("[ObsessionMeter] ensurePanelBuilt() threw during toggle:", e);
    }
    if (panelEl && panelOpen) {
      // Position BEFORE revealing — same ordering as Phone UI's
      // togglePanel(), so the panel appears already anchored near the
      // icon (or its sticky dragged spot) instead of showing briefly
      // at the old/default position first.
      try {
        positionPanelForOpen();
      } catch (e) {
        console.error("[ObsessionMeter] positionPanelForOpen() threw:", e);
      }
    }
    if (panelEl) {
      // BUGFIX: matches Phone UI's togglePanel() exactly now — the
      // .om-hidden class is the ONE source of truth for shown/hidden.
      // This used to also write an inline `style.display` on top of
      // the class toggle ("belt and suspenders"). That's exactly what
      // Phone UI's forceFixedStyle() comment warns against: an inline
      // !important display always outranks the class rule, so if
      // anything ever left that inline write out of sync with the
      // class (a thrown error between the two lines, a stale write
      // from a previous version, etc.) the two could disagree and the
      // panel would get stuck permanently shown or permanently
      // hidden, with the class saying one thing and the inline style
      // silently overruling it. forceFixedStyle() below still forces
      // position/z-index/visibility/opacity/pointer-events — just
      // never display — so nothing else on the page can bury the
      // panel while it's supposed to be open, without also being able
      // to override the open/close state itself.
      panelEl.classList.toggle("om-hidden", !panelOpen);
      forceFixedStyle(panelEl);
    }
    if (panelOpen) {
      // BUGFIX: activeCharacter previously carried over untouched across
      // a close/reopen. It only ever changes via the settings gear icon
      // (-> "__settings__"), a character row (-> that name), or the
      // back button (-> null) — closing the panel hits none of those,
      // so whatever view was on screen when it closed was still "active"
      // underneath. Reopening just re-rendered that same state, which
      // reads as "the button opens settings" if settings was the last
      // thing viewed before closing. The button is the tracker's main
      // entry point, so opening it should always land on the character
      // list — same reset the back button already does.
      activeCharacter = null;
      activeDetailTab = "meters";
      activeItem = null;
      // Render AFTER showing, and guard it: a render error must never
      // hide the panel or throw out of this handler.
      try {
        renderPanel();
      } catch (e) {
        console.error("[ObsessionMeter] renderPanel() threw:", e);
      }
      try {
        ensurePanelOnScreen();
      } catch (e) {
        console.error("[ObsessionMeter] ensurePanelOnScreen() threw:", e);
      }
    }
  }

  // ---------------------------------------------------------------
  // Dragging (button drags independently; panel drags by its own
  // header bar once open — same two-tier drag model as Phone UI)
  // ---------------------------------------------------------------

  // THE BUG (this one's the big one): every plain click also fires a
  // pointerdown -> pointerup pair, since dragging is implemented on
  // those events. The old endDrag() called onDrop() — and therefore set
  // suppressClick = true — on EVERY pointerup, whether or not the
  // pointer actually moved. The button's click handler checks
  // suppressClick and bails if it's set, but the browser dispatches the
  // native `click` event immediately after pointerup/mouseup, well
  // before the 50ms setTimeout() that clears the flag ever runs. Net
  // effect: suppressClick was always true by the time click ran, so a
  // plain tap on the heart-crack button could never open the panel at
  // all — not "sometimes," not "on some builds," always. This alone
  // would produce exactly "everything looks correct, nothing shows up,"
  // independent of anything else in this file. Fixed by only treating
  // it as a drag (and only suppressing the following click) once the
  // pointer has actually moved past a small threshold.
  // BUGFIX (this is the one causing "button reacts, panel never
  // opens"): dragging works via setPointerCapture() on pointerdown,
  // which is necessary so drag keeps tracking even if the pointer
  // strays off the element mid-drag. But on a number of mobile
  // browsers/WebViews — which is most of how SillyTavern actually
  // gets used — capturing the pointer like this is known to suppress
  // the *native* `click` event that would normally fire afterward on
  // pointerup. The old code depended entirely on that native click
  // (gated by a suppressClick flag) to open the panel, so on any
  // browser with that quirk, a plain tap dragged+captured the pointer
  // exactly like it should, but the click that was supposed to open
  // the panel simply never arrived — nothing to catch, nothing to log,
  // it just silently never fires. Fixed by not depending on the native
  // click event at all: an optional onTap callback fires directly from
  // our own pointerup handler whenever the pointer didn't move past
  // the drag threshold, so opening the panel no longer depends on the
  // browser synthesizing a click correctly after a captured pointer.
  // BUGFIX: saved drag positions (panelX/panelY, topBtnX/topBtnY) were
  // applied on load with no bounds check. A position saved on a wider
  // or taller viewport (desktop testing, landscape, a different phone)
  // can be completely outside a smaller viewport's visible area — the
  // element still exists and still renders, it's just parked off-
  // screen, which looks exactly like "invisible." Clamping on apply
  // (not just during drag) makes a stale/foreign saved position always
  // resolve back onto the current screen.
  function clampToViewport(x, y, elWidth, elHeight) {
    // A corrupted/non-numeric saved value shouldn't propagate into a
    // NaN style.left (which renders as if no position were set at
    // all, i.e. wherever the element's default CSS puts it) — treat
    // it as "no saved position" instead of clamping garbage.
    if (!Number.isFinite(x) || !Number.isFinite(y)) return [0, 0];
    const w = elWidth || 40;
    const h = elHeight || 40;
    const maxX = Math.max(0, window.innerWidth - w);
    const maxY = Math.max(0, window.innerHeight - h);
    return [Math.max(0, Math.min(maxX, x)), Math.max(0, Math.min(maxY, y))];
  }

  function makeDraggable(el, onDrop, handleEl, onTap) {
    const dragHandle = handleEl || el;
    let dragging = false;
    let moved = false;
    let startX, startY, origX, origY;
    const MOVE_THRESHOLD = 12; // px — below this, it's a tap, not a drag

    // BUGFIX (root cause of "button reacts on Termux/mobile, panel never
    // opens" across every earlier attempt): every previous version of
    // this function routed the tap itself through a pointer/touch
    // "gesture" state machine, and only fell back to the plain `click`
    // event when that state machine hadn't already claimed the
    // interaction. That's backwards for reliability: pointerdown/
    // pointerup and touchstart/touchend are exactly the events that
    // Android WebViews are inconsistent about — the OS's own scroll/
    // gesture recognizer can swallow pointerup or touchend mid-tap even
    // with touch-action:none set, and when that happens the tap simply
    // never resolves, with nothing to log.
    //
    // `click` does not have this problem. Every environment that can
    // register a tap on an element — including ones with partial or
    // absent Pointer/Touch Events support — fires a plain `click` for
    // it; it's the one event a tap is guaranteed to produce. So click
    // is now the SOLE trigger for onTap(), unconditionally, every
    // time. Pointer/touch events are used only to detect an actual
    // drag (real, sustained finger movement past MOVE_THRESHOLD) and
    // to suppress the one click that follows a real drag — they no
    // longer gate whether a tap fires at all.
    let suppressNextClick = false;

    function startGesture(x, y) {
      dragging = true;
      moved = false;
      startX = x;
      startY = y;
      const rect = el.getBoundingClientRect();
      origX = rect.left;
      origY = rect.top;
    }

    function moveGesture(x, y) {
      if (!dragging) return;
      const dx = x - startX;
      const dy = y - startY;
      if (Math.abs(dx) > MOVE_THRESHOLD || Math.abs(dy) > MOVE_THRESHOLD) {
        moved = true;
      }
      let nx = origX + dx;
      let ny = origY + dy;
      nx = Math.max(0, Math.min(window.innerWidth - el.offsetWidth, nx));
      ny = Math.max(0, Math.min(window.innerHeight - el.offsetHeight, ny));
      el.style.left = `${nx}px`;
      el.style.top = `${ny}px`;
      el.style.right = "auto";
      el.style.bottom = "auto";
    }

    function endGesture() {
      if (!dragging) return;
      dragging = false;
      if (moved) {
        // A real drag happened — reposition, and swallow the `click`
        // that the browser fires right after pointerup/touchend so it
        // doesn't also toggle the panel. The click is only suppressed
        // once; if it never arrives (some environments don't fire one
        // after a drag) the flag is cleared shortly after anyway so it
        // can never get stuck suppressing a future, unrelated tap.
        suppressNextClick = true;
        setTimeout(() => {
          suppressNextClick = false;
        }, 400);
        const rect = el.getBoundingClientRect();
        onDrop(rect.left, rect.top);
      }
      // A plain tap (moved === false) does nothing here — onTap() is
      // fired exclusively from the click listener below, once, for
      // every environment.
    }

    dragHandle.addEventListener("pointerdown", (e) => {
      if (e.target.closest(".om-no-drag")) return;
      startGesture(e.clientX, e.clientY);
      try {
        dragHandle.setPointerCapture(e.pointerId);
      } catch (err) {
        /* capture not supported/failed — drag tracking still works below */
      }
    });
    dragHandle.addEventListener("pointermove", (e) => moveGesture(e.clientX, e.clientY));
    dragHandle.addEventListener("pointerup", endGesture);
    dragHandle.addEventListener("pointercancel", endGesture);

    // Raw touch events as an independent path, purely for drag
    // tracking on WebViews where touch fires but Pointer Events don't
    // (or behave oddly). Guarded so a device that fires both doesn't
    // double-start the same drag.
    dragHandle.addEventListener(
      "touchstart",
      (e) => {
        if (dragging) return;
        if (e.target.closest(".om-no-drag")) return;
        const t = e.touches && e.touches[0];
        if (t) startGesture(t.clientX, t.clientY);
      },
      { passive: true }
    );
    dragHandle.addEventListener(
      "touchmove",
      (e) => {
        const t = e.touches && e.touches[0];
        if (t) moveGesture(t.clientX, t.clientY);
      },
      { passive: true }
    );
    dragHandle.addEventListener("touchend", endGesture);
    dragHandle.addEventListener("touchcancel", endGesture);

    // The single, unconditional source of truth for taps. Doesn't
    // check any pointer/touch flag — if a real drag just finished,
    // suppressNextClick swallows this one click; otherwise it's a tap
    // and onTap() fires, full stop.
    dragHandle.addEventListener("click", (e) => {
      if (e.target.closest(".om-no-drag")) return;
      if (suppressNextClick) {
        suppressNextClick = false;
        return;
      }
      if (onTap) onTap();
    });
  }


  // ---------------------------------------------------------------
  // DOM setup
  // ---------------------------------------------------------------

  // BUGFIX (the actual "invisible UI" bug): unlike Phone UI, this file
  // only ever set panelEl.style.display / relied on plain stylesheet
  // rules for position/z-index — none of it marked !important. A
  // single host-page or ST-theme rule that happens to also target
  // position, z-index, visibility, opacity, or pointer-events (even
  // indirectly, e.g. a blanket `.some-parent *` or a later stylesheet
  // simply loading after ours) can silently win the cascade and zero
  // this out with nothing to catch or log — no error, no console
  // output, the elements are still in the DOM and everything "worked,"
  // they just don't paint or don't sit where they should. Phone UI
  // guards against exactly this with forceFixedStyle(): inline styles
  // set via !important outrank any external stylesheet rule (even one
  // that's also !important, since inline wins ties), so this is a hard
  // guarantee nothing else on the page can bury or blank these two
  // elements. Ported here verbatim and applied to both the panel and
  // the top-bar button, plus re-asserted after every render (belt-and-
  // suspenders, same as Phone UI's post-reset re-assertion) in case a
  // re-render replaces attributes in a way a host rule could exploit.

  // Appends `el` to whichever of <html>/<body> actually renders a
  // `position: fixed` element correctly on THIS browser/WebView,
  // instead of assuming one always works. Past versions of this file
  // picked <body> (broke on hosts that apply CSS transforms to
  // <body>, which re-anchors fixed children to the transformed
  // ancestor instead of the viewport), then switched to <html>
  // (reportedly broken on some Android WebView/Electron builds
  // instead). Both claims are plausible and neither is universally
  // true, so rather than guess again: append to <html> first, measure
  // the element's actual on-screen rect after layout, and if it comes
  // back zero-size/off-screen, remove it and retry against <body>
  // instead. Whichever one actually paints wins, per-device, with no
  // guesswork.
  function mountFixedEl(el, label) {
    const primary = document.documentElement || document.body;
    const fallback = document.documentElement ? document.body : null;
    primary.appendChild(el);
    forceFixedStyle(el);
    requestAnimationFrame(() => {
      const r = el.getBoundingClientRect();
      const painted = r.width > 0 && r.height > 0;
      if (!painted && fallback && el.parentNode === primary) {
        console.warn(
          `[ObsessionMeter] ${label || "element"} rendered with zero size on <${primary.tagName.toLowerCase()}> ` +
            `(width=${r.width}, height=${r.height}) — retrying on <${fallback.tagName.toLowerCase()}>.`
        );
        fallback.appendChild(el);
        forceFixedStyle(el);
      }
    });
  }

  function forceFixedStyle(el) {
    if (!el) return;
    el.style.setProperty("position", "fixed", "important");
    // BUGFIX: absolute maximum z-index (2147483647) so nothing on the
    // page — including ST's own modals/drawers/overlays — can stack
    // above the panel or button. Previously 2147483646, one below max,
    // which left room for a host element at the true max to bury it.
    el.style.setProperty("z-index", "2147483647", "important");
    el.style.setProperty("visibility", "visible", "important");
    el.style.setProperty("opacity", "1", "important");
    el.style.setProperty("pointer-events", "auto", "important");
    // BUGFIX: bake the panel's essential look inline too, so it stays
    // visible even if style.css never applies (a theme rule, a CSP
    // stripping the stylesheet, or a host-page rule that blanks the
    // element). These mirror the stylesheet values; the stylesheet
    // still wins when it loads, since they're the same values.
    if (el.id === "om-panel") {
      // NOTE: display is intentionally NOT set here — it's controlled
      // by togglePanel()/openPanelForce() (flex when open, none when
      // closed). Forcing flex here would override the close state.
      el.style.setProperty("flex-direction", "column", "important");
      el.style.setProperty("width", "300px", "important");
      el.style.setProperty("max-width", "calc(100vw - 24px)", "important");
      el.style.setProperty("max-height", "460px", "important");
      el.style.setProperty("min-height", "120px", "important");
      el.style.setProperty("background", "#16111a", "important");
      el.style.setProperty("border", "1px solid #3d2a45", "important");
      el.style.setProperty("border-radius", "12px", "important");
      el.style.setProperty("overflow", "hidden", "important");
      el.style.setProperty("color", "#e8dcee", "important");
      el.style.setProperty("box-shadow", "0 8px 30px rgba(0,0,0,0.6)", "important");
    }
  }

  // Builds the panel element if it doesn't already exist, and returns
  // whether it's ready to use. BUGFIX: the panel used to be created
  // only inside buildUi() during init. If anything in that step threw
  // (a host-page/theme quirk, a render error, etc.), panelEl stayed
  // null forever — and since togglePanel()/openPanelForce() guard on
  // `if (panelEl)`, clicking the button silently did nothing even
  // though the button itself rendered fine (it's built in a separate,
  // isolated init step). Building the panel lazily on demand means the
  // button always opens it, no matter what happened during init.
  function ensurePanelBuilt() {
    if (panelEl && panelEl.isConnected) return true;
    const s = getGlobalSettings();

    // Round floating button removed — it wasn't rendering for at
    // least one real setup and was just adding a second, redundant
    // entry point on top of the top-bar button. The panel itself
    // (built below) is unaffected — it's still opened via the
    // top-bar button, buildTopBarButton()'s makeDraggable/onTap, or
    // the /om slash command.
    buttonEl = null;

    panelEl = document.createElement("div");
    panelEl.id = "om-panel";
    // BUGFIX: was `panelEl.style.display = "none"` — a plain inline
    // style with no !important, which any later-loaded/higher-
    // specificity stylesheet rule can override (e.g. a rule that sets
    // `display: flex` on a wide selector would make the panel appear
    // permanently open and unclosable, or the reverse: a `display:
    // none` rule elsewhere could keep it hidden even once panelOpen
    // is true and this file thinks it set flex). Using a dedicated
    // !important class (om-hidden, added in style.css) for the
    // hidden state means the shown/hidden toggle can't be silently
    // won by anything else on the page — see togglePanel/
    // openPanelForce below, which now toggle this class instead of
    // writing style.display directly.
    panelEl.classList.add("om-hidden");
    if (s.panelX !== null && s.panelY !== null) {
      const [px, py] = clampToViewport(s.panelX, s.panelY, 320, 400);
      panelEl.style.left = `${px}px`;
      panelEl.style.top = `${py}px`;
      panelEl.style.right = "auto";
      panelEl.style.bottom = "auto";
    }
    // BUGFIX: was document.body.appendChild(panelEl). On some ST
    // layouts/mobile skins, <body> or an intermediate wrapper has a
    // CSS transform applied (used by swipe/drawer libraries) — which
    // silently breaks `position: fixed` for anything nested inside
    // it, re-anchoring it to that transformed ancestor instead of the
    // viewport. Appending straight to <html> instead keeps this
    // element outside whatever ST is transforming, same fix Phone UI
    // already uses.
    //
    // Neither <html> nor <body> is universally safe across every
    // browser/WebView this extension might run in — reports disagree
    // on which one actually paints `position: fixed` children
    // correctly on a given build, and this file has flip-flopped on
    // it before. Rather than pick one on faith again, mountFixedEl()
    // appends to <html> first, measures whether it actually rendered
    // with real on-screen pixels, and automatically retries against
    // <body> if it didn't — so the correct container is detected at
    // runtime instead of assumed.
    mountFixedEl(panelEl, "panel");
    forceFixedStyle(panelEl);

    // BUGFIX: renderPanel() (-> renderPanelBody()) can throw on bad
    // per-chat data. It used to be called unguarded here, so a throw
    // propagated straight out of ensurePanelBuilt() — which, before the
    // init() fix above, could take the top-bar button down with it, and
    // even now would otherwise leave panelEl appended-but-connected with
    // nothing to show, so the `if (panelEl && panelEl.isConnected)
    // return true` guard at the top of this function would skip
    // retrying the render on every later open. Catching it here means
    // the panel element always exists and is appendable/openable even
    // if its first render attempt failed, and the error is visible
    // instead of silently aborting setup.
    try {
      renderPanel();
    } catch (e) {
      console.error("[ObsessionMeter] renderPanel() failed during initial build:", e);
    }

    // Panel drags by its own header once it exists — re-bind on every
    // render since header markup is regenerated each time.
    const observer = new MutationObserver(() => {
      // Belt-and-suspenders: re-assert every time renderPanel()
      // rewrites panelEl's innerHTML, in case that rewrite ever
      // touches an attribute a host-page rule keys off of.
      forceFixedStyle(panelEl);
      const header = panelEl.querySelector(".om-panel-header");
      if (header && !header.dataset.dragBound) {
        header.dataset.dragBound = "1";
        makeDraggable(
          panelEl,
          (x, y) => {
            const gs = getGlobalSettings();
            gs.panelX = x;
            gs.panelY = y;
            saveGlobalSettings();
          },
          header
        );
      }
    });
    observer.observe(panelEl, { childList: true, subtree: true });
    return true;
  }

  // Kept as a thin wrapper so the init step list (and any external
  // reference) still calls buildUi() by name; it just defers to the
  // lazy builder now.
  function buildUi() {
    ensurePanelBuilt();
  }

  // ---------------------------------------------------------------
  // Top bar icon
  //
  // The floating draggable button lives in document.body with a fixed
  // position — on some ST layouts/themes/mobile browsers that ends up
  // covered by other fixed elements, clipped by a transformed
  // ancestor, or just off the visible viewport, which is exactly what
  // "nothing shows" looks like. ST's own top-of-screen icon row
  // (#top-settings-holder — same place the AI Response Configuration,
  // User Settings, etc. icons live) doesn't have that problem: it's
  // laid out by ST itself, always on screen, and never draggable out
  // of view. This adds a matching icon there as a second, more
  // reliable entry point. The floating button/panel and every other
  // fallback (/om, the Extensions drawer) are untouched and still
  // work exactly as before — this only adds one more way in.
  // ---------------------------------------------------------------

  // BUGFIX: this previously inserted into ST's own #top-settings-holder,
  // piggybacking on its "drawer" markup/CSS. Two problems with that,
  // now that it's come up twice: (1) that container's contents and
  // CSS differ across ST themes/versions, so depending on its exact
  // structure is exactly the kind of thing that can render as "the UI
  // doesn't show up at all" on a build that doesn't match; (2) reusing
  // ST's own ".drawer"/".drawer-toggle" classes means ST's own
  // delegated click handling (which expects a matching ".drawer-content"
  // sibling to toggle) is also acting on this element, which is a
  // second source of "looks right, does nothing" bugs.
  //
  // This now builds its own small fixed strip pinned to the very top
  // of the viewport instead — it owns 100% of its own markup and CSS,
  // doesn't read or depend on any ST-internal element existing, and
  // can't be affected by ST's own click delegation. That makes it
  // strictly more reliable than hooking into ST's bar, at the cost of
  // not visually blending into ST's own icon row.
  // BUGFIX: everything about how this button actually *looks* —
  // background, padding, border-radius, text color, its default
  // top/right offsets — previously lived entirely in style.css.
  // forceFixedStyle() only guarantees position/z-index/visibility/
  // opacity/pointer-events via inline styles; it never covered the
  // rest. If style.css 404s, gets stripped by ST's asset pipeline, or
  // simply never gets applied on some ST build/CSP setup, none of
  // that shows up as an error anywhere — the element is still in the
  // DOM, still "visible" per forceFixedStyle, it's just an unstyled
  // block with no offsets, which on some layouts renders with zero
  // effective size or gets pushed somewhere off the visible area.
  // That's indistinguishable from "the button doesn't show up" with
  // nothing in the console to point at it. Setting the essential
  // look/position inline (redundant with style.css, which still wins
  // when it does load, since these are the same values) means the
  // button is guaranteed visible even if the external stylesheet
  // never applies at all.
  // ---------------------------------------------------------------
  // Top-bar icon — lives INSIDE SillyTavern's own icon row
  // (#top-settings-holder, confirmed against ST's current index.html:
  // it's the container that holds the AI Response Configuration,
  // User Settings, etc. icons) instead of a self-positioned floating
  // element. Two concrete reliability wins over the floating-button
  // approach: (1) it's laid out by ST itself, so it can't end up
  // covered by other fixed elements, clipped by a transformed
  // ancestor, or parked off the visible viewport — all real failure
  // modes a fixed-position element is exposed to; (2) it participates
  // in ST's existing flex row, so it's centered/aligned the same way
  // every other icon in that row already is, with no custom
  // positioning math of our own to get wrong.
  //
  // A previous version of this file tried this same idea and reverted
  // it after two specific problems: (a) it depended on the exact
  // internal structure of #top-settings-holder, which differs across
  // ST themes/versions, and (b) it reused ST's own ".drawer" /
  // ".drawer-toggle" classes, which made ST's own delegated
  // drawer-toggle click handling also act on this element — a second,
  // independent source of "looks right, does nothing." This version
  // avoids both: it only depends on the *container* existing (nothing
  // about its internal markup), and the icon carries none of ST's
  // drawer classes — only its own id and its own click handling.
  //
  // If #top-settings-holder isn't present at all (an ST build/theme
  // where it's been renamed or restructured), this falls back to a
  // small fixed corner icon so the feature is never just silently
  // absent — degraded, but still there and still clickable.
  // ---------------------------------------------------------------

  let topBarWatchdogHandle = null;

  function styleTopBarIcon(icon) {
    icon.style.setProperty("display", "inline-flex", "important");
    icon.style.setProperty("align-items", "center", "important");
    icon.style.setProperty("justify-content", "center", "important");
    icon.style.setProperty("cursor", "pointer", "important");
    icon.style.setProperty("color", "#d98fc4", "important");
    icon.style.setProperty("pointer-events", "auto", "important");
    icon.style.setProperty("-webkit-tap-highlight-color", "rgba(217,143,196,0.4)", "important");
  }

  // Inserts the icon into ST's own icon row, at the middle position
  // among whatever icons are already there (rather than appended at
  // the end), so it visually sits among ST's own icons instead of
  // trailing after all of them.
  function createTopBarIconInHolder(holder) {
    const icon = document.createElement("div");
    icon.id = "om-topbar-button";
    icon.className = "fa-solid fa-heart-crack fa-fw";
    icon.title = "Obsession Meter";
    icon.setAttribute("role", "button");
    icon.setAttribute("aria-label", "Obsession Meter");
    styleTopBarIcon(icon);
    const kids = holder.children;
    const midIndex = kids && kids.length ? Math.floor(kids.length / 2) : 0;
    const refNode = kids && kids.length ? kids[midIndex] : null;
    if (refNode) {
      holder.insertBefore(icon, refNode);
    } else {
      holder.appendChild(icon);
    }
    return icon;
  }

  // Fallback used only when #top-settings-holder can't be found at
  // all: a small fixed-position icon, same id/behavior, just not
  // living inside ST's own layout.
  function createFallbackTopBarIcon() {
    const icon = document.createElement("div");
    icon.id = "om-topbar-button";
    icon.className = "fa-solid fa-heart-crack fa-fw";
    icon.title = "Obsession Meter";
    icon.setAttribute("role", "button");
    icon.setAttribute("aria-label", "Obsession Meter");
    mountFixedEl(icon, "fallback topbar icon");
    styleTopBarIcon(icon);
    icon.style.setProperty("top", "6px", "important");
    icon.style.setProperty("right", "20px", "important");
    icon.style.setProperty("font-size", "18px", "important");
    icon.style.setProperty("background", "#2a1830", "important");
    icon.style.setProperty("border", "1px solid #5a3a66", "important");
    icon.style.setProperty("border-radius", "999px", "important");
    icon.style.setProperty("padding", "6px", "important");
    return icon;
  }

  function ensureTopBarIconExists() {
    if (document.getElementById("om-topbar-button")) return;
    const holder = document.getElementById("top-settings-holder");
    if (holder) {
      createTopBarIconInHolder(holder);
    } else {
      console.warn(
        "[ObsessionMeter] #top-settings-holder not found — falling back to a floating corner icon."
      );
      createFallbackTopBarIcon();
    }
  }

  function buildTopBarButton() {
    ensureTopBarIconExists();

    // Delegated listener bound once to `document`, forever — doesn't
    // care whether the icon lives inside ST's holder or the fallback
    // position, or whether it gets recreated later; it just matches
    // on id.
    if (!document.__omTopBarClickDelegated) {
      document.__omTopBarClickDelegated = true;
      document.addEventListener("click", (e) => {
        const hit = e.target && e.target.closest && e.target.closest("#om-topbar-button");
        if (hit) togglePanel();
      });
    }

    // Watchdog: re-insert the icon if it's ever missing, and
    // re-evaluate whether #top-settings-holder exists yet each time
    // (in case ST's own UI wasn't fully built the first time this
    // ran and the icon had to use the fallback position initially).
    if (topBarWatchdogHandle) clearInterval(topBarWatchdogHandle);
    topBarWatchdogHandle = setInterval(() => {
      if (!document.getElementById("om-topbar-button")) {
        console.warn("[ObsessionMeter] top-bar icon vanished from the DOM — rebuilding it.");
      }
      ensureTopBarIconExists();
    }, 2000);
  }

  // ---------------------------------------------------------------
  // ST event wiring
  // ---------------------------------------------------------------

  function extractLatestMessageText(payload) {
    // ST's MESSAGE_RECEIVED-style events vary in shape across
    // versions - accept a few common ones defensively, same spirit as
    // Phone UI's own message ingestion.
    if (typeof payload === "string") return payload;
    if (payload && typeof payload.mes === "string") return payload.mes;
    // Always re-fetch chat fresh rather than trusting the context
    // snapshot from boot — see getFreshContext()'s comment. `chat` gets
    // reassigned (not just mutated) on chat/character switches, so a
    // cached reference silently stops matching what's on screen.
    const fresh = getFreshContext();
    const chatArr = fresh && Array.isArray(fresh.chat) ? fresh.chat : context.chat;
    try {
      if (Array.isArray(chatArr) && chatArr.length) {
        // MESSAGE_RECEIVED/CHARACTER_MESSAGE_RENDERED typically pass the
        // message's index (mesId) as payload — prefer indexing directly
        // by it when it's valid, falling back to "last message" only
        // when it isn't (e.g. an unexpected payload shape).
        if (typeof payload === "number" && chatArr[payload] && typeof chatArr[payload].mes === "string") {
          return chatArr[payload].mes;
        }
        const last = chatArr[chatArr.length - 1];
        if (last && typeof last.mes === "string") return last.mes;
      }
    } catch (e) {
      /* no chat available */
    }
    return "";
  }

  // BUGFIX: previously this bound the same handler to both
  // MESSAGE_RECEIVED and CHARACTER_MESSAGE_RENDERED. On most ST
  // builds both events fire for the *same* incoming message, so tags
  // in that message got applied twice — a `love+5` silently became
  // +10, one [DIARY:...] entry got written twice, one inventory add
  // got added twice, etc. We keep listening to both events (still
  // useful, since which one actually fires varies by ST version) but
  // dedupe so a given message is only ever processed once.
  let lastHandledSignature = null;

  // BUGFIX: this used to key purely on message index (`idx:${payload}`)
  // when the event gave us a numeric payload, ignoring `text` entirely.
  // MESSAGE_RECEIVED and CHARACTER_MESSAGE_RENDERED report the *same*
  // index for the *same* message, but they don't always fire with the
  // same text — on builds/setups where the message streams in, an
  // early firing can carry partial text with no tag yet, and a later
  // firing at that same index carries the finished text with the
  // [STATS:...]/[DIARY:...]/[INVENTORY:...] tag actually in it. Keying
  // on index alone meant the first (tag-less) firing "claimed" that
  // index, and the second, complete firing was treated as a duplicate
  // and thrown away — silently, since nothing errors. The tag was
  // there, it just never got read. Folding the text length into the
  // signature (not just the index) means two firings only count as
  // duplicates if their content actually matches.
  function messageSignature(payload, text) {
    if (typeof payload === "number") return `idx:${payload}:len:${text.length}`;
    try {
      const fresh = getFreshContext();
      const chatArr = fresh && Array.isArray(fresh.chat) ? fresh.chat : context.chat;
      if (Array.isArray(chatArr)) {
        return `len:${chatArr.length}:${text.length}`;
      }
    } catch (e) {
      /* fall through */
    }
    return null;
  }

  function wireEvents() {
    // Belt-and-suspenders: normalize here too, not just in
    // resolveContext(), in case `context` ever gets rebuilt or replaced
    // some other way in the future.
    const evt = context.event_types || context.eventTypes;
    if (!context.eventSource || !evt) {
      showLoadError(
        "eventSource/event_types unavailable — message tag parsing disabled. Stats/diary/inventory tags will not be read even though the button and panel work."
      );
      return;
    }
    const handler = (payload) => {
      const text = extractLatestMessageText(payload);
      const sig = messageSignature(payload, text);
      if (sig !== null && sig === lastHandledSignature) return;
      lastHandledSignature = sig;
      handleIncomingMessage(text);
      applyDecayTick();
    };
    if (evt.MESSAGE_RECEIVED) context.eventSource.on(evt.MESSAGE_RECEIVED, handler);
    if (evt.CHARACTER_MESSAGE_RENDERED) context.eventSource.on(evt.CHARACTER_MESSAGE_RENDERED, handler);

    // Loading a different chat/character swaps in a whole new chat
    // object behind the scenes (see getFreshContext()'s comment) — the
    // panel's own drilled-in state (which character/tab/item you had
    // open) belongs to the chat you just left, so drop back to the
    // list and repaint against whatever chat is now current.
    if (evt.CHAT_CHANGED) {
      context.eventSource.on(evt.CHAT_CHANGED, () => {
        lastHandledSignature = null;
        activeCharacter = null;
        activeDetailTab = "meters";
        activeItem = null;
        if (panelOpen) renderPanel();
      });
    }
  }

  // ---------------------------------------------------------------
  // Extensions-tab settings drawer
  //
  // The floating button is easy to lose track of — it can end up
  // parked off-screen after a window resize, buried under other UI,
  // or just easy to miss on a crowded page. This drawer lives in
  // SillyTavern's own Extensions panel (same place every other
  // extension's settings live), so there's always a reliable way in
  // regardless of what's going on with the floating button/panel.
  // It duplicates the same settings fields as the panel's own
  // Settings tab (same underlying data, just a second way to reach
  // it) plus two controls the floating UI can't offer itself: a
  // button to force the panel open, and one to reset the button/panel
  // back to their default position if they've drifted somewhere
  // unreachable.
  // ---------------------------------------------------------------

  function findExtensionsSettingsContainer() {
    return (
      document.getElementById("extensions_settings2") ||
      document.getElementById("extensions_settings")
    );
  }

  function renderDrawerHtml() {
    return `<div class="om-drawer-actions">
        <button class="menu_button om-drawer-open-btn"><i class="fa-solid fa-heart-crack"></i> Open panel</button>
        <button class="menu_button om-drawer-reset-btn"><i class="fa-solid fa-arrows-to-dot"></i> Reset button/panel position</button>
      </div>
      <p class="om-imagegen-help">If the floating heart-crack button isn't visible on the
      page, use "Open panel" above — it'll open the panel directly regardless.
      If it opened somewhere off-screen or you just want everything back where
      it started, use "Reset position". You can also type <code>/om</code> in
      the chat box and send it to open the panel the same way, without relying
      on any button at all (works even if the button never renders).</p>
      <div class="om-drawer-fields">${renderSettingsFieldsHtml()}</div>`;
  }

  function refreshDrawer(drawerBody) {
    drawerBody.innerHTML = renderDrawerHtml();
    attachDrawerHandlers(drawerBody);
  }

  function attachDrawerHandlers(drawerBody) {
    const openBtn = drawerBody.querySelector(".om-drawer-open-btn");
    if (openBtn) {
      openBtn.addEventListener("click", openPanelForce);
    }
    const resetBtn = drawerBody.querySelector(".om-drawer-reset-btn");
    if (resetBtn) {
      resetBtn.addEventListener("click", () => {
        const s = getGlobalSettings();
        s.buttonX = null;
        s.buttonY = null;
        s.panelX = null;
        s.panelY = null;
        s.topBtnX = null;
        s.topBtnY = null;
        saveGlobalSettings();
        if (buttonEl) {
          buttonEl.style.left = "";
          buttonEl.style.top = "";
          buttonEl.style.right = "20px";
          buttonEl.style.bottom = "90px";
        }
        if (panelEl) {
          panelEl.style.left = "";
          panelEl.style.top = "";
          panelEl.style.right = "20px";
          panelEl.style.bottom = "150px";
        }
        const topBtn = document.getElementById("om-topbar-button");
        if (topBtn) {
          topBtn.style.left = "";
          topBtn.style.top = "6px";
          topBtn.style.right = "20px";
        }
      });
    }
    attachSettingsFieldHandlers(drawerBody, () => refreshDrawer(drawerBody));
  }

  function buildSettingsDrawer() {
    const container = findExtensionsSettingsContainer();
    if (!container) {
      console.warn("[ObsessionMeter] Could not find the Extensions settings panel to add a drawer to.");
      return;
    }
    const drawer = document.createElement("div");
    drawer.className = "inline-drawer om-settings-drawer";
    drawer.innerHTML = `
      <div class="inline-drawer-toggle inline-drawer-header">
        <b>Obsession Meter</b>
        <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
      </div>
      <div class="inline-drawer-content"></div>`;
    container.appendChild(drawer);
    const body = drawer.querySelector(".inline-drawer-content");
    refreshDrawer(body);
  }

  // ---------------------------------------------------------------
  // Slash command fallback
  //
  // On mobile in particular, a fixed-position floating button can
  // end up invisible for reasons that have nothing to do with this
  // extension's own CSS — covered by ST's own mobile chrome, clipped
  // by a transformed ancestor, etc. A slash command sidesteps all of
  // that: it doesn't depend on any element being visible, positioned
  // correctly, or even present in the DOM at all, only on the chat
  // input existing. Registration is tried across a few ST slash
  // command APIs since the "correct" one has moved between versions;
  // if none match, this just quietly does nothing and the
  // button/drawer remain the only way in.
  // ---------------------------------------------------------------

  function openPanelForce() {
    panelOpen = true;
    // BUGFIX: build the panel on demand if it isn't there yet, so the
    // /om command and the drawer's "Open panel" button always work too.
    // CRITICAL FIX: same as togglePanel — if ensurePanelBuilt() throws,
    // the panel element exists but stays hidden. Wrap it so we always
    // force the panel visible regardless.
    try {
      ensurePanelBuilt();
    } catch (e) {
      console.error("[ObsessionMeter] ensurePanelBuilt() threw during openPanelForce:", e);
    }
    if (panelEl) {
      // Same position-before-reveal as togglePanel() — /om and the
      // drawer's "Open panel" button are just other doors into the
      // same panel, so they should open it the same way.
      try {
        positionPanelForOpen();
      } catch (e) {
        console.error("[ObsessionMeter] positionPanelForOpen() threw:", e);
      }
      // Class-only reveal, matching togglePanel()/Phone UI — see the
      // comment there for why the inline display write was removed.
      panelEl.classList.remove("om-hidden");
      forceFixedStyle(panelEl);
    }
    // BUGFIX: same reset as togglePanel's open branch — without this,
    // the drawer's "Open panel" button and /om had the identical
    // "reopens straight into whatever was last on screen" bug.
    activeCharacter = null;
    activeDetailTab = "meters";
    activeItem = null;
    try {
      renderPanel();
    } catch (e) {
      console.error("[ObsessionMeter] renderPanel() threw:", e);
    }
    try {
      ensurePanelOnScreen();
    } catch (e) {
      console.error("[ObsessionMeter] ensurePanelOnScreen() threw:", e);
    }
    return "";
  }

  function registerSlashCommand() {
    try {
      if (
        window.SlashCommandParser &&
        window.SlashCommand &&
        typeof window.SlashCommandParser.addCommandObject === "function" &&
        typeof window.SlashCommand.fromProps === "function"
      ) {
        window.SlashCommandParser.addCommandObject(
          window.SlashCommand.fromProps({
            name: "om",
            callback: openPanelForce,
            helpString: "Opens the Obsession Meter panel.",
          })
        );
        return;
      }
    } catch (e) {
      /* fall through to next strategy */
    }
    try {
      if (typeof window.registerSlashCommand === "function") {
        window.registerSlashCommand("om", openPanelForce, [], "Opens the Obsession Meter panel.", true, true);
        return;
      }
    } catch (e) {
      /* fall through */
    }
    try {
      if (context && typeof context.registerSlashCommand === "function") {
        context.registerSlashCommand("om", openPanelForce, [], "Opens the Obsession Meter panel.", true, true);
        return;
      }
    } catch (e) {
      /* fall through */
    }
    console.warn("[ObsessionMeter] Couldn't register a /om slash command on this ST build — button/drawer are the only way to open the panel.");
  }

  // ---------------------------------------------------------------
  // Boot
  // ---------------------------------------------------------------

  // BUGFIX (the real "nothing shows up at all" fix): init() used to
  // return early — building NO button and NO panel — whenever the
  // SillyTavern context couldn't be resolved (which is exactly what
  // happens on some Termux/WebView setups where
  // window.SillyTavern.getContext never becomes available and the
  // fallback module import also fails). The button and panel don't
  // actually need ST's context to render; they only need it for
  // persisting data. So instead of bailing out, we now build the UI
  // unconditionally against a minimal fallback context, then upgrade
  // to the real context in the background if/when it becomes
  // available. This guarantees the button and panel always appear.
  function makeFallbackContext() {
    const settings = {};
    return {
      extensionSettings: settings,
      saveSettingsDebounced: function () {},
      eventSource: null,
      event_types: null,
      chat: [],
      chatMetadata: {},
      saveMetadataDebounced: function () {},
      saveMetadata: function () {},
      characters: [],
      this_chid: 0,
      name1: "User",
      name2: "Character",
      executeSlashCommandsWithOptions: function () {},
      executeSlashCommands: function () {},
    };
  }

  async function init() {
    // Build the UI immediately against a fallback context so the
    // button and panel ALWAYS appear, even if ST's context is slow or
    // unavailable. We then try to swap in the real context in the
    // background.
    context = makeFallbackContext();
    // BUGFIX: buildUi() (== ensurePanelBuilt(), which also calls
    // renderPanel()/renderPanelBody()) and buildTopBarButton() used to
    // share ONE try/catch. If anything inside buildUi() threw — most
    // plausibly renderPanelBody() choking on stale per-chat character
    // data saved by an older version of this extension — the exception
    // jumped straight past buildTopBarButton() and it never ran. Net
    // effect: no panel AND no button AND no way to open the panel at
    // all (the /om command isn't registered until further down either),
    // with only a red error banner (easy to miss) as any sign something
    // went wrong. That's indistinguishable from "the panel just doesn't
    // show up." Each step now gets its own try/catch, same as the
    // `steps` list below, so a failure in one can never take out the
    // other — worst case you get the button without the panel body
    // rendering correctly, or vice versa, instead of losing both.
    try {
      buildUi();
    } catch (e) {
      showLoadError(`Panel build failed: ${e && e.stack ? e.stack : e}`);
    }
    try {
      buildTopBarButton();
    } catch (e) {
      showLoadError(`Top-bar button build failed: ${e && e.stack ? e.stack : e}`);
    }
    try {
      // BUGFIX (verified live): this used to call openPanelForce() here,
      // auto-opening the panel the instant the page loads. That leaves
      // panelOpen already true before anyone touches anything — so the
      // very first tap on the button runs togglePanel(), which flips an
      // already-true panelOpen to false and closes the panel that just
      // silently opened on its own. From the outside that's "nothing
      // happens when I click" (the open was invisible, the click is what
      // hides it). Just build the (hidden) panel and leave it closed
      // until the button/`/om`/drawer actually opens it.
      ensurePanelBuilt();
    } catch (e) {
      showLoadError(`ensurePanelBuilt() failed: ${e && e.stack ? e.stack : e}`);
    }

    let realContext = null;
    try {
      realContext = await resolveContext();
    } catch (e) {
      showLoadError(`resolveContext() threw: ${e && e.message ? e.message : e}`);
    }
    if (realContext && realContext.extensionSettings) {
      context = realContext;
    } else {
      showLoadError("Could not access SillyTavern extension context — the panel will show but stats won't persist until the page is reloaded with ST fully loaded.");
    }

    // Each step is isolated: a failure in one (e.g. the settings
    // drawer, or event wiring on an ST version with a slightly
    // different event shape) should not prevent the earlier ones —
    // most importantly the toggle button itself — from existing.
    // Previously an uncaught error anywhere in here silently killed
    // the whole init with nothing but a raw stack trace, which could
    // easily read as "the extension did nothing."
    const steps = [
      ["getGlobalSettings", getGlobalSettings],
      ["buildSettingsDrawer", buildSettingsDrawer],
      ["wireEvents", wireEvents],
      ["registerSlashCommand", registerSlashCommand],
    ];

    let hadError = false;
    for (const [stepName, fn] of steps) {
      try {
        fn();
      } catch (e) {
        hadError = true;
        showLoadError(`${stepName}() failed: ${e && e.stack ? e.stack : e}`);
      }
    }

    if (!hadError) {
      console.log("[ObsessionMeter] loaded.");
    } else {
      console.warn("[ObsessionMeter] loaded with errors — see above. UI may be partial/missing.");
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
