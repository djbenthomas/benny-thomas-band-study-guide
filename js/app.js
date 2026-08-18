/* app.js — Benny Thomas Band Study Guide */
(function () {
  'use strict';

  /* ================= utilities ================= */
  function $(id) { return document.getElementById(id); }
  function esc(s) { return CHART.esc(s); }
  function fmtTime(sec) {
    if (sec == null || isNaN(sec)) return '—';
    sec = Math.max(0, Math.round(sec));
    var m = Math.floor(sec / 60), s = sec % 60;
    return m + ':' + (s < 10 ? '0' : '') + s;
  }
  function parseTimeStr(str) {
    if (str == null) return null;
    str = String(str).trim();
    if (!str) return null;
    var m = str.match(/^(\d+):(\d{1,2})$/);
    if (m) return (+m[1]) * 60 + (+m[2]);
    var n = parseInt(str, 10);
    return isNaN(n) ? null : n;
  }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function lsDel(k) { try { localStorage.removeItem(k); } catch (e) {} }

  var toastTimer = null;
  function toast(msg) {
    var t = $('toast');
    t.textContent = msg;
    t.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.add('hidden'); }, 2800);
  }

  /* ================= state ================= */
  var state = {
    songs: [], order: [], currentId: null,
    voterName: lsGet('btbs_voter') || '',
    ballots: loadBallots(),
    syncMode: 'idle', lastSync: 0,
    pin: lsGet('btbs_pin'),
    setlist: loadSetlist(),
    profileName: lsGet('btbs_profile') || 'Default',
    profiles: loadProfiles()
  };
  var profile = loadProfile(state.profileName);

  function loadBallots() {
    try {
      var v = JSON.parse(lsGet('btbs_ballots') || '{"v":1,"ballots":{}}');
      if (v && v.ballots) return v.ballots;
    } catch (e) {}
    return {};
  }
  function saveBallotsLocal() { lsSet('btbs_ballots', JSON.stringify({ v: 1, ballots: state.ballots })); }
  function loadSetlist() {
    try {
      var v = JSON.parse(lsGet('btbs_setlist') || 'null');
      if (v && v.ids) return v;
    } catch (e) {}
    return { ids: null, times: {}, included: {} };
  }
  function saveSetlist() { lsSet('btbs_setlist', JSON.stringify(state.setlist)); }
  function loadProfiles() {
    try {
      var v = JSON.parse(lsGet('btbs_profiles') || '["Default"]');
      if (Array.isArray(v) && v.length) return v;
    } catch (e) {}
    return ['Default'];
  }
  function saveProfiles() { lsSet('btbs_profiles', JSON.stringify(state.profiles)); }
  function loadProfile(name) {
    try {
      var p = JSON.parse(lsGet('btbs_pref_' + name) || 'null');
      if (p && typeof p.speed === 'number') return p;
    } catch (e) {}
    return { speed: 30, fontSize: 34, dark: true };
  }
  function saveProfile() { lsSet('btbs_pref_' + state.profileName, JSON.stringify(profile)); }
  function setProfile(name) {
    saveProfile();
    state.profileName = name;
    profile = loadProfile(name);
    lsSet('btbs_profile', name);
    if (state.profiles.indexOf(name) < 0) { state.profiles.push(name); saveProfiles(); }
    applyLivePrefs();
  }

  function songById(id) {
    for (var i = 0; i < state.songs.length; i++) if (state.songs[i].id === id) return state.songs[i];
    return null;
  }
  function currentSong() { return songById(state.currentId) || state.songs[0] || null; }
  function setlistIds() { return state.setlist.ids || state.order.slice(); }
  function saveSetlistIds(ids) { state.setlist.ids = ids.slice(); saveSetlist(); }

  /* ================= data loading ================= */
  function init() {
    fetch('songs/manifest.json')
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (manifest) {
        state.order = manifest.map(function (s) { return s.id; });
        return Promise.all(manifest.map(function (s) {
          return fetch('songs/' + s.id + '.json').then(function (r) { return r.json(); });
        }));
      })
      .then(function (songs) {
        songs.forEach(function (s) {
          var ov = lsGet('btbs_override_' + s.id);
          if (ov) { try { s = Object.assign(s, JSON.parse(ov)); } catch (e) {} }
        });
        state.songs = songs;
        state.currentId = state.order[0] || null;
        renderSongTabs();
        renderStudy();
        renderVote();
        renderSetlist();
        wire();
        checkPin();
      })
      .catch(function (err) {
        $('app').classList.add('hidden');
        var g = $('pin-gate');
        g.classList.remove('hidden');
        g.innerHTML = '<div class="gate-card"><h1>⚠️ Can\'t load songs</h1>' +
          '<p class="hint">The Study Guide must be served over http. Open it via the GitHub Pages link, or locally run <code>./serve.sh</code>.</p>' +
          '<p class="hint">' + esc(err && err.message ? err.message : String(err)) + '</p></div>';
      });
  }

  /* ================= study mode ================= */
  function renderSongTabs() {
    var tabs = $('song-tabs');
    tabs.innerHTML = state.order.map(function (id) {
      var s = songById(id);
      var act = id === state.currentId ? ' active' : '';
      return '<button class="chip' + act + '" data-song="' + esc(id) + '">' + esc(s ? s.title : id) + '</button>';
    }).join('');
  }
  function metaChip(label, value) {
    var v = (value === null || value === undefined || value === '') ? 'TBD' : value;
    var cls = (v === 'TBD') ? ' tbd' : '';
    return '<span class="chip meta-chip' + cls + '"><b>' + esc(v) + '</b><span>' + esc(label) + '</span></span>';
  }
  function bandNotesEmpty(song) {
    var bn = song.bandNotes || {};
    return !CHART.BAND_NOTE_KEYS.some(function (k) { return bn[k]; });
  }
  function missingList(song) {
    var out = [];
    var m = song.meta || {};
    if (!song.mp3) out.push('MP3 audio file');
    if (!song.sections || !song.sections.length) out.push('Lyrics & chord chart');
    else if (!song.sections.some(function (s) { return s.start != null; })) out.push('Section start times (needed for audio-synced scrolling)');
    if (!m.key) out.push('Song key');
    if (!m.bpm) out.push('BPM');
    if (!m.timeSig) out.push('Time signature');
    if (!m.duration) out.push('Duration');
    if (!m.ugUrl) out.push('Ultimate Guitar tab link');
    if (bandNotesEmpty(song)) out.push('Band notes (count-in, drums, bass, guitar, harmonies, stops, dynamics, solos, ending)');
    return out;
  }
  function chordsUsed(song) {
    var seen = {}, out = [];
    (song.sections || []).forEach(function (sec) {
      (sec.lines || []).forEach(function (ln) {
        if (ln && ln.segments) ln.segments.forEach(function (seg) {
          if (seg.chord && !seen[seg.chord]) { seen[seg.chord] = 1; out.push(seg.chord); }
        });
      });
    });
    return out;
  }
  function renderStudy() {
    var song = currentSong();
    var el = $('study-content');
    if (!song) { el.innerHTML = '<div class="empty-box">No songs loaded yet.</div>'; return; }
    var m = song.meta || {};
    var html = '<div class="songhead"><h2>' + esc(song.title) + '</h2>';
    if (song.artist) html += '<div class="artist">' + esc(song.artist) + '</div>';
    html += '<div class="chips wrap">';
    var tuningVal = m.tuning || (m.capo != null ? 'Capo ' + m.capo : 'Standard tuning');
    html += metaChip('Key', m.key) + metaChip('Tuning', tuningVal) +
      metaChip('BPM', m.bpm) + metaChip('Time', m.timeSig) + metaChip('Length', m.duration);
    html += '</div>';
    var links = '';
    if (m.ugUrl) links += '<a class="btn" target="_blank" rel="noopener" href="' + esc(m.ugUrl) + '">🎸 Ultimate Guitar tab</a>';
    if (m.videoUrl) links += '<a class="btn" target="_blank" rel="noopener" href="' + esc(m.videoUrl) + '">▶ Reference video</a>';
    links += '<button class="btn primary" id="btn-go-live">📜 Go Live</button>';
    html += '<div class="linkrow">' + links + '</div></div>';

    var missing = missingList(song);
    if (missing.length) {
      html += '<div class="missing"><h3>⚠️ Still needed for this song</h3><ul>' +
        missing.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul></div>';
    }

    if (song.mp3) html += '<div class="player"><audio controls preload="metadata" src="songs/' + esc(song.mp3) + '"></audio></div>';
    else html += '<div class="player empty">🎵 MP3 not uploaded yet</div>';

    var chords = chordsUsed(song);
    if (chords.length) html += '<div class="chips wrap" style="margin-top:8px"><span class="hint" style="align-self:center">Chords:</span>' +
      chords.map(function (c) { return '<span class="chip chord-chip">' + esc(c) + '</span>'; }).join('') + '</div>';

    html += '<h3 class="block-h">Chart</h3>';
    if (!song.sections || !song.sections.length) html += '<div class="empty-box">No chart uploaded yet — lyrics & chords coming.</div>';
    else html += song.sections.map(function (sec, i) { return CHART.sectionHTML(sec, i); }).join('');

    html += '<h3 class="block-h">Band Notes</h3>';
    if (bandNotesEmpty(song)) html += '<div class="empty-box">Band notes not uploaded yet.</div>';
    else {
      html += '<div class="notes-grid">' + CHART.BAND_NOTE_KEYS.map(function (k) {
        var v = (song.bandNotes || {})[k];
        return '<div class="note-card"><div class="note-label">' + esc(CHART.BAND_NOTE_LABELS[k]) + '</div><div class="note-val">' +
          (v ? esc(v) : '<span class="tbd">— TBD —</span>') + '</div></div>';
      }).join('') + '</div>';
    }
    if (song.notes && song.notes.length) {
      html += '<h3 class="block-h">Notes</h3><div class="notes-list">' +
        song.notes.map(function (n) { return '<div class="note-line">' + esc(n) + '</div>'; }).join('') + '</div>';
    }
    el.innerHTML = html;
  }

  /* ================= voting + sync ================= */
  /* voting is intentionally simple: saved on this phone only */
  function ballotDraft() {
    return state.ballots[state.voterName] || { updatedAt: Date.now(), ratings: {}, choices: {}, comments: {} };
  }
  function saveDraft(d) { d.updatedAt = Date.now(); state.ballots[state.voterName] = d; saveBallotsLocal(); renderResults(); }
  function renderVote() {
    var html = '<h2>🗳️ Song Votes</h2>';
    html += '<div class="vote-name-row"><input id="vote-name" placeholder="Your name (e.g. Jake — drums)" value="' + esc(state.voterName) + '"><button id="vote-save" class="btn primary">Save my ballot</button></div>';
    html += '<div class="sync-status">💾 Votes are saved on this phone.</div>';
    state.order.forEach(function (id) {
      var song = songById(id);
      var b = state.ballots[state.voterName] || {};
      var r = b.ratings || {}, c = b.choices || {}, cm = b.comments || {};
      html += '<div class="vote-song"><div class="vote-title">' + esc(song.title) + '</div>';
      html += '<div class="stars" data-song="' + esc(id) + '">' + [1, 2, 3, 4, 5].map(function (n) {
        return '<button class="star' + ((r[id] || 0) >= n ? ' on' : '') + '" data-v="' + n + '">★</button>';
      }).join('') + '</div>';
      html += '<div class="choice" data-song="' + esc(id) + '">' + ['yes', 'maybe', 'no'].map(function (opt) {
        return '<button class="cbtn' + (c[id] === opt ? ' sel ' + opt : '') + '" data-c="' + opt + '">' + opt + '</button>';
      }).join('') + '</div>';
      html += '<input class="vcomment" data-song="' + esc(id) + '" placeholder="Comment / arrangement idea…" value="' + esc(cm[id] || '') + '">';
      html += '</div>';
    });
    html += '<div class="results-box"><h3>Results (this phone)</h3><div id="results"></div></div>';
    $('screen-vote').innerHTML = html;
    renderResults();
  }
  function renderStars(el, r) {
    var btns = el.querySelectorAll('.star');
    for (var i = 0; i < btns.length; i++) btns[i].classList.toggle('on', i < (r || 0));
  }
  function renderChoice(el, c) {
    var btns = el.querySelectorAll('.cbtn');
    for (var i = 0; i < btns.length; i++) {
      var opt = btns[i].getAttribute('data-c');
      btns[i].classList.toggle('sel', opt === c);
      btns[i].classList.toggle(opt, opt === c);
    }
  }
  function applyBallotToForm() {
    var b = state.ballots[state.voterName] || {};
    document.querySelectorAll('.vote-song').forEach(function (vs) {
      var starsEl = vs.querySelector('.stars'), chEl = vs.querySelector('.choice'), cEl = vs.querySelector('.vcomment');
      if (!starsEl || !chEl || !cEl) return;
      var id = starsEl.getAttribute('data-song');
      renderStars(starsEl, (b.ratings || {})[id] || 0);
      renderChoice(chEl, (b.choices || {})[id]);
      cEl.value = (b.comments || {})[id] || '';
    });
    renderResults();
  }
  function renderResults() {
    var el = $('results');
    if (!el) return;
    var names = Object.keys(state.ballots);
    if (!names.length) { el.innerHTML = '<div class="empty-box">No votes yet.</div>'; return; }
    var html = '';
    state.order.forEach(function (id) {
      var song = songById(id);
      if (!song) return;
      var ratings = [], counts = { yes: 0, maybe: 0, no: 0 }, comments = [];
      names.forEach(function (n) {
        var b = state.ballots[n], r = b.ratings || {}, c = b.choices || {}, cm = b.comments || {};
        if (r[id]) ratings.push(r[id]);
        if (c[id]) counts[c[id]]++;
        if (cm[id] && String(cm[id]).trim()) comments.push({ who: n, text: cm[id] });
      });
      var avg = ratings.length ? (ratings.reduce(function (a, b2) { return a + b2; }, 0) / ratings.length).toFixed(1) : '—';
      html += '<div class="res-card"><div class="res-title">' + esc(song.title) + '<span class="res-avg">' + avg + '/5</span></div>';
      html += '<div class="res-votes">★ ' + avg + ' <b>' + ratings.length + '</b> · Yes <b>' + counts.yes + '</b> · Maybe <b>' + counts.maybe + '</b> · No <b>' + counts.no + '</b></div>';
      comments.forEach(function (cm2) { html += '<div class="res-comment"><span class="who">' + esc(cm2.who) + ':</span> ' + esc(cm2.text) + '</div>'; });
      html += '</div>';
    });
    el.innerHTML = html;
  }
  /* ================= drum notes portal ================= */
  function drumSections(song) {
    if (!song) return null;
    var text = lsGet('btbs_drums_' + song.id);
    if (text == null) text = song.drumNotes || null;
    if (!text || !String(text).trim()) return null;
    var patch = CHART.textToPatch(text);
    return patch.hasSections ? patch.sections : null;
  }
  function renderDrums() {
    var song = currentSong();
    var html = '<h2>🥁 Drum Notes</h2>';
    html += '<p class="hint" style="margin:0 0 8px">Jed — paste your drum chart for <b>' + esc(song ? song.title : '') + '</b>, tap 💾 Save, then 📋 Copy and send it to Benny so the whole band gets it. It shows on this phone right away in Live mode (🥁 toggle).</p>';
    html += '<div class="chips wrap" id="drums-tabs">' + state.order.map(function (id) {
      var s = songById(id);
      var act = id === state.currentId ? ' active' : '';
      return '<button class="chip' + act + '" data-song="' + esc(id) + '">' + esc(s ? s.title : id) + '</button>';
    }).join('') + '</div>';
    var text = song ? (lsGet('btbs_drums_' + song.id) || song.drumNotes || '') : '';
    html += '<textarea id="drums-text" class="drums-text" spellcheck="false" placeholder="Drum notes for ' + esc(song ? song.title : 'this song') + '…';
    html += '&#10;&#10;Format (same as chart editor):&#10;## Intro [0-8]&#10;Kick x-x-x-x  |  Snare on 2 &amp; 4&#10;## Verse 1 [8-32]&#10;Groove: 8th notes on hats, kick pattern below&#10;{comment: fill into chorus}&#10;&#10;Section timings in [seconds] let the drums scroll in sync with the MP3.' + '">' + esc(text) + '</textarea>';
    html += '<div class="modal-btns">';
    html += '<button id="drums-save" class="btn primary">💾 Save on this phone</button>';
    html += '<button id="drums-copy" class="btn">📋 Copy for band</button>';
    html += '<button id="drums-clear" class="btn">Clear local</button>';
    html += '</div>';
    html += '<p id="drums-status" class="hint"></p>';
    html += '<details><summary>Format help</summary><div class="help"><p><b>Sections:</b> <code>## Intro [0-8]</code> — name plus optional start-end seconds for MP3 sync.</p><p><b>Lines:</b> just type your pattern text. Use <code>{comment: ...}</code> for cues like fills or stops.</p><p>Notes saved here are on this device only until Benny adds them to the site for everyone.</p></div></details>';
    $('screen-drums').innerHTML = html;
  }
  function copyDrums() {
    var song = currentSong();
    var text = $('drums-text').value.trim();
    if (!text) { toast('Paste drum notes first'); return; }
    var msg = '🥁 DRUM NOTES — ' + song.title + '\n\n' + text + '\n\n(Send this to Benny to add to the band study guide.)';
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(msg).then(function () { toast('Copied — paste it into the chat with Benny'); })
        .catch(function () { fallbackCopy(msg); });
    } else fallbackCopy(msg);
  }
  function fallbackCopy(msg) {
    var ta = document.createElement('textarea');
    ta.value = msg;
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); toast('Copied — paste it into the chat with Benny'); }
    catch (e) { toast('Copy blocked — long-press to copy'); }
    ta.remove();
  }

  /* ================= setlist builder ================= */
  function renderSetlist() {
    var ids = setlistIds();
    var html = '<h2>📋 Setlist Builder</h2>';
    html += '<div id="setlist-total"></div><div id="setlist-warn"></div><div id="setlist-rows">';
    ids.forEach(function (id, i) {
      var song = songById(id);
      if (!song) return;
      var inc = state.setlist.included[id] !== false;
      var t = state.setlist.times[id] != null ? fmtTime(state.setlist.times[id]) : (song.meta.duration || '');
      html += '<div class="srow' + (inc ? '' : ' excluded') + '" draggable="true" data-id="' + esc(id) + '">';
      html += '<span class="grip">☰</span><span class="snum">' + (i + 1) + '</span>';
      html += '<span class="stitle">' + esc(song.title) + '</span>';
      html += '<input class="stime" data-id="' + esc(id) + '" inputmode="numeric" placeholder="0:00" value="' + esc(t) + '">';
      html += '<button class="sup" data-id="' + esc(id) + '">▲</button><button class="sdown" data-id="' + esc(id) + '">▼</button>';
      html += '<input type="checkbox" class="sinc" data-id="' + esc(id) + '"' + (inc ? ' checked' : '') + '>';
      html += '</div>';
    });
    html += '</div>';
    $('screen-setlist').innerHTML = html;
    updateSetlistTotal();
    wireSetlistDrag();
  }
  function setlistTotals() {
    var ids = setlistIds(), total = 0, unknown = 0, count = 0, longest = { id: null, secs: 0 };
    ids.forEach(function (id) {
      if (state.setlist.included[id] === false) return;
      count++;
      var song = songById(id);
      var secs = state.setlist.times[id] != null ? state.setlist.times[id] : (song ? parseTimeStr(song.meta.duration) : null);
      if (secs != null) { total += secs; if (secs > longest.secs) longest = { id: id, secs: secs }; }
      else unknown++;
    });
    return { total: total, unknown: unknown, count: count, longest: longest };
  }
  function updateSetlistTotal() {
    var el = $('setlist-total'), w = $('setlist-warn');
    if (!el || !w) return;
    var t = setlistTotals();
    el.textContent = 'Total: ' + fmtTime(t.total) + ' · ' + t.count + (t.count === 1 ? ' song' : ' songs') + (t.unknown ? ' · ' + t.unknown + ' missing time' : '');
    var extra = t.unknown ? ' · ' + t.unknown + ' song(s) need a time' : '';
    if (t.longest.id) extra += ' · Longest: ' + songById(t.longest.id).title + ' (' + fmtTime(t.longest.secs) + ') — cut candidate';
    if (t.total > 1500) { w.className = 'err'; w.textContent = '⚠️ OVER 25:00 by ' + fmtTime(t.total - 1500) + ' — cut something!' + extra; }
    else { w.className = 'ok'; w.textContent = '✓ Under 25:00 (' + fmtTime(1500 - t.total) + ' to spare)' + extra; }
  }
  function wireSetlistDrag() {
    var rows = document.querySelectorAll('#setlist-rows .srow');
    var dragId = null;
    rows.forEach(function (row) {
      row.addEventListener('dragstart', function (e) { dragId = row.getAttribute('data-id'); row.classList.add('dragging'); if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'; });
      row.addEventListener('dragend', function () { row.classList.remove('dragging'); });
      row.addEventListener('dragover', function (e) { if (e.preventDefault) e.preventDefault(); });
      row.addEventListener('drop', function (e) {
        if (e.preventDefault) e.preventDefault();
        if (!dragId || dragId === row.getAttribute('data-id')) return;
        var ids = setlistIds();
        var from = ids.indexOf(dragId), to = ids.indexOf(row.getAttribute('data-id'));
        if (from < 0 || to < 0) return;
        ids.splice(from, 1);
        ids.splice(to, 0, dragId);
        saveSetlistIds(ids);
        renderSetlist();
      });
    });
  }
  function moveSetlist(id, dir) {
    var ids = setlistIds();
    var i = ids.indexOf(id), j = i + dir;
    if (i < 0 || j < 0 || j >= ids.length) return;
    ids.splice(i, 1);
    ids.splice(j, 0, id);
    saveSetlistIds(ids);
    renderSetlist();
  }

  /* ================= editor ================= */
  function applyPatch(song, patch) {
    var m = patch.meta || {};
    Object.keys(m).forEach(function (k) { if (k !== 'title' && m[k] !== undefined) song.meta[k] = m[k]; });
    if (m.title !== undefined && m.title) song.title = m.title;
    if (patch.hasSections) { song.sections = patch.sections; song.notes = patch.notes; }
    Object.keys(patch.bandNotes || {}).forEach(function (k) { song.bandNotes[k] = patch.bandNotes[k]; });
  }
  function openEditor() {
    var song = currentSong();
    if (!song) return;
    $('editor-title').textContent = 'Edit — ' + song.title;
    $('editor-text').value = CHART.songToText(song);
    $('editor-modal').classList.remove('hidden');
  }
  function saveEditor() {
    var song = currentSong();
    var patch = CHART.textToPatch($('editor-text').value);
    applyPatch(song, patch);
    lsSet('btbs_override_' + song.id, JSON.stringify(song));
    $('editor-modal').classList.add('hidden');
    renderSongTabs();
    renderStudy();
    toast('Saved on this device');
  }
  function resetEditor() {
    var song = currentSong();
    lsDel('btbs_override_' + song.id);
    fetch('songs/' + song.id + '.json')
      .then(function (r) { return r.json(); })
      .then(function (fresh) {
        var i = state.songs.indexOf(song);
        if (i >= 0) state.songs[i] = fresh;
        $('editor-modal').classList.add('hidden');
        renderSongTabs();
        renderStudy();
        toast('Restored uploaded version');
      })
      .catch(function () { toast('Could not reload'); });
  }

  /* ================= live scroll mode ================= */
  var live = {
    open: false, songId: null, paused: true, counting: false, countdownN: 0, cdTimer: null,
    autoMode: 'manual', manualUntil: 0, raf: null, lastT: 0, programmatic: false,
    audio: null, audioFile: null, wake: null, anchors: [], lastAutoScroll: 0,
    firstLyricTop: 0, syncLag: 1.2, part: 'lyrics'
  };
  function liveSections(song) {
    if (!song) return [];
    if (live.part === 'drums') { var d = drumSections(song); if (d && d.length) return d; }
    return song.sections || [];
  }

  function openLive() {
    var song = currentSong();
    if (!song) return;
    live.songId = song.id;
    live.open = true;
    live.paused = true;
    live.counting = false;
    if (live.cdTimer) { clearInterval(live.cdTimer); live.cdTimer = null; }
    $('live-countdown').classList.add('hidden');
    document.body.classList.add('live-open');
    $('live').classList.remove('hidden');
    renderLiveProfileSelect();
    renderLive();
    startLiveRaf();
    requestWake();
  }
  function closeLive() {
    live.open = false;
    if (live.cdTimer) { clearInterval(live.cdTimer); live.cdTimer = null; }
    $('live-countdown').classList.add('hidden');
    if (live.audio) live.audio.pause();
    stopLiveRaf();
    releaseWake();
    document.body.classList.remove('live-open');
    $('live').classList.add('hidden');
  }
  function renderLive() {
    var song = songById(live.songId);
    if (!song) return;
    if (live.part === 'drums' && !drumSections(song)) live.part = 'lyrics';
    $('live-song').textContent = song.title + (live.part === 'drums' ? ' — 🥁 Drums' : '');
    var chart = $('live-chart');
    var secs = liveSections(song);
    chart.innerHTML = secs.length
      ? secs.map(function (s, i) { return CHART.sectionHTML(s, i); }).join('')
      : '<div class="empty-box">' + (live.part === 'drums' ? 'No drum notes yet — add them in the 🥁 Drums tab.' : 'No chart yet — add one with ✏️ or upload the song file.') + '</div>';
    computeAnchors(song);
    live.firstLyricTop = computeFirstLyricTop();
    $('live-scroll').scrollTop = 0;
    var ar = $('live-audio-row');
    if (song.mp3) {
      if (!live.audio) { live.audio = new Audio(); bindLiveAudio(); }
      if (live.audioFile !== song.mp3) {
        live.audioFile = song.mp3;
        live.audio.src = 'songs/' + song.mp3;
        live.audio.load();
      }
      ar.classList.remove('hidden');
    } else {
      live.audioFile = null;
      if (live.audio) { live.audio.pause(); live.audio.removeAttribute('src'); live.audio.load(); }
      ar.classList.add('hidden');
    }
    live.autoMode = song.mp3 ? 'sync' : 'manual';
    $('live-section').textContent = '';
    updateLiveButtons();
    applyLivePrefs();
  }
  function renderLiveProfileSelect() {
    var sel = $('live-profile');
    sel.innerHTML = state.profiles.map(function (n) {
      return '<option value="' + esc(n) + '"' + (n === state.profileName ? ' selected' : '') + '>' + esc(n) + '</option>';
    }).join('');
  }
  function applyLivePrefs() {
    document.documentElement.style.setProperty('--lyr', profile.fontSize + 'px');
    $('live-font').textContent = profile.fontSize;
    $('live-speed').textContent = profile.speed;
    $('live').classList.toggle('light', !profile.dark);
    $('live-dark').textContent = profile.dark ? '☀️' : '🌙';
    var song = songById(live.songId);
    if (song) computeAnchors(song);
  }
  function computeAnchors(song) {
    live.anchors = [];
    var chart = $('live-chart');
    if (!chart) return;
    var els = chart.querySelectorAll('.lsection');
    var secs = liveSections(song);
    for (var i = 0; i < els.length; i++) {
      var s = secs[i];
      live.anchors.push({ top: els[i].offsetTop, start: s ? s.start : null, end: s ? s.end : null });
    }
  }
  function bindLiveAudio() {
    var a = live.audio;
    a.preload = 'metadata';
    a.addEventListener('timeupdate', onLiveAudioTime);
    a.addEventListener('play', function () {
      if (live.autoMode === 'sync') { live.paused = false; updateLiveButtons(); }
    });
    a.addEventListener('pause', function () {
      if (live.autoMode === 'sync') { live.paused = true; updateLiveButtons(); }
    });
    a.addEventListener('seeked', function () {
      live.manualUntil = 0;
      var sc = $('live-scroll');
      var v = computeSyncTarget();
      if (v != null) { live.lastAutoScroll = Date.now(); sc.scrollTop = v; }
      onLiveAudioTime();
    });
    a.addEventListener('ended', function () { live.paused = true; updateLiveButtons(); });
    a.addEventListener('loadedmetadata', function () {
      var seek = $('audio-seek');
      if (a.duration && isFinite(a.duration)) seek.max = a.duration;
      $('audio-time').textContent = '0:00 / ' + fmtTime(a.duration);
    });
  }
  function onLiveAudioTime() {
    var a = live.audio;
    if (!a) return;
    var song = songById(live.songId);
    var t = a.currentTime;
    var idx = -1;
    var secs = liveSections(song);
    secs.forEach(function (s, i) { if (s.start != null && t >= s.start) idx = i; });
    var badge = $('live-section');
    if (idx >= 0) badge.textContent = (secs[idx].name || '').toUpperCase();
    else badge.textContent = '';
    $('audio-time').textContent = fmtTime(t) + ' / ' + fmtTime(a.duration);
    var seek = $('audio-seek');
    if (document.activeElement !== seek && a.duration && isFinite(a.duration)) seek.value = t;
  }
  function computeFirstLyricTop() {
    var chart = $('live-chart');
    if (!chart) return 0;
    var els = chart.querySelectorAll('.chart-plain, .chart-line:not(.chordrow)');
    for (var i = 0; i < els.length; i++) {
      var txt = els[i].textContent || '';
      if (txt.trim()) return els[i].offsetTop;
    }
    return 0;
  }
  function computeSyncTarget() {
    var song = songById(live.songId), a = live.audio, sc = $('live-scroll'), chart = $('live-chart');
    if (!a || !(a.readyState >= 1) || !a.duration) return null;
    var maxScroll = Math.max(chart.scrollHeight - sc.clientHeight, 0);
    var dur = a.duration, t = a.currentTime || 0;
    var sects = liveSections(song);
    if (sects.length && live.anchors.length && sects.every(function (s) { return s.start != null; })) {
      var i = 0;
      while (i < sects.length - 1 && (sects[i + 1].start == null || sects[i + 1].start <= t)) i++;
      var a0 = live.anchors[i];
      var a1 = (i + 1 < live.anchors.length) ? live.anchors[i + 1] : { top: maxScroll };
      var segEnd = sects[i].end != null ? sects[i].end : (i + 1 < sects.length ? sects[i + 1].start : dur);
      var span = Math.max(segEnd - sects[i].start, 0.001);
      var p = clamp((t - sects[i].start) / span, 0, 1);
      return a0.top + (a1.top - a0.top) * p;
    }
    if (dur > 0) {
      /* No section timings yet: map audio time to chart position, but keep the
         chart trailing the music (lag) and do NOT scroll during the intro —
         hold at the top until the audio reaches the point where the first
         lyric line appears in the chart. */
      var fTop = (live.firstLyricTop != null && live.firstLyricTop > 0) ? live.firstLyricTop : 0;
      var t2 = t - (live.syncLag || 0);
      if (fTop <= 0) return maxScroll * clamp(t2 / dur, 0, 1);
      var holdUntil = dur * (fTop / Math.max(maxScroll, 1));
      if (t2 <= holdUntil) return 0;
      var span2 = Math.max(dur - holdUntil, 0.001);
      return fTop + (maxScroll - fTop) * clamp((t2 - holdUntil) / span2, 0, 1);
    }
    return null;
  }
  function startLiveRaf() { if (!live.raf) { live.lastT = performance.now(); live.raf = requestAnimationFrame(liveTick); } }
  function stopLiveRaf() { if (live.raf) { cancelAnimationFrame(live.raf); live.raf = null; } }
  function liveTick(ts) {
    if (!live.open) return;
    var sc = $('live-scroll');
    if (!live.counting && !live.paused && ts >= live.manualUntil) {
      if (live.autoMode === 'sync') {
        var a = live.audio;
        if (a && a.src && a.readyState >= 1 && !a.paused) {
          var v = computeSyncTarget();
          if (v != null) { live.lastAutoScroll = Date.now(); sc.scrollTop = v; }
        }
      } else {
        var dt = clamp((ts - live.lastT) / 1000, 0, 0.1);
        live.lastAutoScroll = Date.now();
        sc.scrollTop += profile.speed * dt;
      }
    }
    live.lastT = ts;
    live.raf = requestAnimationFrame(liveTick);
  }
  function liveStart() {
    if (live.counting) return;
    var sc = $('live-scroll');
    sc.scrollTop = 0;
    if (live.audio && live.audio.src) { live.audio.pause(); live.audio.currentTime = 0; }
    live.manualUntil = 0;
    live.counting = true;
    live.countdownN = 5;
    var ov = $('live-countdown');
    ov.classList.remove('hidden');
    ov.textContent = '5';
    updateLiveButtons();
    live.cdTimer = setInterval(function () {
      live.countdownN--;
      if (live.countdownN <= 0) {
        clearInterval(live.cdTimer);
        live.cdTimer = null;
        ov.classList.add('hidden');
        live.counting = false;
        live.paused = false;
        live.manualUntil = 0;
        live.lastT = performance.now();
        var a = live.audio;
        if (live.autoMode === 'sync' && a && a.src) {
          a.currentTime = 0;
          a.play().catch(function () { toast('Tap ⏯ to start audio'); });
        }
        updateLiveButtons();
      } else ov.textContent = String(live.countdownN);
    }, 1000);
  }
  function liveTogglePause() {
    if (live.counting) return;
    live.paused = !live.paused;
    live.manualUntil = 0;
    var a = live.audio;
    if (live.autoMode === 'sync' && a && a.src && a.readyState >= 1) {
      if (live.paused) a.pause(); else a.play().catch(function () {});
    }
    updateLiveButtons();
  }
  function liveRestart() {
    if (live.counting) return;
    live.paused = true;
    $('live-scroll').scrollTop = 0;
    if (live.audio && live.audio.src) { live.audio.pause(); live.audio.currentTime = 0; }
    $('live-section').textContent = '';
    updateLiveButtons();
  }
  function liveNav(dir) {
    var i = state.order.indexOf(live.songId);
    var j = (i + dir + state.order.length) % state.order.length;
    live.songId = state.order[j];
    live.paused = true;
    if (live.cdTimer) { clearInterval(live.cdTimer); live.cdTimer = null; live.counting = false; $('live-countdown').classList.add('hidden'); }
    renderLive();
  }
  function updateLiveButtons() {
    $('live-pause').textContent = live.paused ? '▶' : '⏸';
    $('live-pause').title = live.paused ? 'Resume' : 'Pause';
    var canSync = !!(live.audio && live.audio.src);
    var sb = $('live-sync');
    sb.classList.toggle('active', live.autoMode === 'sync');
    sb.classList.toggle('disabled', !canSync);
    sb.title = canSync ? (live.autoMode === 'sync' ? 'Audio sync ON — chart follows the MP3' : 'Audio sync OFF — steady scroll') : 'No MP3 — steady scroll';
    var hasDrums = !!drumSections(songById(live.songId));
    var pb = $('live-part');
    if (pb) {
      pb.classList.toggle('disabled', !hasDrums);
      pb.textContent = live.part === 'drums' ? '🎤' : '🥁';
      pb.title = hasDrums ? (live.part === 'drums' ? 'Showing drum notes — tap for lyrics' : 'Showing lyrics — tap for drum notes') : 'No drum notes uploaded yet';
    }
  }
  function toggleLivePart() {
    var song = songById(live.songId);
    if (!song || !drumSections(song)) return;
    live.part = live.part === 'drums' ? 'lyrics' : 'drums';
    live.paused = true;
    if (live.cdTimer) { clearInterval(live.cdTimer); live.cdTimer = null; live.counting = false; $('live-countdown').classList.add('hidden'); }
    if (live.audio) live.audio.pause();
    renderLive();
  }
  function toggleSyncMode() {
    if (!(live.audio && live.audio.src)) return;
    live.autoMode = live.autoMode === 'sync' ? 'manual' : 'sync';
    updateLiveButtons();
  }
  function requestWake() {
    if ('wakeLock' in navigator && navigator.wakeLock) {
      navigator.wakeLock.request('screen').then(function (wl) { live.wake = wl; }).catch(function () {});
    }
  }
  function releaseWake() {
    if (live.wake) { try { live.wake.release(); } catch (e) {} live.wake = null; }
  }
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden && live.open) requestWake();
  });
  window.addEventListener('resize', function () {
    if (live.open) { var s = songById(live.songId); if (s) computeAnchors(s); }
  });

  /* ================= screens + wiring ================= */
  function setScreen(scr) {
    var screens = ['study', 'vote', 'setlist', 'drums'];
    screens.forEach(function (s) {
      $('screen-' + s).classList.toggle('active', s === scr);
    });
    document.querySelectorAll('.navbtn').forEach(function (b) {
      b.classList.toggle('active', b.getAttribute('data-screen') === scr);
    });
    if (scr === 'vote') renderVote();
    if (scr === 'setlist') renderSetlist();
    if (scr === 'drums') renderDrums();
  }
  function activeScreen() {
    var s = ['study', 'vote', 'setlist', 'drums'];
    for (var i = 0; i < s.length; i++) if ($('screen-' + s[i]).classList.contains('active')) return s[i];
    return 'study';
  }

  function checkPin() {
    if (!state.pin) { $('pin-gate').classList.add('hidden'); $('app').classList.remove('hidden'); }
    else { $('app').classList.add('hidden'); $('pin-gate').classList.remove('hidden'); }
  }

  function wire() {
    /* static buttons */
    $('btn-edit').onclick = openEditor;
    $('pin-unlock').onclick = function () {
      if ($('pin-input').value === state.pin) { $('pin-error').classList.add('hidden'); checkPin(); }
      else $('pin-error').classList.remove('hidden');
    };
    $('pin-input').addEventListener('keydown', function (e) { if (e.key === 'Enter') $('pin-unlock').click(); });

    $('editor-cancel').onclick = function () { $('editor-modal').classList.add('hidden'); };
    $('editor-save').onclick = saveEditor;
    $('editor-reset').onclick = resetEditor;

    /* live controls */
    $('live-close').onclick = closeLive;
    $('live-start').onclick = liveStart;
    $('live-pause').onclick = liveTogglePause;
    $('live-restart').onclick = liveRestart;
    $('live-prev').onclick = function () { liveNav(-1); };
    $('live-next').onclick = function () { liveNav(1); };
    $('live-slower').onclick = function () { profile.speed = clamp(profile.speed - 2, 1, 200); saveProfile(); applyLivePrefs(); };
    $('live-faster').onclick = function () { profile.speed = clamp(profile.speed + 2, 1, 200); saveProfile(); applyLivePrefs(); };
    $('live-font-down').onclick = function () { profile.fontSize = clamp(profile.fontSize - 3, 20, 64); saveProfile(); applyLivePrefs(); };
    $('live-font-up').onclick = function () { profile.fontSize = clamp(profile.fontSize + 3, 20, 64); saveProfile(); applyLivePrefs(); };
    $('live-dark').onclick = function () { profile.dark = !profile.dark; saveProfile(); applyLivePrefs(); };
    $('live-sync').onclick = toggleSyncMode;
    $('live-part').onclick = toggleLivePart;
    $('live-profile').addEventListener('change', function () { setProfile(this.value); renderLiveProfileSelect(); });
    $('live-profile-add').onclick = function () {
      var name = window.prompt('Musician name for this phone:');
      if (name && String(name).trim()) { setProfile(String(name).trim()); renderLiveProfileSelect(); toast('Profile saved: ' + String(name).trim()); }
    };
    $('audio-play').onclick = function () {
      var a = live.audio;
      if (!a || !a.src) return;
      if (a.paused) a.play().catch(function () {}); else a.pause();
    };
    $('audio-seek').addEventListener('input', function () {
      var a = live.audio;
      if (a && a.duration && isFinite(a.duration)) { a.currentTime = parseFloat(this.value); onLiveAudioTime(); }
    });

    /* scroll container: manual scrolling pauses auto, tap toggles pause */
    var sc = $('live-scroll');
    sc.addEventListener('scroll', function () {
      if (Date.now() - live.lastAutoScroll > 120) live.manualUntil = Date.now() + 2500;
    });
    var tapStart = null;
    sc.addEventListener('pointerdown', function (e) { tapStart = { x: e.clientX, y: e.clientY, t: Date.now() }; });
    sc.addEventListener('pointerup', function (e) {
      if (!tapStart) return;
      var dx = Math.abs(e.clientX - tapStart.x), dy = Math.abs(e.clientY - tapStart.y), dt = Date.now() - tapStart.t;
      tapStart = null;
      if (dx < 10 && dy < 10 && dt < 400 && !live.counting) liveTogglePause();
    });

    /* delegated clicks */
    document.addEventListener('click', function (e) {
      var t = e.target;
      var chip = t.closest && t.closest('.chip[data-song]');
      if (chip) {
        state.currentId = chip.getAttribute('data-song');
        renderSongTabs();
        if (activeScreen() === 'drums') renderDrums(); else renderStudy();
        return;
      }
      var nav = t.closest && t.closest('.navbtn[data-screen]');
      if (nav) {
        var scr = nav.getAttribute('data-screen');
        if (scr === 'live') { openLive(); return; }
        setScreen(scr);
        return;
      }
      if (t.closest && t.closest('#btn-go-live')) { openLive(); return; }
      var star = t.closest && t.closest('.star');
      if (star) {
        var vs = star.closest('.stars');
        if (vs) { var d = ballotDraft(); d.ratings[vs.getAttribute('data-song')] = parseInt(star.getAttribute('data-v'), 10); saveDraft(d); renderStars(vs, d.ratings[vs.getAttribute('data-song')]); }
        return;
      }
      var cb = t.closest && t.closest('.cbtn');
      if (cb) {
        var cs = cb.closest('.choice');
        if (cs) {
          var d2 = ballotDraft(), c = cb.getAttribute('data-c'), sid = cs.getAttribute('data-song');
          d2.choices[sid] = d2.choices[sid] === c ? undefined : c;
          saveDraft(d2);
          renderChoice(cs, d2.choices[sid]);
        }
        return;
      }
      var up = t.closest && t.closest('.sup');
      if (up) { moveSetlist(up.getAttribute('data-id'), -1); return; }
      var down = t.closest && t.closest('.sdown');
      if (down) { moveSetlist(down.getAttribute('data-id'), 1); return; }
      if (t.closest && t.closest('#vote-save')) { toast('Ballot saved on this phone'); return; }
      if (t.closest && t.closest('#drums-save')) {
        lsSet('btbs_drums_' + state.currentId, $('drums-text').value);
        var st = $('drums-status');
        if (st) st.textContent = '💾 Saved on this phone — Live mode now shows this drum chart here. Tap 📋 Copy to send it to Benny for the whole band.';
        toast('Drum notes saved');
        return;
      }
      if (t.closest && t.closest('#drums-copy')) { copyDrums(); return; }
      if (t.closest && t.closest('#drums-clear')) {
        lsDel('btbs_drums_' + state.currentId);
        var s2 = songById(state.currentId);
        var dt = $('drums-text');
        if (dt) dt.value = (s2 && s2.drumNotes) || '';
        var st2 = $('drums-status');
        if (st2) st2.textContent = 'Local drum notes cleared.';
        toast('Cleared local drum notes');
        return;
      }
    });

    /* delegated changes */
    document.addEventListener('change', function (e) {
      var t = e.target;
      if (t.id === 'vote-name') {
        state.voterName = t.value.trim();
        lsSet('btbs_voter', state.voterName);
        applyBallotToForm();
        return;
      }
      var vc = t.closest && t.closest('.vcomment');
      if (vc) {
        var d = ballotDraft();
        d.comments[vc.getAttribute('data-song')] = t.value;
        saveDraft(d);
        return;
      }
      var st = t.closest && t.closest('.stime');
      if (st) {
        var id = st.getAttribute('data-id');
        var secs = parseTimeStr(st.value);
        if (secs == null && String(st.value).trim() !== '') {
          toast('Use m:ss');
          st.value = state.setlist.times[id] != null ? fmtTime(state.setlist.times[id]) : '';
          return;
        }
        if (secs == null) delete state.setlist.times[id]; else state.setlist.times[id] = secs;
        saveSetlist();
        updateSetlistTotal();
        return;
      }
      var sinc = t.closest && t.closest('.sinc');
      if (sinc) {
        var id2 = sinc.getAttribute('data-id');
        state.setlist.included[id2] = sinc.checked;
        saveSetlist();
        updateSetlistTotal();
        var row = sinc.closest('.srow');
        if (row) row.classList.toggle('excluded', !sinc.checked);
        return;
      }
    });
  }

  init();
})();
