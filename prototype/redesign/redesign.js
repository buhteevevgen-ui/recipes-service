/* Прототип редизайна T-12: темы, два экрана, фильтр карточек и заглушка
   блока «Пересчитать». ES5, без зависимостей. */
(function () {
  'use strict';

  var KEY = 'rs-proto-theme';
  var THEMES = ['crypt', 'ember', 'parchment'];
  var root = document.documentElement;

  function storageGet() {
    try { return window.localStorage.getItem(KEY); } catch (e) { return null; }
  }
  function storageSet(v) {
    try { window.localStorage.setItem(KEY, v); } catch (e) { /* хранилище недоступно — тема действует до перезагрузки */ }
  }

  function setTheme(name, save) {
    if (THEMES.indexOf(name) === -1) name = THEMES[0];
    root.setAttribute('data-theme', name);
    var btns = document.querySelectorAll('[data-theme-set]');
    for (var i = 0; i < btns.length; i++) {
      btns[i].setAttribute('aria-pressed', btns[i].getAttribute('data-theme-set') === name ? 'true' : 'false');
    }
    if (save) storageSet(name);
  }

  setTheme(storageGet(), false);

  document.addEventListener('click', function (ev) {
    var t = ev.target.closest ? ev.target.closest('[data-theme-set]') : null;
    if (t) setTheme(t.getAttribute('data-theme-set'), true);
  });

  /* Экраны по хэшу: #/ — список, #/r/4 и #/r/6 — рецепты, остальные — заглушка */
  var screens = document.querySelectorAll('.screen');
  function route() {
    var h = (location.hash || '#/').replace(/^#\/?/, '');
    var id = '';
    if (h === '') id = 'screen-list';
    else if (h === 'r/4' || h === 'r/6') id = 'screen-' + h.replace('/', '');
    else id = 'screen-stub';
    for (var i = 0; i < screens.length; i++) screens[i].hidden = screens[i].id !== id;
    var cur = document.getElementById(id);
    if (h !== '' || route.started) {
      var head = cur.querySelector('h1');
      if (head) head.focus();
      window.scrollTo(0, 0);
    }
    route.started = true;
  }
  window.addEventListener('hashchange', route);
  route();

  /* Разделы и поиск: только фильтр статичных карточек прототипа */
  var section = '';
  var q = document.getElementById('q');
  var cards = document.querySelectorAll('#cards > li');
  var empty = document.getElementById('empty');
  function norm(s) { return String(s || '').toLowerCase().replace(/ё/g, 'е'); }
  function filter() {
    var term = norm(q.value).trim(), shown = 0;
    for (var i = 0; i < cards.length; i++) {
      var c = cards[i];
      var okSec = !section || (' ' + c.getAttribute('data-sections') + ' ').indexOf(' ' + section + ' ') !== -1;
      var okQ = !term || norm(c.getAttribute('data-title')).indexOf(term) !== -1;
      c.hidden = !(okSec && okQ);
      if (!c.hidden) shown++;
    }
    empty.hidden = shown !== 0;
  }
  var chips = document.querySelectorAll('[data-section]');
  for (var i = 0; i < chips.length; i++) {
    chips[i].addEventListener('click', function () {
      section = this.getAttribute('data-section');
      for (var j = 0; j < chips.length; j++) chips[j].setAttribute('aria-pressed', chips[j] === this ? 'true' : 'false');
      filter();
    });
  }
  q.addEventListener('input', filter);

  /* Заглушка «Пересчитать»: проверка ввода и состояние ошибки, без расчёта */
  function valid(v) {
    if (v === '') return true; /* пустое поле — промежуточное состояние */
    var n = Number(String(v).replace(',', '.'));
    return isFinite(n) && n > 0;
  }
  function check(input) {
    var err = document.getElementById(input.id.replace('rs-in-', 'rs-err-'));
    var ok = valid(input.value.trim());
    err.hidden = ok;
    if (ok) input.removeAttribute('aria-invalid'); else input.setAttribute('aria-invalid', 'true');
  }
  var inputs = document.querySelectorAll('.rescale input');
  for (var k = 0; k < inputs.length; k++) {
    inputs[k].addEventListener('input', function () { check(this); });
  }
  var resets = document.querySelectorAll('.rs-reset');
  for (var m = 0; m < resets.length; m++) {
    resets[m].addEventListener('click', function () {
      var input = document.getElementById(this.getAttribute('data-for'));
      input.value = input.getAttribute('data-base');
      check(input);
    });
  }
})();
