// Сервис рецептов — статическая страница. Данные берутся из recipes.json.
(function () {
  'use strict';

  // Те же правила поиска, что в recipes.py
  var WEIGHTS = { title: 5, tags: 3, ingredients: 2, steps: 1, notes: 1 };
  var STEM_LEN = 5;

  var app = document.getElementById('app');
  var countEl = document.getElementById('count');
  var recipes = [];
  var state = { q: '', tag: '' };

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
  function fieldText(r, f) {
    var v = r[f];
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
  function highlight(text, stems) {
    var safe = esc(text);
    if (!stems.length) return safe;
    return safe.replace(/[\p{L}\p{N}]+/gu, function (w) {
      var n = w.toLowerCase().replace(/ё/g, 'е');
      return stems.some(function (s) { return match(n.slice(0, STEM_LEN), s); }) ? '<mark>' + w + '</mark>' : w;
    });
  }
  function plural(n, one, few, many) {
    var m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return one;
    if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
    return many;
  }
  function metaLine(r) {
    var parts = [];
    if (r.time_minutes) parts.push(r.time_minutes + ' мин');
    if (r.servings) parts.push(r.servings + ' ' + plural(r.servings, 'порция', 'порции', 'порций'));
    if (r.ingredients) parts.push(r.ingredients.length + ' ' + plural(r.ingredients.length, 'ингредиент', 'ингредиента', 'ингредиентов'));
    return parts.map(function (p) { return '<span>' + p + '</span>'; }).join('');
  }

  // ---------- Список ----------
  function renderList() {
    var allTags = {};
    recipes.forEach(function (r) { (r.tags || []).forEach(function (t) { allTags[t] = (allTags[t] || 0) + 1; }); });
    var tagNames = Object.keys(allTags).sort(function (a, b) { return allTags[b] - allTags[a] || a.localeCompare(b, 'ru'); });

    app.innerHTML =
      '<div class="search"><input id="q" type="search" placeholder="Название, ингредиент или тег" autocomplete="off" aria-label="Поиск рецептов" value="' + esc(state.q) + '"></div>' +
      (tagNames.length ? '<div class="tags" role="group" aria-label="Теги">' + tagNames.map(function (t) {
        return '<button class="tag" type="button" data-tag="' + esc(t) + '" aria-pressed="' + (state.tag === t) + '">' + esc(t) + '</button>';
      }).join('') + '</div>' : '') +
      '<ul class="list" id="list"></ul>';

    var input = document.getElementById('q');
    input.addEventListener('input', function () { state.q = input.value; renderResults(); });
    app.querySelectorAll('.tag').forEach(function (b) {
      b.addEventListener('click', function () {
        state.tag = state.tag === b.dataset.tag ? '' : b.dataset.tag;
        app.querySelectorAll('.tag').forEach(function (x) { x.setAttribute('aria-pressed', String(x.dataset.tag === state.tag)); });
        renderResults();
      });
    });
    renderResults();
  }

  function renderResults() {
    var stems = normalize(state.q);
    var list = recipes
      .filter(function (r) { return !state.tag || (r.tags || []).indexOf(state.tag) !== -1; })
      .map(function (r) { return { r: r, s: stems.length ? score(r, stems) : 1 }; })
      .filter(function (x) { return x.s > 0; })
      .sort(function (a, b) { return b.s - a.s || a.r.title.localeCompare(b.r.title, 'ru'); });

    var el = document.getElementById('list');
    if (!list.length) {
      el.innerHTML = '<li class="state">Ничего не нашлось. Попробуйте другое слово или снимите фильтр.</li>';
      return;
    }
    el.innerHTML = list.map(function (x) {
      return '<li class="item"><a href="#/r/' + x.r.id + '"><h2>' + highlight(x.r.title, stems) + '</h2><div class="meta">' + metaLine(x.r) + '</div></a></li>';
    }).join('');
  }

  // ---------- Рецепт ----------
  function storeKey(id) { return 'recipe-checks-' + id; }
  function loadChecks(id) { try { return JSON.parse(localStorage.getItem(storeKey(id))) || {}; } catch (e) { return {}; } }
  function saveChecks(id, v) { try { localStorage.setItem(storeKey(id), JSON.stringify(v)); } catch (e) {} }

  function renderRecipe(id) {
    var r = recipes.filter(function (x) { return String(x.id) === String(id); })[0];
    if (!r) {
      app.innerHTML = '<a class="back" href="#/">← Все рецепты</a><p class="state">Такого рецепта нет.</p>';
      return;
    }
    var checks = loadChecks(r.id);
    function box(kind, i, inner) {
      var k = kind + i;
      return '<li><label><input type="checkbox" data-k="' + k + '"' + (checks[k] ? ' checked' : '') + '><span>' + inner + '</span></label></li>';
    }
    app.innerHTML =
      '<a class="back" href="#/">← Все рецепты</a>' +
      '<article class="recipe">' +
      '<h1>' + esc(r.title) + '</h1>' +
      '<div class="meta">' + metaLine(r) + '</div>' +
      ((r.tags || []).length ? '<div class="tags">' + r.tags.map(function (t) {
        return '<button class="tag" type="button" data-tag="' + esc(t) + '">' + esc(t) + '</button>';
      }).join('') + '</div>' : '') +
      '<h2>Ингредиенты <button class="reset" type="button">сбросить отметки</button></h2>' +
      '<ul class="checks">' + (r.ingredients || []).map(function (x, i) { return box('i', i, esc(x)); }).join('') + '</ul>' +
      '<h2>Приготовление</h2>' +
      '<ol class="checks">' + (r.steps || []).map(function (x, i) {
        var k = 's' + i;
        return '<li><label><input type="checkbox" data-k="' + k + '"' + (checks[k] ? ' checked' : '') + '><span class="num">' + (i + 1) + '</span><span>' + esc(x) + '</span></label></li>';
      }).join('') + '</ol>' +
      (r.notes ? '<div class="notes"><strong>Заметки</strong>' + esc(r.notes) + '</div>' : '') +
      '</article>';

    app.querySelectorAll('input[type=checkbox]').forEach(function (c) {
      c.addEventListener('change', function () { checks[c.dataset.k] = c.checked; saveChecks(r.id, checks); });
    });
    app.querySelector('.reset').addEventListener('click', function () {
      checks = {}; saveChecks(r.id, checks);
      app.querySelectorAll('input[type=checkbox]').forEach(function (c) { c.checked = false; });
    });
    app.querySelectorAll('.tag').forEach(function (b) {
      b.addEventListener('click', function () { state.tag = b.dataset.tag; state.q = ''; location.hash = '#/'; });
    });
    window.scrollTo(0, 0);
  }

  // ---------- Маршруты ----------
  function route() {
    var m = location.hash.match(/^#\/r\/(.+)$/);
    if (m) renderRecipe(decodeURIComponent(m[1]));
    else renderList();
  }

  fetch('recipes.json', { cache: 'no-cache' })
    .then(function (res) { if (!res.ok) throw new Error(res.status); return res.json(); })
    .then(function (data) {
      recipes = Array.isArray(data) ? data : (data.recipes || []);
      countEl.textContent = recipes.length + ' ' + plural(recipes.length, 'рецепт', 'рецепта', 'рецептов');
      window.addEventListener('hashchange', route);
      route();
    })
    .catch(function () {
      app.innerHTML = '<p class="state">Не удалось загрузить recipes.json. Откройте сайт по ссылке GitHub Pages, а не как файл с диска.</p>';
    });
})();
