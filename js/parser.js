/* parser.js — chart text format <-> song data, plus shared renderers.
   Format:
     title: Teach Me to Dance
     key: E
     capo: 1
     bpm: 92
     time: 4/4
     duration: 3:04
     ug: https://tabs.ultimate-guitar.com/...
     video: https://...
     mp3: filename.mp3

     ## Intro [0-8]
     [D] [A] [G] | [E] [G] [A]
     ## Verse 1 [8-30]
     [E]Daddy's at the [A]bar again tonight
     {comment: stage direction}
     ## Band Notes
     count-in: ...
     drums: ...
*/
(function (global) {
  'use strict';

  var BAND_NOTE_KEYS = ['countIn', 'drums', 'bass', 'guitar', 'harmonies', 'stops', 'dynamics', 'solos', 'ending'];
  var BAND_NOTE_LABELS = { countIn: 'Count-in', drums: 'Drums', bass: 'Bass', guitar: 'Guitar', harmonies: 'Harmonies', stops: 'Stops', dynamics: 'Dynamics', solos: 'Solos', ending: 'Ending' };
  var SECTION_KEYWORDS = [
    ['pre-chorus', 'pre-chorus'], ['intro', 'intro'], ['verse', 'verse'], ['chorus', 'chorus'],
    ['bridge', 'bridge'], ['solo', 'solo'], ['outro', 'outro'], ['ending', 'ending']
  ];
  var META_MAP = {
    title: 'title', key: 'key', capo: 'capo', bpm: 'bpm', time: 'timeSig',
    'time signature': 'timeSig', timesig: 'timeSig', duration: 'duration',
    ug: 'ugUrl', 'ultimate guitar': 'ugUrl', tab: 'ugUrl', video: 'videoUrl', mp3: 'mp3'
  };
  var BAND_KEY_MAP = {
    'count-in': 'countIn', countin: 'countIn', drums: 'drums', bass: 'bass', guitar: 'guitar',
    harmonies: 'harmonies', harmony: 'harmonies', stops: 'stops', stop: 'stops',
    dynamics: 'dynamics', dynamic: 'dynamics', solos: 'solos', solo: 'solos',
    ending: 'ending', end: 'ending'
  };

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function classifySection(name) {
    var n = String(name || '').toLowerCase();
    for (var i = 0; i < SECTION_KEYWORDS.length; i++) {
      if (n.indexOf(SECTION_KEYWORDS[i][0]) !== -1) return SECTION_KEYWORDS[i][1];
    }
    return 'other';
  }

  /* Parse one lyric line:
     "[E]Daddy's at the [A]bar" -> {segments:[{chord,text},...]}
     "{comment: ...}"            -> {comment}
     ""                          -> {blank}
     anything else               -> {plain} */
  function parseLine(text) {
    text = String(text == null ? '' : text);
    if (!text.trim()) return { blank: true };
    var trimmed = text.trim();
    if (trimmed.indexOf('{comment:') === 0) {
      return { comment: trimmed.slice(trimmed.indexOf(':') + 1).replace(/\}$/, '').trim() };
    }
    var segments = [];
    var re = /\[([^\]]+)\]([^\[]*)/g;
    var m, last = 0;
    while ((m = re.exec(text)) !== null) {
      if (m.index > last) segments.push({ chord: null, text: text.slice(last, m.index) });
      segments.push({ chord: m[1].trim(), text: m[2] });
      last = m.index + m[0].length;
    }
    if (!segments.length) return { plain: trimmed };
    if (last < text.length) segments.push({ chord: null, text: text.slice(last) });
    return { segments: segments };
  }

  function parseTimingHeader(body) {
    var m = String(body).match(/^(.*?)\s*\[(\d+(?:\.\d+)?)(?:\s*-\s*(\d+(?:\.\d+)?))?\]\s*$/);
    if (!m) return { name: body, start: null, end: null };
    return { name: m[1].trim(), start: parseFloat(m[2]), end: m[3] != null ? parseFloat(m[3]) : null };
  }

  /* Editor text -> patch (a partial song). Apply with applyPatch() in app.js */
  function textToPatch(text) {
    var lines = String(text == null ? '' : text).split(/\r?\n/);
    var patch = { meta: {}, sections: [], bandNotes: {}, notes: [], hasSections: false };
    var mode = 'meta';
    var cur = null;
    function flushMeta(mk, mv) {
      if (!META_MAP[mk]) return false;
      var k = META_MAP[mk];
      if (k === 'capo' || k === 'bpm') patch.meta[k] = mv === '' ? null : parseInt(mv, 10);
      else patch.meta[k] = mv === '' ? null : mv;
      return true;
    }
    lines.forEach(function (raw) {
      var t = raw.trim();
      if (!t) {
        if (mode === 'section' && cur) cur.lines.push({ blank: true });
        return;
      }
      if (t.indexOf('## ') === 0) {
        var body = t.slice(3).trim();
        if (/^band\s*notes$/i.test(body)) { mode = 'band'; cur = null; return; }
        if (/^notes?$/i.test(body)) { mode = 'notes'; cur = null; return; }
        var h = parseTimingHeader(body);
        mode = 'section';
        cur = { name: h.name, type: classifySection(h.name), start: h.start, end: h.end, lines: [] };
        patch.sections.push(cur);
        return;
      }
      if (mode === 'band') {
        var bi = t.indexOf(':');
        if (bi > 0) {
          var key = t.slice(0, bi).trim().toLowerCase().replace(/[^a-z]/g, '');
          if (BAND_KEY_MAP[key]) { patch.bandNotes[BAND_KEY_MAP[key]] = t.slice(bi + 1).trim(); return; }
        }
        patch.notes.push(t);
        return;
      }
      if (mode === 'notes') { patch.notes.push(t); return; }
      if (mode === 'section' && cur) {
        var pl = parseLine(t);
        if (pl) cur.lines.push(pl);
        return;
      }
      var ci = t.indexOf(':');
      if (ci > 0 && flushMeta(t.slice(0, ci).trim().toLowerCase(), t.slice(ci + 1).trim())) return;
      patch.notes.push(t);
    });
    patch.sections.forEach(function (s) {
      while (s.lines.length && s.lines[0] && s.lines[0].blank) s.lines.shift();
      while (s.lines.length && s.lines[s.lines.length - 1] && s.lines[s.lines.length - 1].blank) s.lines.pop();
    });
    patch.hasSections = patch.sections.length > 0;
    return patch;
  }

  function chordToBracket(seg) { return seg.chord ? '[' + seg.chord + ']' + (seg.text || '') : (seg.text || ''); }
  function lineToText(ln) {
    if (!ln) return '';
    if (ln.comment) return '{comment: ' + ln.comment + '}';
    if (ln.plain) return ln.plain;
    if (ln.blank) return '';
    if (ln.segments) return ln.segments.map(chordToBracket).join('');
    return '';
  }
  function bandNoteKeyToLabel(k) { return k === 'countIn' ? 'count-in' : k; }

  /* song -> editor text (round-trips with textToPatch) */
  function songToText(song) {
    var out = [];
    function put(k, v) { if (v !== null && v !== undefined && v !== '') out.push(k + ': ' + v); }
    var m = song.meta || {};
    put('title', song.title);
    put('key', m.key); put('capo', m.capo); put('bpm', m.bpm); put('time', m.timeSig);
    put('duration', m.duration); put('ug', m.ugUrl); put('video', m.videoUrl); put('mp3', song.mp3);
    if (out.length) out.push('');
    (song.sections || []).forEach(function (s) {
      var hdr = '## ' + s.name;
      if (s.start != null) hdr += ' [' + s.start + (s.end != null ? '-' + s.end : '') + ']';
      out.push(hdr);
      (s.lines || []).forEach(function (ln) { var lt = lineToText(ln); if (lt) out.push(lt); else out.push(''); });
      out.push('');
    });
    var hasBand = (song.bandNotes || {}) && BAND_NOTE_KEYS.some(function (k) { return song.bandNotes[k]; });
    var hasNotes = song.notes && song.notes.length;
    if (hasBand) {
      out.push('## Band Notes');
      BAND_NOTE_KEYS.forEach(function (k) { if (song.bandNotes[k]) out.push(bandNoteKeyToLabel(k) + ': ' + song.bandNotes[k]); });
      out.push('');
    }
    if (hasNotes) { out.push('## Notes'); song.notes.forEach(function (n) { out.push(n); }); }
    return out.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
  }

  /* Renderers shared by Study mode and Live mode */
  function renderLineHTML(ln) {
    if (!ln) return '';
    if (ln.comment) return '<div class="chart-comment">' + esc(ln.comment) + '</div>';
    if (ln.blank) return '<div class="chart-blank"></div>';
    if (ln.plain) return '<div class="chart-plain">' + esc(ln.plain) + '</div>';
    if (ln.segments) {
      var html = '<div class="chart-line">';
      ln.segments.forEach(function (seg) {
        var chord = seg.chord ? '<span class="chord">' + esc(seg.chord) + '</span>' : '<span class="chord cempty"></span>';
        html += '<span class="cw">' + chord + '<span class="lyr">' + esc(seg.text || '') + '</span></span>';
      });
      return html + '</div>';
    }
    return '';
  }

  function sectionHTML(sec, idx) {
    var timing = '';
    if (sec.start != null) timing = '<span class="sec-time">' + fmtT(sec.start) + (sec.end != null ? ' – ' + fmtT(sec.end) : '') + '</span>';
    var body = (sec.lines || []).map(renderLineHTML).join('');
    return '<div class="section lsection sec-' + esc(sec.type) + '" data-i="' + idx + '">' +
      '<div class="sec-hdr"><span class="sec-name">' + esc(sec.name) + '</span>' + timing + '</div>' +
      '<div class="sec-body">' + body + '</div></div>';
  }

  function fmtT(s) {
    if (s == null || isNaN(s)) return '';
    s = Math.max(0, Math.round(s));
    var m = Math.floor(s / 60), sec = s % 60;
    return m + ':' + (sec < 10 ? '0' : '') + sec;
  }

  global.CHART = {
    esc: esc, classifySection: classifySection, parseLine: parseLine,
    textToPatch: textToPatch, songToText: songToText,
    renderLineHTML: renderLineHTML, sectionHTML: sectionHTML, fmtT: fmtT,
    BAND_NOTE_KEYS: BAND_NOTE_KEYS, BAND_NOTE_LABELS: BAND_NOTE_LABELS
  };
})(window);
