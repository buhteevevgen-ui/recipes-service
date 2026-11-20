/* Тема оформления (T-13): применяется в <head> до отрисовки, без мерцания.
   Сохранённый выбор главнее prefers-color-scheme; без localStorage — без сохранения. */
(function () {
  'use strict';
  var KEY = 'rs-theme';
  var THEMES = ['crypt', 'parchment', 'ember'];
  var COLORS = { crypt: '#4a0709', parchment: '#efe0bb', ember: '#1a0904' };
  var root = document.documentElement;

  function saved() {
    try { return window.localStorage.getItem(KEY); } catch (e) { return null; }
  }
  function save(v) {
    try { window.localStorage.setItem(KEY, v); } catch (e) { /* хранилище недоступно */ }
  }
  function initial() {
    var s = saved();
    if (THEMES.indexOf(s) !== -1) return s;
    var light = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches;
    return light ? 'parchment' : 'crypt';
  }
  function apply(name) {
    root.setAttribute('data-theme', name);
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', COLORS[name]);
    var btns = document.querySelectorAll('[data-theme-set]');
    for (var i = 0; i < btns.length; i++) {
      btns[i].setAttribute('aria-pressed', btns[i].getAttribute('data-theme-set') === name ? 'true' : 'false');
    }
  }

  apply(initial());

  document.addEventListener('DOMContentLoaded', function () {
    apply(root.getAttribute('data-theme'));
    document.addEventListener('click', function (ev) {
      var t = ev.target && ev.target.closest ? ev.target.closest('[data-theme-set]') : null;
      if (!t) return;
      var name = t.getAttribute('data-theme-set');
      if (THEMES.indexOf(name) === -1) return;
      apply(name);
      save(name);
    });
  });
})();
