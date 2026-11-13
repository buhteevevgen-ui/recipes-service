// Сервис рецептов — статическая страница. Данные берутся из recipes.json.
(function () {
  'use strict';

  // Те же правила поиска, что в recipes.py
  var WEIGHTS = { title: 5, tags: 3, ingredients: 2, steps: 1, notes: 1, bbq: 1 };
  var STEM_LEN = 5;

  var app = document.getElementById('app');
  var countEl = document.getElementById('count');
  var recipes = [];
  var sections = [];
  var state = { q: '', section: '' };

  function normalize(text) {
    var words = String(text || '').toLowerCase().replace(/ё/g, 'е').match(/[\p{L}\p{N}]+/gu) || [];
    return words.map(function (w) { return w.slice(0, STEM_LEN); });
  }
  // «голубого сыра» найдёт «голубым сыром», «грибы» найдёт «грибами»
  function match(word, stem) {
    if (stem.length < 3 || word.length < 3) return word.indexOf(stem) === 0;
    var n = Math.max(3, Math.min(word.length, stem.length) - 1);
    return word.slice(0, n) === stem.slice(0, n);
  }
  // Ингредиент — строка или объект { item, qty, qty_max, unit, note, optional }.
  // Текст для показа и поиска: «item — qty[–qty_max] unit, note, по желанию»; строка возвращается как есть.
  function ingNum(v) {
    if (typeof v === 'number' && isFinite(v)) return String(v).replace('.', ',');
    return typeof v === 'string' ? v : '';
  }
  function ingText(x) {
    if (typeof x === 'string') return x;
    if (!x || typeof x !== 'object' || Array.isArray(x)) return x == null ? '' : String(x);
    var q = ingNum(x.qty), qmax = ingNum(x.qty_max), parts = [];
    if (q && qmax) q += '–' + qmax;
    if (typeof x.unit === 'string' && x.unit) q += (q ? ' ' : '') + x.unit;
    if (q) parts.push(q);
    if (typeof x.note === 'string' && x.note) parts.push(x.note);
    if (x.optional === true) parts.push('по желанию');
    var item = (typeof x.item === 'string' || typeof x.item === 'number') ? String(x.item) : '';
    return item + (parts.length ? (item ? ' — ' : '') + parts.join(', ') : '');
  }
  function fieldText(r, f) {
    if (f === 'bbq') {
      var b = r.bbq;
      if (!b) return '';
      var parts = [b.meat, b.wood, b.heat, b.marinade_note, b.marinade_variant].concat((Array.isArray(b.marinade) ? b.marinade : []).map(ingText), b.tips || []);
      (Array.isArray(b.summary) ? b.summary : []).forEach(function (f) { parts.push(f.label, f.value, f.note); });
      (Array.isArray(b.stages) ? b.stages : []).forEach(function (s) { parts.push(s.title, s.note); });
      return parts.join(' ');
    }
    var v = r[f];
    if (f === 'ingredients' && Array.isArray(v)) return v.map(ingText).join(' ');
    return Array.isArray(v) ? v.join(' ') : String(v || '');
  }
  function score(r, stems) {
    var total = 0;
    for (var i = 0; i < stems.length; i++) {
      var found = 0;
      for (var f in WEIGHTS) {
        var words = normalize(fieldText(r, f));
        var hits = words.filter(function (w) { return match(w, stems[i]); }).length;
        found += hits * WEIGHTS[f];
      }
      if (!found) return 0; // все слова запроса должны встретиться
      total += found;
    }
    return total;
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  // Подсветка идёт по исходному тексту, экранируется каждый кусок отдельно
  function highlight(text, stems) {
    text = String(text);
    if (!stems.length) return esc(text);
    var out = '', last = 0, re = /[\p{L}\p{N}]+/gu, m;
    while ((m = re.exec(text))) {
      var w = m[0], n = w.toLowerCase().replace(/ё/g, 'е');
      out += esc(text.slice(last, m.index));
      out += stems.some(function (s) { return match(n.slice(0, STEM_LEN), s); }) ? '<mark>' + esc(w) + '</mark>' : esc(w);
      last = m.index + w.length;
    }
    return out + esc(text.slice(last));
  }
  // Неразрывные пробелы: «74 °C», «1 ч», «лучше 5», «+ отдых» и диапазоны «110–120» не рвутся при переносе
  function tight(s) {
    return String(s)
      .replace(/(\d) (°C|ч|мин|сут|кг|г|мл)(?![\p{L}])/gu, '$1\u00a0$2')
      .replace(/(\p{L}) (\d)/gu, '$1\u00a0$2')
      .replace(/\+ /g, '+\u00a0')
      .replace(/(\d)–(?=\d)/g, '$1\u2060–\u2060');
  }
  function safeDecode(s) {
    try { return decodeURIComponent(s); } catch (e) { return s; }
  }
  var BASE_TITLE = 'Сервис рецептов';
  function setTitle(part) { document.title = part ? part + ' — ' + BASE_TITLE : BASE_TITLE; }
  function plural(n, one, few, many) {
    var m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return one;
    if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
    return many;
  }
  function metaLine(r) {
    var parts = [];
    if (r.time_minutes) parts.push(esc(r.time_minutes) + ' мин');
    if (r.servings) parts.push(esc(r.servings) + ' ' + plural(r.servings, 'порция', 'порции', 'порций'));
    if (r.bbq && r.bbq.meat) parts.push(esc(r.bbq.meat));
    if (r.ingredients) parts.push(r.ingredients.length + ' ' + plural(r.ingredients.length, 'ингредиент', 'ингредиента', 'ингредиентов'));
    return parts.map(function (p) { return '<span>' + p + '</span>'; }).join('');
  }

  function inSection(r, id) { return !id || (r.sections || []).indexOf(id) !== -1; }
  function sectionTitle(id) {
    var s = sections.filter(function (x) { return x.id === id; })[0];
    return s ? s.title : id;
  }

  // ---------- Карточка «Кратко» (гриль и смокер) ----------
  // bbq.summary: [{label, value, note}] — крупные факты; bbq.tips: [строки] — важные фишки.
  // Если summary не задан, факты собираются из chamber_temp_c, target_internal_c и marinade_days.
  function bbqSummary(b) {
    var facts = Array.isArray(b.summary) ? b.summary : null;
    if (!facts) {
      facts = [];
      if (b.chamber_temp_c) facts.push({ label: 'Камера', value: b.chamber_temp_c + ' °C' });
      if (b.target_internal_c) facts.push({ label: 'Внутри', value: b.target_internal_c + ' °C' });
      if (b.marinade_days) facts.push({ label: 'Маринование', value: b.marinade_days + ' сут.' });
    }
    var tips = Array.isArray(b.tips) ? b.tips : [];
    if (!facts.length && !tips.length) return '';
    return '<section class="summary"><h2>Кратко</h2>' +
      (facts.length ? '<dl class="facts">' + facts.map(function (f) {
        return '<div><dt>' + esc(f.label) + '</dt><dd>' + esc(tight(f.value)) +
          (f.note ? ' <small>' + esc(tight(f.note)) + '</small>' : '') + '</dd></div>';
      }).join('') + '</dl>' : '') +
      (tips.length ? '<ul class="tips">' + tips.map(function (t) { return '<li>' + esc(t) + '</li>'; }).join('') + '</ul>' : '') +
      '</section>';
  }
  function bbqMarinade(b) {
    if (!(b.marinade || []).length) return '';
    return '<h2>Маринад</h2>' +
      '<ul class="ingredients">' + b.marinade.map(function (x) { return '<li>' + esc(ingText(x)) + '</li>'; }).join('') + '</ul>' +
      (b.marinade_note ? '<p class="subnote">' + esc(b.marinade_note) + '</p>' : '') +
      (b.marinade_variant ? '<div class="notes variant"><strong>Вариант</strong>' + esc(b.marinade_variant) + '</div>' : '');
  }
  function bbqStages(b) {
    if (!(b.stages || []).length) return '';
    return '<h2>Режим</h2><ol class="stages">' + b.stages.map(function (s) {
      var chips = [];
      if (s.temp_c) chips.push('Камера ' + s.temp_c + ' °C');
      if (s.time) chips.push(s.time);
      if (s.internal_c) chips.push('Внутри ' + s.internal_c + ' °C');
      return '<li class="stage"><h3>' + esc(s.title || '') + '</h3>' +
        (chips.length ? '<div class="chips">' + chips.map(function (c) { return '<span class="chip">' + esc(c) + '</span>'; }).join('') + '</div>' : '') +
        (s.note ? '<p>' + esc(s.note) + '</p>' : '') + '</li>';
    }).join('') + '</ol>';
  }

  // ---------- Список ----------
  function renderList() {
    setTitle(state.section ? sectionTitle(state.section) : '');

    var nav = '<nav class="sections" aria-label="Разделы">' +
      [{ id: '', title: 'Все' }].concat(sections).map(function (x) {
        var n = recipes.filter(function (r) { return inSection(r, x.id); }).length;
        return '<a class="section" href="' + (x.id ? '#/s/' + encodeURIComponent(x.id) : '#/') + '"' +
          (state.section === x.id ? ' aria-current="page"' : '') + '>' + esc(x.title) + ' <span>' + n + '</span></a>';
      }).join('') + '</nav>';

    // Скрытый h1: единственный заголовок первого уровня на списке и в разделе
    app.innerHTML = '<h1 class="visually-hidden">' + (state.section ? esc(sectionTitle(state.section)) : 'Рецепты') + '</h1>' + nav +
      '<div class="search"><input id="q" type="search" placeholder="Название, ингредиент или тег" autocomplete="off" aria-label="Поиск рецептов" value="' + esc(state.q) + '"></div>' +
      '<ul class="list" id="list"></ul>';

    var input = document.getElementById('q');
    input.addEventListener('input', function () { state.q = input.value; renderResults(); });
    renderResults();
  }

  function renderResults() {
    var stems = normalize(state.q);
    var list = recipes
      .filter(function (r) { return inSection(r, state.section); })
      .map(function (r) { return { r: r, s: stems.length ? score(r, stems) : 1 }; })
      .filter(function (x) { return x.s > 0; })
      .sort(function (a, b) { return b.s - a.s || a.r.title.localeCompare(b.r.title, 'ru'); });

    var el = document.getElementById('list');
    if (!list.length) {
      var empty = !stems.length && state.section;
      el.innerHTML = '<li class="state">' + (empty
        ? 'В разделе «' + esc(sectionTitle(state.section)) + '» пока нет рецептов.'
        : 'Ничего не нашлось. Попробуйте другое слово.') + '</li>';
      return;
    }
    el.innerHTML = list.map(function (x) {
      return '<li class="item"><a href="#/r/' + esc(encodeURIComponent(x.r.id)) + '"><h2>' + highlight(x.r.title, stems) + '</h2><div class="meta">' + metaLine(x.r) + '</div></a></li>';
    }).join('');
  }

  // ---------- Рецепт ----------
  function renderRecipe(id) {
    var r = recipes.filter(function (x) { return String(x.id) === String(id); })[0];
    if (!r) {
      setTitle('Рецепт не найден');
      app.innerHTML = '<h1 class="visually-hidden">Рецепт не найден</h1><a class="back" href="#/">← Все рецепты</a><p class="state">Такого рецепта нет.</p>';
      return;
    }
    setTitle(r.title);
    var b = r.bbq || null;
    app.innerHTML =
      (state.section
        ? '<a class="back" href="#/s/' + encodeURIComponent(state.section) + '">← ' + esc(sectionTitle(state.section)) + '</a>'
        : '<a class="back" href="#/">← Все рецепты</a>') +
      '<article class="recipe">' +
      ((r.sections || []).length ? '<div class="eyebrow">' + r.sections.map(function (id) {
        return '<a href="#/s/' + encodeURIComponent(id) + '">' + esc(sectionTitle(id)) + '</a>';
      }).join(' · ') + '</div>' : '') +
      '<h1>' + esc(r.title) + '</h1>' +
      '<div class="meta">' + metaLine(r) + '</div>' +
      (b ? bbqSummary(b) : '') +
      '<h2>Ингредиенты</h2>' +
      '<ul class="ingredients">' + (r.ingredients || []).map(function (x) { return '<li>' + esc(ingText(x)) + '</li>'; }).join('') + '</ul>' +
      (b ? bbqMarinade(b) : '') +
      (b ? bbqStages(b) : '') +
      '<h2>Приготовление</h2>' +
      '<ol class="steps">' + (r.steps || []).map(function (x, i) {
        return '<li><span class="num">' + (i + 1) + '</span><span>' + esc(x) + '</span></li>';
      }).join('') + '</ol>' +
      (r.notes ? '<div class="notes"><strong>Заметки</strong>' + esc(r.notes) + '</div>' : '') +
      '</article>';

    window.scrollTo(0, 0);
  }

  // ---------- Маршруты ----------
  function route() {
    var m = location.hash.match(/^#\/r\/(.+)$/);
    if (m) return renderRecipe(safeDecode(m[1]));
    var sm = location.hash.match(/^#\/s\/(.+)$/);
    state.section = sm ? safeDecode(sm[1]) : '';
    renderList();
  }

  fetch('recipes.json', { cache: 'no-cache' })
    .then(function (res) { if (!res.ok) throw new Error(res.status); return res.json(); })
    .then(function (data) {
      recipes = Array.isArray(data) ? data : (data.recipes || []);
      sections = data.sections || [];
      countEl.textContent = recipes.length + ' ' + plural(recipes.length, 'рецепт', 'рецепта', 'рецептов');
      window.addEventListener('hashchange', route);
      route();
    })
    .catch(function () {
      app.innerHTML = '<p class="state">Не удалось загрузить recipes.json. Откройте сайт по ссылке GitHub Pages, а не как файл с диска.</p>';
    });
})();
