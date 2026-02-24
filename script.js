/* /script.js
   Find The Key! (Major keys)
*/
(() => {
    "use strict";
  
    const AUDIO_DIR = "audio";
  
    const OUTER_H = 320;
    const BORDER_PX = 19;
  
    const WHITE_W = 40;
    const WHITE_H = OUTER_H - (BORDER_PX * 2);
    const BLACK_W = Math.round(WHITE_W * 0.62);
    const BLACK_H = Math.round(WHITE_H * 0.63);
  
    const RADIUS = 18;
    const WHITE_CORNER_R = 10;
  
    const PRESELECT_COLOR_DEFAULT = "#6699ff";
    const CORRECT_COLOR = "#34c759";
    const WRONG_COLOR = "#ff6b6b";
  
    const LIMITER_THRESHOLD_DB = -6;
    const STOP_FADE_SEC = 0.05;
  
    const PLAY_LABEL_IDLE = "Play Track";
    const PLAY_LABEL_PLAYING = "Playing..";
  
    const UI_SELECT = "select1";
    const UI_BACK = "back1";
  
    const PC_TO_NOTE_STEM = {
      0: "c",
      1: "csharp",
      2: "d",
      3: "dsharp",
      4: "e",
      5: "f",
      6: "fsharp",
      7: "g",
      8: "gsharp",
      9: "a",
      10: "asharp",
      11: "b",
    };
  
    const PC_TO_KEY_FOLDER = {
      0: "c",
      1: "csharpdflat",
      2: "d",
      3: "dsharpeflat",
      4: "e",
      5: "f",
      6: "fsharpgflat",
      7: "g",
      8: "gsharpaflat",
      9: "a",
      10: "asharpbflat",
      11: "b",
    };
  
    const PC_LABEL = [
      "C",
      "C# / Db",
      "D",
      "D# / Eb",
      "E",
      "F",
      "F# / Gb",
      "G",
      "G# / Ab",
      "A",
      "A# / Bb",
      "B",
    ];
  
    const STORAGE_ALLOWED = "ftk_allowed_major_roots_v1";
  
    // C–B only (no top C)
    const KEYBOARD_PRESET_1OCT_C4 = { startOctave: 4, octaves: 1, endOnFinalC: false };
  
    const $ = (id) => document.getElementById(id);
  
    const mount = $("mount");
  
    const titleImg = $("titleImg");
    const instructions = $("instructions");
  
    const playBtn = $("playBtn");
    const stopBtn = $("stopBtn");
    const submitBtn = $("submitBtn");
    const nextBtn = $("nextBtn");
    const settingsBtn = $("settingsBtn");
    const infoBtn = $("infoBtn");
    const resetBtn = $("resetBtn");
    const downloadScoreBtn = $("downloadScoreBtn");
  
    const actionHint = $("actionHint");
    const feedbackOut = $("feedbackOut");
    const scoreOut = $("scoreOut");
  
    const modal = $("modal");
    const modalTitle = $("modalTitle");
    const modalBody = $("modalBody");
    const modalActions = $("modalActions");
    const modalKeyboardSection = $("modalKeyboardSection");
    const modalSelectionText = $("modalSelectionText");
    const modalMount = $("modalMount");
  
    if (
      !mount || !playBtn || !stopBtn || !submitBtn || !nextBtn || !settingsBtn || !infoBtn ||
      !resetBtn || !downloadScoreBtn || !feedbackOut || !scoreOut || !modal || !modalMount
    ) {
      const msg = "UI mismatch: required elements missing. Ensure index.html matches script.js IDs.";
      if (feedbackOut) feedbackOut.textContent = msg;
      else alert(msg);
      return;
    }
  
    function clampInt(v, min, max) {
      const n = Number(v);
      if (!Number.isFinite(n)) return min;
      return Math.max(min, Math.min(max, Math.trunc(n)));
    }
  
    function normalizePc(pc) {
      const n = Number(pc);
      return ((n % 12) + 12) % 12;
    }
  
    function randomInt(min, max) {
      const a = Math.ceil(min);
      const b = Math.floor(max);
      return Math.floor(Math.random() * (b - a + 1)) + a;
    }
  
    function randomChoice(arr) {
      if (!arr || !arr.length) return null;
      return arr[randomInt(0, arr.length - 1)];
    }
  
    function pcName(pc) {
      return PC_LABEL[normalizePc(pc)] || "—";
    }
  
    function keyName(pc) {
      return `${pcName(pc)} Major`;
    }
  
    function allowedRootsToArray(set) {
      return [...set].map(normalizePc).sort((a, b) => a - b);
    }


    function setsEqual(a, b) {
      if (a === b) return true;
      if (!a || !b) return false;
      if (a.size !== b.size) return false;
      for (const v of a) if (!b.has(v)) return false;
      return true;
    }
  
    function formatAllowedRoots(set) {
      const pcs = allowedRootsToArray(set);
      if (!pcs.length) return "None";
      return pcs.map(pcName).join(", ");
    }
  
    const DEFAULT_PROMPT_HTML =
      "Press <strong>Play Track</strong>, then find the <strong>Major key</strong>.";
    const DEFAULT_HINT_HTML =
      "Tip: audition notes on the keyboard. Submit the root note of the key.";
  
    function setDefaultPrompt() {
      setResult(DEFAULT_PROMPT_HTML);
      setHint(DEFAULT_HINT_HTML);
    }
  
    // --------------------
    // Audio
    // --------------------
    let audioCtx = null;
    let masterGain = null;
    let limiter = null;
  
    const bufferPromiseCache = new Map();
    const activeVoices = new Set(); // {src, gain, startTime, type}
  
    let isTrackPlaying = false;
    let playToken = 0;
  
    function ensureAudioGraph() {
      if (audioCtx) return audioCtx;
  
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) {
        alert("Your browser doesn’t support Web Audio (required for playback).");
        return null;
      }
  
      audioCtx = new Ctx();
  
      masterGain = audioCtx.createGain();
      masterGain.gain.value = 0.9;
  
      limiter = audioCtx.createDynamicsCompressor();
      limiter.threshold.value = LIMITER_THRESHOLD_DB;
      limiter.knee.value = 0;
      limiter.ratio.value = 20;
      limiter.attack.value = 0.001;
      limiter.release.value = 0.12;
  
      masterGain.connect(limiter);
      limiter.connect(audioCtx.destination);
  
      return audioCtx;
    }
  
    async function resumeAudioIfNeeded() {
      const ctx = ensureAudioGraph();
      if (!ctx) return;
      if (ctx.state === "suspended") {
        try { await ctx.resume(); } catch {}
      }
    }
  
    function trackVoice(src, gain, startTime, type) {
      const voice = { src, gain, startTime, type };
      activeVoices.add(voice);
      src.addEventListener("ended", () => activeVoices.delete(voice), { once: true });
      return voice;
    }
  
    function setTrackPlaying(on) {
      isTrackPlaying = on;
      playBtn.textContent = on ? PLAY_LABEL_PLAYING : PLAY_LABEL_IDLE;
      playBtn.classList.toggle("playing", on);
      updateControls();
    }
  
    function stopVoices(types = null, fadeSec = STOP_FADE_SEC) {
      const ctx = ensureAudioGraph();
      if (!ctx) return;
  
      const typeSet = types ? new Set(types) : null;
      const now = ctx.currentTime;
      const fade = Math.max(0.01, Number.isFinite(fadeSec) ? fadeSec : STOP_FADE_SEC);
  
      const stoppingTrack = !typeSet || typeSet.has("track");
      if (stoppingTrack && isTrackPlaying) {
        playToken += 1;
        setTrackPlaying(false);
      }
  
      for (const v of Array.from(activeVoices)) {
        if (typeSet && !typeSet.has(v.type)) continue;
        try {
          v.gain.gain.cancelScheduledValues(now);
          v.gain.gain.setTargetAtTime(0, now, fade / 6);
          const stopAt = Math.max(now + fade, (v.startTime || now) + 0.001);
          v.src.stop(stopAt + 0.02);
        } catch {}
      }
    }
  
    function loadBuffer(url) {
      if (bufferPromiseCache.has(url)) return bufferPromiseCache.get(url);
  
      const p = (async () => {
        const ctx = ensureAudioGraph();
        if (!ctx) return null;
  
        try {
          const res = await fetch(url);
          if (!res.ok) return null;
          const ab = await res.arrayBuffer();
          return await ctx.decodeAudioData(ab);
        } catch {
          return null;
        }
      })();
  
      bufferPromiseCache.set(url, p);
      return p;
    }
  
    function playBufferAt(buffer, whenSec, gain = 1, type = "note") {
      const ctx = ensureAudioGraph();
      if (!ctx || !masterGain) return null;
  
      const src = ctx.createBufferSource();
      src.buffer = buffer;
  
      const g = ctx.createGain();
      const safeGain = Math.max(0, Number.isFinite(gain) ? gain : 1);
      const fadeIn = 0.004;
  
      g.gain.setValueAtTime(0, whenSec);
      g.gain.linearRampToValueAtTime(safeGain, whenSec + fadeIn);
  
      src.connect(g);
      g.connect(masterGain);
      trackVoice(src, g, whenSec, type);
  
      src.start(whenSec);
      return src;
    }
  
    function noteUrlForPitchClass(pc, octaveNum) {
      const stem = PC_TO_NOTE_STEM[normalizePc(pc)];
      return `${AUDIO_DIR}/${stem}${octaveNum}.mp3`;
    }
  
    function trackUrlForKeyPc(pc, takeNumber) {
      const folder = PC_TO_KEY_FOLDER[normalizePc(pc)];
      return `${AUDIO_DIR}/${folder}/${clampInt(takeNumber, 1, 3)}.mp3`;
    }
  
    // (3) use correct1 / incorrect1
    function feedbackUrl(correct) {
      return `${AUDIO_DIR}/${correct ? "correct1" : "incorrect1"}.mp3`;
    }
  
    // (5) select/back UI sounds
    function uiSoundUrl(stem) {
      return `${AUDIO_DIR}/${stem}.mp3`;
    }
  
    async function playUiSound(stem) {
      if (isTrackPlaying) return;

      const ctx = ensureAudioGraph();
      if (!ctx) return;
      await resumeAudioIfNeeded();
  
      const url = uiSoundUrl(stem);
      const buf = await loadBuffer(url);
      if (!buf) return;
  
      stopVoices(["ui"], 0.02);
      playBufferAt(buf, ctx.currentTime, 1, "ui");
    }
  
    async function playNotePitch(pitchAbs, gain = 0.95) {
      const ctx = ensureAudioGraph();
      if (!ctx) return;
  
      const pc = pcFromPitch(pitchAbs);
      const oct = octFromPitch(pitchAbs);
  
      await resumeAudioIfNeeded();
  
      const url = noteUrlForPitchClass(pc, oct);
      const buf = await loadBuffer(url);
      if (!buf) {
        setResult(`Missing note audio: <code>${url}</code>`);
        return;
      }
  
      stopVoices(["note"], 0.03);
      playBufferAt(buf, ctx.currentTime, gain, "note");
    }
  
    // (1)(6)(7) Play-track wrapper with UI state + copy swap
    async function playTrackWithUi(url) {
      if (!started || !url) return;

      const ctx = ensureAudioGraph();
      if (!ctx) return;

      await resumeAudioIfNeeded();

      // Stop any previous audio first, otherwise we can immediately clear the "playing" UI state.
      stopVoices(["track", "feedback", "note"], 0.06);

      const token = (playToken += 1);
      setTrackPlaying(true);

      if (!awaitingNext) {
        setResult("Track playing.. It may take a second to load!");
        setHint("");
      }

      const buf = await loadBuffer(url);

      // User may have pressed Stop (or started another track) while this track was loading.
      if (playToken !== token) return;

      if (!buf) {
        setTrackPlaying(false);
        setResult(`Missing track audio: <code>${url}</code>`);
        return;
      }

      const src = playBufferAt(buf, ctx.currentTime, 1, "track");
      if (!src) {
        if (playToken === token) setTrackPlaying(false);
        return;
      }

      src.addEventListener("ended", () => {
        if (playToken !== token) return;
        setTrackPlaying(false);

        // Restore the default prompt after the question track ends (pre-submit).
        if (!awaitingNext && currentTrackUrl === url && targetPc != null) {
          setDefaultPrompt();
        }
      }, { once: true });
    }

    async function playFeedbackSound(correct) {
      const ctx = ensureAudioGraph();
      if (!ctx) return;
  
      await resumeAudioIfNeeded();
  
      const url = feedbackUrl(correct);
      const buf = await loadBuffer(url);
      if (!buf) return;
  
      playBufferAt(buf, ctx.currentTime, 1, "feedback");
    }
  
    // --------------------
    // Keyboard SVG
    // --------------------
    const SVG_NS = "http://www.w3.org/2000/svg";
  
    function el(tag, attrs = {}, children = []) {
      const n = document.createElementNS(SVG_NS, tag);
      for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
      for (const c of children) n.appendChild(c);
      return n;
    }
  
    function hexToRgba(hex, alpha) {
      const m = String(hex).replace("#", "").trim();
      const rgb = (m.length === 3)
        ? [m[0] + m[0], m[1] + m[1], m[2] + m[2]].map(x => parseInt(x, 16))
        : [m.slice(0, 2), m.slice(2, 4), m.slice(4, 6)].map(x => parseInt(x, 16));
      const a = Math.max(0, Math.min(1, Number.isFinite(alpha) ? alpha : 0.28));
      return `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${a})`;
    }
  
    function darken(hex, amt) {
      const m = String(hex).replace("#", "").trim();
      const rgb = (m.length === 3)
        ? [m[0] + m[0], m[1] + m[1], m[2] + m[2]].map(x => parseInt(x, 16))
        : [m.slice(0, 2), m.slice(2, 4), m.slice(4, 6)].map(x => parseInt(x, 16));
      const to = (c) => Math.max(0, Math.min(255, Math.round(c)));
      const out = rgb.map(c => to(c * (1 - amt)));
      return `rgb(${out[0]},${out[1]},${out[2]})`;
    }
  
    function outerRoundedWhitePath(x, y, w, h, r, roundLeft) {
      const rr = Math.max(0, Math.min(r, Math.min(w / 2, h / 2)));
      if (roundLeft) {
        return [
          `M ${x + rr} ${y}`,
          `H ${x + w}`,
          `V ${y + h}`,
          `H ${x + rr}`,
          `A ${rr} ${rr} 0 0 1 ${x} ${y + h - rr}`,
          `V ${y + rr}`,
          `A ${rr} ${rr} 0 0 1 ${x + rr} ${y}`,
          `Z`
        ].join(" ");
      }
      return [
        `M ${x} ${y}`,
        `H ${x + w - rr}`,
        `A ${rr} ${rr} 0 0 1 ${x + w} ${y + rr}`,
        `V ${y + h - rr}`,
        `A ${rr} ${rr} 0 0 1 ${x + w - rr} ${y + h}`,
        `H ${x}`,
        `V ${y}`,
        `Z`
      ].join(" ");
    }
  
    const WHITE_NOTES = ["C", "D", "E", "F", "G", "A", "B"];
    const WHITE_PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
    const BLACK_BY_WHITE_INDEX = {
      0: ["C#", "Db", 1],
      1: ["D#", "Eb", 3],
      3: ["F#", "Gb", 6],
      4: ["G#", "Ab", 8],
      5: ["A#", "Bb", 10],
    };
  
    function pitchFromPcOct(pc, oct) { return (oct * 12) + pc; }
    function pcFromPitch(pitch) { return ((pitch % 12) + 12) % 12; }
    function octFromPitch(pitch) { return Math.floor(pitch / 12); }
  
    function makeWhiteKey(x, y, w, h, label, pc, pitch, roundLeft, roundRight, octaveNum) {
      const shape = (roundLeft || roundRight)
        ? el("path", { d: outerRoundedWhitePath(x, y, w, h, WHITE_CORNER_R, roundLeft) })
        : el("rect", { x, y, width: w, height: h });
  
      const noteTextY = y + h - 16;
      const text = el("text", { x: x + w / 2, y: noteTextY, "text-anchor": "middle" });
      text.textContent = label;
  
      return el("g", {
        class: "key white",
        "data-pc": pc,
        "data-abs": pitch,
        "data-oct": octaveNum,
      }, [shape, text]);
    }
  
    function makeBlackKey(x, y, w, h, sharpName, flatName, pc, pitch, octaveNum) {
      const rect = el("rect", { x, y, width: w, height: h, rx: 4, ry: 4 });
  
      const text = el("text", { x: x + w / 2, y: y + Math.round(h * 0.46), "text-anchor": "middle" });
      const t1 = el("tspan", { x: x + w / 2, dy: "-6" }); t1.textContent = sharpName;
      const t2 = el("tspan", { x: x + w / 2, dy: "14" }); t2.textContent = flatName;
      text.appendChild(t1);
      text.appendChild(t2);
  
      return el("g", {
        class: "key black",
        "data-pc": pc,
        "data-abs": pitch,
        "data-oct": octaveNum,
      }, [rect, text]);
    }
  
    function buildKeyboardSvg(preset, highlightColor) {
      const { startOctave, octaves, endOnFinalC } = preset;
  
      const totalWhite = octaves * 7 + (endOnFinalC ? 1 : 0);
      const innerW = totalWhite * WHITE_W;
      const outerW = innerW + (BORDER_PX * 2);
  
      const s = el("svg", {
        width: outerW,
        height: OUTER_H,
        viewBox: `0 0 ${outerW} ${OUTER_H}`,
        role: "img",
        "aria-label": "Keyboard",
        preserveAspectRatio: "xMidYMid meet",
      });
  
      s.style.width = "100%";
      s.style.maxWidth = `${outerW}px`;
      s.style.height = "auto";
  
      const style = el("style");
      style.textContent = `
        :root { --hlL:${highlightColor}; --hlTextL:#ffffff; --correct:${CORRECT_COLOR}; --wrong:${WRONG_COLOR}; }
  
        @keyframes keyPulse {
          0%   { filter: drop-shadow(0 0 0 rgba(0,0,0,0)); }
          45%  { filter: drop-shadow(0 0 9px rgba(0,0,0,0.0)) drop-shadow(0 0 10px rgba(77,163,255,0.45)); }
          100% { filter: drop-shadow(0 0 0 rgba(0,0,0,0)); }
        }
  
        .white rect, .white path { fill:#fff; stroke:#222; stroke-width:1; }
        .white text { font-family: Arial, Helvetica, sans-serif; font-size:14px; fill:#9a9a9a; pointer-events:none; user-select:none; }
  
        .black rect { fill: url(#blackGrad); stroke:#111; stroke-width:1; }
        .black text { font-family: Arial, Helvetica, sans-serif; font-size:12px; fill:#fff; pointer-events:none; user-select:none; opacity:0; }
  
        .key { cursor:pointer; }
  
        .white.selected.handL rect, .white.selected.handL path { fill: var(--hlL); animation:keyPulse 1.05s ease-in-out infinite; }
        .white.selected.handL text { fill: var(--hlTextL); font-weight:700; }
        .black.selected.handL rect { fill: url(#hlBlackGradL); animation:keyPulse 1.05s ease-in-out infinite; }
        .black.selected.handL text { opacity:1; }
  
        .white.correct rect, .white.correct path { fill: var(--correct); }
        .white.correct text { fill: rgba(255,255,255,0.95); font-weight:800; }
        .black.correct rect { fill: url(#hlBlackCorrect); }
        .black.correct text { opacity:1; }
  
        .white.wrong rect, .white.wrong path { fill: var(--wrong); }
        .white.wrong text { fill: rgba(255,255,255,0.95); font-weight:800; }
        .black.wrong rect { fill: url(#hlBlackWrong); }
        .black.wrong text { opacity:1; }
      `;
      s.appendChild(style);
  
      const defs = el("defs");
  
      const blackGrad = el("linearGradient", { id: "blackGrad", x1: "0", y1: "0", x2: "0", y2: "1" }, [
        el("stop", { offset: "0%", "stop-color": "#3a3a3a" }),
        el("stop", { offset: "100%", "stop-color": "#000000" }),
      ]);
  
      const hlBlackGradL = el("linearGradient", { id: "hlBlackGradL", x1: "0", y1: "0", x2: "0", y2: "1" }, [
        el("stop", { offset: "0%", "stop-color": highlightColor }),
        el("stop", { offset: "100%", "stop-color": darken(highlightColor, 0.45) }),
      ]);
  
      const hlBlackCorrect = el("linearGradient", { id: "hlBlackCorrect", x1: "0", y1: "0", x2: "0", y2: "1" }, [
        el("stop", { offset: "0%", "stop-color": CORRECT_COLOR }),
        el("stop", { offset: "100%", "stop-color": darken(CORRECT_COLOR, 0.35) }),
      ]);
  
      const hlBlackWrong = el("linearGradient", { id: "hlBlackWrong", x1: "0", y1: "0", x2: "0", y2: "1" }, [
        el("stop", { offset: "0%", "stop-color": WRONG_COLOR }),
        el("stop", { offset: "100%", "stop-color": darken(WRONG_COLOR, 0.35) }),
      ]);
  
      defs.appendChild(blackGrad);
      defs.appendChild(hlBlackGradL);
      defs.appendChild(hlBlackCorrect);
      defs.appendChild(hlBlackWrong);
      s.appendChild(defs);
  
      s.appendChild(el("rect", {
        x: BORDER_PX / 2,
        y: BORDER_PX / 2,
        width: outerW - BORDER_PX,
        height: OUTER_H - BORDER_PX,
        rx: RADIUS,
        ry: RADIUS,
        fill: "#ffffff",
        stroke: "#000000",
        "stroke-width": BORDER_PX,
      }));
  
      const gWhite = el("g", { id: "whiteKeys" });
      const gBlack = el("g", { id: "blackKeys" });
      s.appendChild(gWhite);
      s.appendChild(gBlack);
  
      const startX = BORDER_PX;
      const startY = BORDER_PX;
  
      for (let i = 0; i < (preset.octaves * 7 + (preset.endOnFinalC ? 1 : 0)); i++) {
        const x = startX + (i * WHITE_W);
        const noteName = WHITE_NOTES[i % 7];
        const pc = WHITE_PC[noteName];
        const octIndex = Math.floor(i / 7);
        const octaveNum = startOctave + octIndex;
        const pitch = pitchFromPcOct(pc, octaveNum);
  
        const label = (noteName === "C" && octaveNum === 4) ? "C4" : noteName;
        const isFirst = (i === 0);
        const isLast = (i === (preset.octaves * 7 + (preset.endOnFinalC ? 1 : 0)) - 1);
  
        gWhite.appendChild(makeWhiteKey(x, startY, WHITE_W, WHITE_H, label, pc, pitch, isFirst, isLast, octaveNum));
      }
  
      for (let oct = 0; oct < octaves; oct++) {
        const baseWhite = oct * 7;
        const octaveNum = startOctave + oct;
  
        for (const [whiteI, info] of Object.entries(BLACK_BY_WHITE_INDEX)) {
          const wi = Number(whiteI);
          const [sharpName, flatName, pc] = info;
  
          const leftWhiteX = startX + ((baseWhite + wi) * WHITE_W);
          const x = leftWhiteX + WHITE_W - (BLACK_W / 2);
  
          const pitch = pitchFromPcOct(pc, octaveNum);
          gBlack.appendChild(makeBlackKey(x, startY, BLACK_W, BLACK_H, sharpName, flatName, pc, pitch, octaveNum));
        }
      }
  
      return s;
    }
  
    function buildKeyboardController(mountEl, { onKeyClick }) {
      const pitchToKey = new Map();
      let svg = null;
  
      function clearHighlights() {
        if (!svg) return;
        svg.querySelectorAll(".key").forEach(k => k.classList.remove("selected", "handL", "correct", "wrong"));
      }
  
      function setSelected(pitch, on) {
        const k = pitchToKey.get(pitch);
        if (!k) return;
        k.classList.toggle("selected", on);
        k.classList.toggle("handL", on);
      }
  
      function setMultiSelectedByPc(pcSet) {
        if (!svg) return;
        clearHighlights();
        const pcs = new Set([...pcSet].map(normalizePc));
        for (const node of pitchToKey.values()) {
          const pc = Number(node.getAttribute("data-pc"));
          if (pcs.has(normalizePc(pc))) node.classList.add("selected", "handL");
        }
      }
  
      function clearOutcomeMarks() {
        if (!svg) return;
        svg.querySelectorAll(".key").forEach(k => k.classList.remove("correct", "wrong"));
      }
  
      function markPitch(pitch, cls) {
        const k = pitchToKey.get(pitch);
        if (!k) return;
        k.classList.add(cls);
        k.classList.remove(cls === "correct" ? "wrong" : "correct");
      }
  
      function markPc(pc, cls) {
        const want = normalizePc(pc);
        for (const node of pitchToKey.values()) {
          const nodePc = Number(node.getAttribute("data-pc"));
          if (normalizePc(nodePc) === want) {
            node.classList.add(cls);
            node.classList.remove(cls === "correct" ? "wrong" : "correct");
            return;
          }
        }
      }
  
      function render(preset, highlightColor = PRESELECT_COLOR_DEFAULT) {
        mountEl.innerHTML = "";
        pitchToKey.clear();
  
        svg = buildKeyboardSvg(preset, highlightColor);
        mountEl.appendChild(svg);
  
        const keys = [...svg.querySelectorAll(".key")];
        for (const g of keys) {
          const pc = Number(g.getAttribute("data-pc"));
          const oct = Number(g.getAttribute("data-oct"));
          const pitch = pitchFromPcOct(pc, oct);
          pitchToKey.set(pitch, g);
        }
  
        keys.forEach(g => {
          g.addEventListener("click", (e) => {
            e.preventDefault();
            onKeyClick?.(g);
          });
        });
      }
  
      function pitchFromEl(keyEl) {
        const p = Number(keyEl.getAttribute("data-abs"));
        return Number.isFinite(p) ? p : null;
      }
  
      function pcFromEl(keyEl) {
        const pc = Number(keyEl.getAttribute("data-pc"));
        return Number.isFinite(pc) ? normalizePc(pc) : null;
      }
  
      return {
        render,
        clearHighlights,
        setSelected,
        setMultiSelectedByPc,
        clearOutcomeMarks,
        markPitch,
        markPc,
        pitchFromEl,
        pcFromEl,
      };
    }
  
    // --------------------
    // Game state
    // --------------------
    let started = false;
    let awaitingNext = false;
  
    let targetPc = null;
    let currentTrackUrl = null;
  
    let pickedPitch = null;
    let pickedPc = null;
  
    const score = { asked: 0, correct: 0, streak: 0, longest: 0 };
  
    let allowedRoots = new Set(loadAllowedRootsFromStorage());
  
    const mainKeyboard = buildKeyboardController(mount, { onKeyClick: handleMainKeyClick });
    const modalKeyboard = buildKeyboardController(modalMount, { onKeyClick: handleModalKeyClick });
  
    let modalMode = "start"; // "start" | "settings" | "info"
    let modalTempAllowed = new Set(allowedRoots);
  
    function setResult(html) { feedbackOut.innerHTML = html || ""; }
    function setHint(html) { if (actionHint) actionHint.innerHTML = html || ""; }
  
    function submitLabelForPc(pc) {
      if (pc == null) return "Submit";
      return `Submit ${pcName(pc)} Major`;
    }
  
    function updateControls() {
      playBtn.disabled = !started || !currentTrackUrl || isTrackPlaying;
      playBtn.classList.toggle("pulse", started && !awaitingNext && !isTrackPlaying);
  
      // (2) Stop Audio only when track is playing
      stopBtn.disabled = !started || !isTrackPlaying;
  
      const canSubmit = started && !awaitingNext && pickedPc != null && targetPc != null;
      submitBtn.disabled = !canSubmit;
      submitBtn.classList.toggle("submitReady", canSubmit);
  
      nextBtn.disabled = !started || !awaitingNext;
      nextBtn.classList.toggle("nextReady", started && awaitingNext && !nextBtn.disabled);
    }
  
    function renderScore() {
      const asked = score.asked;
      const correct = score.correct;
      const percent = asked > 0 ? Math.round((correct / asked) * 1000) / 10 : 0;
  
      const metricItems = [
        ["Questions asked", asked],
        ["Answers correct", correct],
        ["Correct in a row", score.streak],
        ["Longest correct streak", Math.max(score.longest, score.streak)],
        ["Percentage correct", `${percent}%`],
      ];
  
      const keysIncluded = formatAllowedRoots(allowedRoots);
  
      scoreOut.innerHTML =
        `<div class="scoreGrid">` +
        metricItems.map(([k, v]) =>
          `<div class="scoreItem"><span class="scoreK">${k}</span><span class="scoreV">${v}</span></div>`
        ).join("") +
        `<div class="scoreItem scoreItemFull">` +
        `<span class="scoreK">Keys Included</span>` +
        `<span class="scoreV">${keysIncluded}</span>` +
        `</div>` +
        `</div>`;
    }
  
    function clearMainSelection() {
      if (pickedPitch != null) mainKeyboard.setSelected(pickedPitch, false);
      pickedPitch = null;
      pickedPc = null;
      submitBtn.textContent = submitLabelForPc(null);
    }
  
    function loadAllowedRootsFromStorage() {
      try {
        const raw = localStorage.getItem(STORAGE_ALLOWED);
        if (!raw) return [...Array(12).keys()];
        const arr = JSON.parse(raw);
        if (!Array.isArray(arr)) return [...Array(12).keys()];
        const pcs = arr.map(normalizePc).filter((x) => Number.isFinite(x));
        return pcs.length ? pcs : [...Array(12).keys()];
      } catch {
        return [...Array(12).keys()];
      }
    }
  
    function saveAllowedRootsToStorage(set) {
      try {
        localStorage.setItem(STORAGE_ALLOWED, JSON.stringify(allowedRootsToArray(set)));
      } catch {}
    }
  
    async function pickNewRound() {
      const pcs = allowedRootsToArray(allowedRoots);
      if (!pcs.length) return { pc: null, url: null };
  
      for (let tries = 0; tries < 10; tries++) {
        const pc = randomChoice(pcs);
        const take = randomInt(1, 3);
        const url = trackUrlForKeyPc(pc, take);
  
        const buf = await loadBuffer(url);
        if (buf) return { pc, url };
      }
  
      const pc = randomChoice(pcs);
      const url = trackUrlForKeyPc(pc, randomInt(1, 3));
      return { pc, url };
    }
  
    async function startNewRound({ autoPlay = false } = {}) {
      stopVoices(["feedback"], 0.05);
  
      awaitingNext = false;
      clearMainSelection();
      mainKeyboard.clearHighlights();
      mainKeyboard.clearOutcomeMarks();
  
      const { pc, url } = await pickNewRound();
      targetPc = pc;
      currentTrackUrl = url;
  
      renderScore();
      submitBtn.textContent = submitLabelForPc(null);
  
      if (!currentTrackUrl || targetPc == null) {
        setResult("No keys selected. Open <strong>Game Settings</strong> and choose at least one Major key.");
        setHint("");
      } else {
        setDefaultPrompt();
      }
  
      setTrackPlaying(false);
      updateControls();
  
      if (currentTrackUrl) loadBuffer(currentTrackUrl);
  
      if (autoPlay && currentTrackUrl) await playTrackWithUi(currentTrackUrl);
    }
  
    async function handleMainKeyClick(keyEl) {
      if (!started) return;
  
      const pitch = mainKeyboard.pitchFromEl(keyEl);
      const pc = mainKeyboard.pcFromEl(keyEl);
      if (pitch == null || pc == null) return;
  
      // keep outcome marks after answering; don't allow changing selection while awaiting next
      if (awaitingNext) {
        await playNotePitch(pitch, 0.95);
        return;
      }
  
      mainKeyboard.clearOutcomeMarks();
  
      if (pickedPitch === pitch) {
        clearMainSelection();
        updateControls();
        return;
      }
  
      if (pickedPitch != null) mainKeyboard.setSelected(pickedPitch, false);
  
      pickedPitch = pitch;
      pickedPc = pc;
  
      mainKeyboard.setSelected(pitch, true);
      submitBtn.textContent = submitLabelForPc(pc);
  
      updateControls();
      await playNotePitch(pitch, 0.95);
    }
  
    function showModal({ title, bodyHtml, withKeyboard = false, actions = [] }) {
      modalTitle.textContent = title;
      modalBody.innerHTML = bodyHtml || "";
  
      modalKeyboardSection.classList.toggle("hidden", !withKeyboard);
  
      modalActions.innerHTML = "";
      for (const a of actions) {
        const b = document.createElement("button");
        b.type = "button";
        b.textContent = a.label;
        if (a.primary) b.classList.add("primary");
        b.disabled = !!a.disabled;
        b.addEventListener("click", a.onClick);
        modalActions.appendChild(b);
      }
  
      modal.classList.remove("hidden");
    }
  
    async function hideModal({ playBack = true } = {}) {
      modal.classList.add("hidden");
      if (playBack && modalMode !== "start") await playUiSound(UI_BACK);
    }
  
    async function openStartModal() {
      modalMode = "start";
      modalTempAllowed = new Set(allowedRoots);
  
      modalKeyboard.render(KEYBOARD_PRESET_1OCT_C4, PRESELECT_COLOR_DEFAULT);
      modalKeyboard.setMultiSelectedByPc(modalTempAllowed);
      updateModalSelectionText();
  
      const startDisabled = modalTempAllowed.size === 0;
  
      showModal({
        title: "Find The Key! (Major)",
        bodyHtml:
          `Press <strong>Play Track</strong> and identify the <strong>Major key</strong>.<br>` +
          `Use the keyboard to audition notes, then submit the <strong>root note</strong> as “X Major”.<br><br>` +
          `<strong>Select which Major keys to include:</strong>`,
        withKeyboard: true,
        actions: [
          {
            label: "Start Game",
            primary: true,
            disabled: startDisabled,
            onClick: async () => {
              allowedRoots = new Set(modalTempAllowed);
              saveAllowedRootsToStorage(allowedRoots);
              await hideModal({ playBack: false }); // (5) no back sound on Begin
              await beginGame();
            }
          },
          {
            label: "Info",
            onClick: async () => {
              await playUiSound(UI_SELECT);
              await openInfoModal({ backToStart: true });
            }
          }
        ]
      });
    }
  
    async function openSettingsModal() {
      await playUiSound(UI_SELECT);
      modalMode = "settings";
      modalTempAllowed = new Set(allowedRoots);
  
      modalKeyboard.render(KEYBOARD_PRESET_1OCT_C4, PRESELECT_COLOR_DEFAULT);
      modalKeyboard.setMultiSelectedByPc(modalTempAllowed);
      updateModalSelectionText();
  
      showModal({
        title: "Game Settings",
        bodyHtml: "Tap keys to toggle which <strong>Major</strong> scales can appear.",
        withKeyboard: true,
        actions: [
          {
            label: "Apply Any Changes & Reset",
            primary: true,
            disabled: modalTempAllowed.size === 0,
            onClick: async () => {
              const changed = !setsEqual(modalTempAllowed, allowedRoots);

              allowedRoots = new Set(modalTempAllowed);
              saveAllowedRootsToStorage(allowedRoots);
              stopVoices(null, 0.08); // stop track/ui/note/feedback immediately (same as Reset)
              await hideModal({ playBack: true });

              // Changing settings restarts the game (resets score + starts a fresh round).
              if (changed && started) {
                score.asked = 0;
                score.correct = 0;
                score.streak = 0;
                score.longest = 0;
                awaitingNext = false;

                renderScore();
                await startNewRound({ autoPlay: false });
                return;
              }

              if (!started) await openStartModal();
            }
          },
          {
            label: "Cancel",
            onClick: async () => {
              await hideModal({ playBack: true });
            }
          }
        ]
      });
    }
  
    async function openInfoModal({ backToStart = false } = {}) {
      modalMode = "info";
      showModal({
        title: "How to play",
        bodyHtml:
          `1) Press <strong>Play Track</strong>.<br>` +
          `2) Use the keyboard to audition notes and decide the <strong>Major key</strong>.<br>` +
          `3) Highlight a root note and press <strong>Submit X Major</strong>.<br>` +
          `4) After feedback, press <strong>Next</strong> for a new track.<br><br>` +
          `You can change which keys are included via <strong>Game Settings</strong>.`,
        withKeyboard: false,
        actions: backToStart
          ? [{
            label: "Back",
            primary: true,
            onClick: async () => {
              await hideModal({ playBack: true }); // (5) back sound when closing
              await openStartModal(); // no select sound here
            }
          }]
          : [{
            label: "Close",
            primary: true,
            onClick: async () => {
              await hideModal({ playBack: true });
            }
          }]
      });
    }
  
    function updateModalSelectionText() {
      if (!modalSelectionText) return;
      modalSelectionText.textContent = `Included keys: ${formatAllowedRoots(modalTempAllowed)}`;
    }
  
    async function handleModalKeyClick(keyEl) {
      if (!(modalMode === "start" || modalMode === "settings")) return;
  
      const pc = modalKeyboard.pcFromEl(keyEl);
      const pitch = modalKeyboard.pitchFromEl(keyEl);
      if (pc == null) return;
  
      if (modalTempAllowed.has(pc)) modalTempAllowed.delete(pc);
      else modalTempAllowed.add(pc);
  
      modalKeyboard.setMultiSelectedByPc(modalTempAllowed);
      updateModalSelectionText();
  
      const buttons = [...modalActions.querySelectorAll("button")];
      const primary = buttons.find(b => b.classList.contains("primary"));
      if (primary) primary.disabled = modalTempAllowed.size === 0;
  
      if (pitch != null) await playNotePitch(pitch, 0.8);
    }
  
    async function beginGame() {
      await resumeAudioIfNeeded();
  
      started = true;
  
      score.asked = 0;
      score.correct = 0;
      score.streak = 0;
      score.longest = 0;
  
      renderScore();
  
      await startNewRound({ autoPlay: false });
      updateControls();
    }
  
    async function resetToInitial() {
      stopVoices(null, 0.08);
  
      started = false;
      awaitingNext = false;
  
      targetPc = null;
      currentTrackUrl = null;
  
      clearMainSelection();
      mainKeyboard.clearHighlights();
      mainKeyboard.clearOutcomeMarks();
  
      score.asked = 0;
      score.correct = 0;
      score.streak = 0;
      score.longest = 0;
  
      renderScore();
      setResult("Press <strong>Start Game</strong> to begin.");
      setHint("");
  
      setTrackPlaying(false);
      updateControls();
      await openStartModal();
    }
  
    async function submitAnswer() {
      if (!started || awaitingNext) return;
      if (targetPc == null || pickedPc == null || pickedPitch == null) return;
  
      score.asked += 1;
  
      const correct = normalizePc(pickedPc) === normalizePc(targetPc);
      if (correct) {
        score.correct += 1;
        score.streak += 1;
      } else {
        score.longest = Math.max(score.longest, score.streak);
        score.streak = 0;
      }
  
      renderScore();
  
      awaitingNext = true;
      updateControls();
  
      stopVoices(null, 0.08);
  
      // (4) color keys
      mainKeyboard.clearOutcomeMarks();
      if (correct) {
        mainKeyboard.markPitch(pickedPitch, "correct");
      } else {
        mainKeyboard.markPitch(pickedPitch, "wrong");
        mainKeyboard.markPc(targetPc, "correct");
      }
  
      // (3) feedback sound correct1/incorrect1
      await playFeedbackSound(correct);
  
      if (correct) {
        setResult(`Correct! ✅ The track was in <strong>${keyName(targetPc)}</strong>.`);
        setHint("Press <strong>Next</strong> for a new track (or Space).");
      } else {
        setResult(`Incorrect ❌ The track was in <strong>${keyName(targetPc)}</strong>.`);
        setHint("You can replay the track and audition notes. Press <strong>Next</strong> when ready.");
      }
    }
  
    async function goNext() {
      if (!started || !awaitingNext) return;
      setResult("");
      setHint("");
      awaitingNext = false;
      updateControls();
      await startNewRound({ autoPlay: true });
    }
  
    // --------------------
    // Scorecard PNG download (unchanged)
    // --------------------
    function downloadBlob(blob, filename) {
      const a = document.createElement("a");
      const url = URL.createObjectURL(blob);
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 3000);
    }
  
    function canvasToPngBlob(canvas) {
      return new Promise((resolve) => canvas.toBlob((b) => resolve(b), "image/png"));
    }
  
    function drawCardBase(ctx, w, h) {
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = "#fbfbfc";
      ctx.fillRect(0, 0, w, h);
  
      ctx.strokeStyle = "rgba(0,0,0,0.12)";
      ctx.lineWidth = 6;
      ctx.strokeRect(8, 8, w - 16, h - 16);
  
      ctx.fillStyle = "#111";
      ctx.fillRect(8, 8, w - 16, 74);
    }
  
    function getPlayerName() {
      const prev = localStorage.getItem("ftk_player_name") || "";
      const name = window.prompt("Enter your name for the score card:", prev) ?? "";
      const trimmed = String(name).trim();
      if (trimmed) localStorage.setItem("ftk_player_name", trimmed);
      return trimmed || "Player";
    }
  
    async function downloadScoreCardPng(playerName) {
      const asked = score.asked;
      const correct = score.correct;
      const percent = asked > 0 ? Math.round((correct / asked) * 1000) / 10 : 0;
  
      const keys = allowedRootsToArray(allowedRoots).map(pcName);

      const keysPerRow = 5;
      const keyRows = [];
      for (let i = 0; i < keys.length; i += keysPerRow) {
        keyRows.push(keys.slice(i, i + keysPerRow).join(", "));
      }
      if (!keyRows.length) keyRows.push("None");

      const w = 620;

      // Grow height if we have many wrapped key rows to avoid clipping the footer.
      const baseLines = 6; // Name + 5 metrics (no keys)
      const totalLines = baseLines + 1 + keyRows.length; // + "Keys Included:" label + rows
      const minH = 520;
      const h = Math.max(minH, 220 + (totalLines * 30) + 80);

      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;

      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      drawCardBase(ctx, w, h);

      ctx.fillStyle = "#fff";
      ctx.font = "900 30px Arial";
      ctx.fillText("Find The Key! — Scorecard", 28, 56);

      const bodyX = 28;
      const bodyY = 130;

      ctx.fillStyle = "#111";
      ctx.font = "900 22px Arial";
      ctx.fillText("Summary", bodyX, bodyY);

      ctx.font = "700 18px Arial";
      const lines = [
        `Name: ${playerName}`,
        `Questions asked: ${asked}`,
        `Answers correct: ${correct}`,
        `Correct in a row: ${score.streak}`,
        `Longest correct streak: ${Math.max(score.longest, score.streak)}`,
        `Percentage correct: ${percent}%`,
        "Keys Included:",
        ...keyRows.map(r => `  ${r}`),
      ];

      let y = bodyY + 40;
      for (const ln of lines) {
        ctx.fillText(ln, bodyX, y);
        y += 30;
      }
      ctx.fillStyle = "rgba(0,0,0,0.65)";
      ctx.font = "700 16px Arial";
      ctx.fillText("Downloaded from www.eartraininglab.com 🎶", bodyX, h - 36);
  
      const blob = await canvasToPngBlob(canvas);
      if (blob) downloadBlob(blob, "Find The Key Scorecard.png");
    }
  
    async function onDownloadScoreCard() {
      const name = getPlayerName();
      await downloadScoreCardPng(name);
    }
  
    // --------------------
    // Title image swap + embed resizing (unchanged)
    // --------------------
    function initTitleImageSwap() {
      if (!titleImg) return;
  
      const DEFAULT_SRC = "images/title.png";
      const WRAPPED_SRC = "images/titlewrapped.png";
  
      let baseWidth = 0;
  
      const base = new Image();
      base.decoding = "async";
      base.onload = () => {
        baseWidth = base.naturalWidth || 0;
        update();
      };
      base.src = DEFAULT_SRC;
  
      function update() {
        if (!baseWidth) return;
        const useWrapped = window.innerWidth < baseWidth;
        const desired = useWrapped ? WRAPPED_SRC : DEFAULT_SRC;
        if (titleImg.getAttribute("src") !== desired) titleImg.setAttribute("src", desired);
      }
  
      window.addEventListener("resize", () => window.requestAnimationFrame(update));
      update();
    }
  
    let lastHeight = 0;
    const ro = new ResizeObserver(entries => {
      for (const entry of entries) {
        const height = Math.ceil(entry.contentRect.height);
        if (height !== lastHeight) {
          parent.postMessage({ iframeHeight: height }, "*");
          lastHeight = height;
        }
      }
    });
    ro.observe(document.documentElement);
  
    function postHeightNow() {
      try {
        const h = Math.max(
          document.documentElement.scrollHeight,
          document.body ? document.body.scrollHeight : 0
        );
        parent.postMessage({ iframeHeight: h }, "*");
      } catch {}
    }
  
    window.addEventListener("load", () => {
      postHeightNow();
      setTimeout(postHeightNow, 250);
      setTimeout(postHeightNow, 1000);
    });
  
    window.addEventListener("orientationchange", () => {
      setTimeout(postHeightNow, 100);
      setTimeout(postHeightNow, 500);
    });
  
    function enableScrollForwardingToParent() {
      const SCROLL_GAIN = 6.0;
  
      const isVerticallyScrollable = () =>
        document.documentElement.scrollHeight > window.innerHeight + 2;
  
      const isInteractiveTarget = (t) =>
        t instanceof Element && !!t.closest("button, a, input, select, textarea, label");
  
      const isInPianoStrip = (t) =>
        t instanceof Element && !!t.closest("#mount, .mount, svg, .key");
  
      let startX = 0;
      let startY = 0;
      let lastY = 0;
      let lockedMode = null;
  
      let lastMoveTs = 0;
      let vScrollTop = 0;
  
      window.addEventListener("touchstart", (e) => {
        if (!e.touches || e.touches.length !== 1) return;
        const t = e.target;
  
        lockedMode = null;
        startX = e.touches[0].clientX;
        startY = e.touches[0].clientY;
        lastY = startY;
  
        lastMoveTs = e.timeStamp || performance.now();
        vScrollTop = 0;
  
        if (isInteractiveTarget(t) || isInPianoStrip(t)) lockedMode = "x";
      }, { passive: true });
  
      window.addEventListener("touchmove", (e) => {
        if (!e.touches || e.touches.length !== 1) return;
        if (isVerticallyScrollable()) return;
  
        const x = e.touches[0].clientX;
        const y = e.touches[0].clientY;
  
        const dx = x - startX;
        const dy = y - startY;
  
        if (!lockedMode) {
          if (Math.abs(dy) > Math.abs(dx) + 4) lockedMode = "y";
          else if (Math.abs(dx) > Math.abs(dy) + 4) lockedMode = "x";
          else return;
        }
        if (lockedMode !== "y") return;
  
        const nowTs = e.timeStamp || performance.now();
        const dt = Math.max(8, nowTs - lastMoveTs);
        lastMoveTs = nowTs;
  
        const fingerStep = (y - lastY) * SCROLL_GAIN;
        lastY = y;
  
        const scrollTopDelta = -fingerStep;
  
        const instV = scrollTopDelta / dt;
        vScrollTop = vScrollTop * 0.75 + instV * 0.25;
  
        e.preventDefault();
        parent.postMessage({ scrollTopDelta }, "*");
      }, { passive: false });
  
      function endGesture() {
        if (lockedMode === "y" && Math.abs(vScrollTop) > 0.05) {
          const capped = Math.max(-5.5, Math.min(5.5, vScrollTop));
          parent.postMessage({ scrollTopVelocity: capped }, "*");
        }
        lockedMode = null;
        vScrollTop = 0;
      }
  
      window.addEventListener("touchend", endGesture, { passive: true });
      window.addEventListener("touchcancel", endGesture, { passive: true });
  
      window.addEventListener("wheel", (e) => {
        if (isVerticallyScrollable()) return;
        parent.postMessage({ scrollTopDelta: e.deltaY }, "*");
      }, { passive: true });
    }
  
    // --------------------
    // Events
    // --------------------
    function bind() {
      playBtn.addEventListener("click", async () => {
        if (!started || !currentTrackUrl) return;
        await playTrackWithUi(currentTrackUrl);
      });
  
      // (2) Stop Audio button stops only the track
      stopBtn.addEventListener("click", () => {
        stopVoices(["track"], 0.08);
        if (!awaitingNext && started && currentTrackUrl && targetPc != null) setDefaultPrompt();
      });
  
      submitBtn.addEventListener("click", submitAnswer);
      nextBtn.addEventListener("click", goNext);
  
      settingsBtn.addEventListener("click", () => openSettingsModal());
      infoBtn.addEventListener("click", async () => {
        await playUiSound(UI_SELECT);
        await openInfoModal();
      });
      resetBtn.addEventListener("click", () => resetToInitial());
  
      downloadScoreBtn.addEventListener("click", onDownloadScoreCard);
  
      // Do not click-off start modal
      modal.addEventListener("click", async (e) => {
        if (e.target !== modal) return;
        if (modalMode === "start") return;
        await hideModal({ playBack: true });
      });
  
      document.addEventListener("keydown", async (e) => {
        if (modal && !modal.classList.contains("hidden")) {
          if (e.code === "Escape" && modalMode !== "start") await hideModal({ playBack: true });
          return;
        }
  
        if (!started) return;
  
        if (e.code === "Space") {
          e.preventDefault();
          if (awaitingNext) await goNext();
          else await submitAnswer();
        }
  
        if (e.code === "Enter") {
          e.preventDefault();
          if (awaitingNext) await goNext();
          else await submitAnswer();
        }
      });
    }
  
    function init() {
      enableScrollForwardingToParent();
  
      document.documentElement.style.setProperty("--pulseColor", PRESELECT_COLOR_DEFAULT);
      document.documentElement.style.setProperty("--pulseRGBA", hexToRgba(PRESELECT_COLOR_DEFAULT, 0.28));
  
      initTitleImageSwap();
  
      mainKeyboard.render(KEYBOARD_PRESET_1OCT_C4, PRESELECT_COLOR_DEFAULT);
  
      renderScore();
      setTrackPlaying(false);
      updateControls();
  
      if (instructions) instructions.classList.add("hidden");
      setResult("Press <strong>Start Game</strong> to begin.");
      setHint("");
  
      openStartModal();
    }
  
    bind();
    init();
  })();