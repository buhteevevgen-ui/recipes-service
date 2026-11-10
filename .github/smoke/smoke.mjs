// Smoke-проверка сайта рецептов в Chromium (Playwright).
// В репозитории нет package.json: Playwright ставится в PW_DIR на время прогона (см. workflow).
// Переменные: SMOKE_URL, SMOKE_MODE (local|live), SMOKE_COMMIT, SMOKE_ISSUE, SMOKE_REPO, GITHUB_TOKEN, PW_DIR.
import { createRequire } from 'node:module';
import { appendFileSync } from 'node:fs';
import path from 'node:path';

const env = process.env;
const MODE = env.SMOKE_MODE === 'live' ? 'live' : 'local';
const MARKER = '<!-- smoke-report -->';
const VIEWPORTS = [[320, 640], [390, 844], [768, 1024], [1280, 900]];
const FONT_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com'];
// По умолчанию отсутствие h1 на экранах «рецепта нет» даёт предупреждение; SMOKE_STRICT_NOTFOUND_H1=1 делает его дефектом.
const STRICT_NOTFOUND_H1 = env.SMOKE_STRICT_NOTFOUND_H1 === '1';

const require = createRequire(path.join(env.PW_DIR || process.cwd(), 'noop.js'));
const { chromium } = require('playwright');

function normalizeBase(raw) {
  if (!/^https?:\/\//i.test(raw || '')) throw new Error('SMOKE_URL должен начинаться с http:// или https://');
  const u = new URL(raw);
  u.hash = '';
  u.search = '';
  if (u.pathname.endsWith('/index.html')) u.pathname = u.pathname.slice(0, -'index.html'.length);
  if (!u.pathname.endsWith('/')) u.pathname += '/';
  return u.href;
}

const squash = (s) => String(s).replace(/\s+/g, ' ').trim();
const cell = (c) => (c.status === 'PASS' ? 'ПРОШЁЛ' : c.status === 'WARN' ? 'ПРЕДУПР.' : 'ДЕФЕКТ');

async function loadData(base) {
  const res = await fetch(new URL('recipes.json', base), { headers: { 'Cache-Control': 'no-cache' } });
  if (!res.ok) throw new Error('recipes.json: HTTP ' + res.status);
  const data = await res.json();
  const recipes = Array.isArray(data) ? data : data.recipes || [];
  const sections = Array.isArray(data) ? [] : data.sections || [];
  if (!recipes.length) throw new Error('в recipes.json нет рецептов');
  if (!sections.length) throw new Error('в recipes.json нет разделов');
  return { recipes, sections };
}

function buildRoutes(recipes, sections) {
  return [
    { key: 'list', hash: '#/', kind: 'page' },
    { key: 'section', hash: '#/s/' + encodeURIComponent(sections[0].id), kind: 'page' },
    { key: 'recipe', hash: '#/r/' + encodeURIComponent(recipes[0].id), kind: 'page' },
    { key: 'missing', hash: '#/r/nonexistent', kind: 'notfound' },
    { key: 'badhash', hash: '#/r/%E0%A4%A', kind: 'notfound' },
  ];
}

async function openRoute(ctx, base, hash) {
  const page = await ctx.newPage();
  page.setDefaultTimeout(20000);
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const url = m.location().url || '';
    // Запросы Google Fonts при проверке локальной копии ошибкой не считаются
    if (MODE === 'local' && FONT_HOSTS.some((h) => url.includes(h))) return;
    errors.push('console.error: ' + m.text());
  });
  await page.goto(base + hash, { waitUntil: 'load' });
  await page.waitForFunction(() => {
    const a = document.getElementById('app');
    return a && !/Загружаю рецепты/.test(a.textContent);
  });
  await page.waitForTimeout(150);
  const info = await page.evaluate(() => ({
    title: document.title,
    h1: document.querySelectorAll('h1').length,
    levels: [...document.querySelectorAll('h1,h2,h3,h4')].map((e) => Number(e.tagName[1])),
    hscroll: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    sw: document.documentElement.scrollWidth,
    cw: document.documentElement.clientWidth,
    loadError: /Не удалось загрузить recipes\.json/.test(document.body.textContent),
  }));
  return { page, info, errors };
}

function levelsOk(levels) {
  return levels.every((l, i) => l <= (i === 0 ? 1 : levels[i - 1] + 1));
}

async function run() {
  const base = normalizeBase(env.SMOKE_URL);
  const { recipes, sections } = await loadData(base);
  const routes = buildRoutes(recipes, sections);
  const browser = await chromium.launch();
  const out = { base, browser: 'Chromium ' + browser.version(), routes: [], search: [], fonts: [], notes: [], defects: [] };
  try {
    const titles = {};
    for (const r of routes) {
      r.vp = {};
      r.checks = {};
      r.errors = [];
      r.details = [];
    }
    for (const [w, h] of VIEWPORTS) {
      const ctx = await browser.newContext({ viewport: { width: w, height: h } });
      for (const r of routes) {
        const { page, info, errors } = await openRoute(ctx, base, r.hash);
        r.vp[w] = info;
        errors.forEach((e) => r.errors.push(`${w}×${h}: ${e}`));
        await page.close();
      }
      await ctx.close();
    }
    for (const r of routes) {
      const all = Object.values(r.vp);
      const ref = r.vp[390];
      titles[r.key] = ref.title;
      const bad = (cond, msg) => (cond ? { status: 'FAIL', msg } : { status: 'PASS', msg: '' });
      const load = all.some((i) => i.loadError);
      const emptyTitle = all.some((i) => !squash(i.title));
      r.checks.title = bad(load || emptyTitle, load ? 'не удалось загрузить recipes.json' : 'пустой document.title');
      const h1s = [...new Set(all.map((i) => i.h1))];
      if (r.kind === 'page') {
        r.checks.h1 = bad(h1s.some((n) => n !== 1), `h1: ${h1s.join('/')} вместо 1`);
      } else if (h1s.some((n) => n > 1)) {
        r.checks.h1 = { status: 'FAIL', msg: `h1: ${h1s.join('/')}, больше одного` };
      } else if (h1s.includes(0)) {
        r.checks.h1 = STRICT_NOTFOUND_H1
          ? { status: 'FAIL', msg: 'h1 нет' }
          : { status: 'WARN', msg: 'h1 на экране «рецепта нет» отсутствует (не блокирует)' };
      } else r.checks.h1 = { status: 'PASS', msg: '' };
      const badLv = all.find((i) => !levelsOk(i.levels));
      r.checks.levels = bad(!!badLv, badLv ? 'порядок уровней h1–h4: ' + badLv.levels.map((l) => 'h' + l).join(' → ') : '');
      r.checks.console = bad(r.errors.length > 0, r.errors.slice(0, 3).join('; '));
      r.hs = {};
      for (const [w] of VIEWPORTS) {
        const i = r.vp[w];
        r.hs[w] = bad(i.hscroll, `${w}: scrollWidth ${i.sw} > clientWidth ${i.cw}`);
      }
    }
    // Заголовки вкладки различаются между маршрутами
    const pages = routes.filter((r) => r.kind === 'page');
    const nf = routes.filter((r) => r.kind === 'notfound');
    for (const r of pages) {
      const same = routes.filter((o) => o !== r && o.kind === 'page' && titles[o.key] === titles[r.key]);
      if (same.length && r.checks.title.status === 'PASS') r.checks.title = { status: 'FAIL', msg: `title «${titles[r.key]}» совпадает с ${same.map((o) => o.hash).join(', ')}` };
    }
    for (const r of nf) {
      const same = pages.filter((o) => titles[o.key] === titles[r.key]);
      if (same.length && r.checks.title.status === 'PASS') r.checks.title = { status: 'FAIL', msg: `title «${titles[r.key]}» совпадает с ${same.map((o) => o.hash).join(', ')}` };
    }
    if (nf.length === 2 && titles[nf[0].key] === titles[nf[1].key]) {
      out.notes.push(`Экраны «рецепта нет» (${nf[0].hash}, ${nf[1].hash}) имеют одинаковый title «${titles[nf[0].key]}»: это не дефект, оба экрана одного типа.`);
    }

    // Поиск
    const first = recipes[0];
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const { page, errors } = await openRoute(ctx, base, '#/');
    try {
      await page.fill('#q', first.title);
      await page.waitForTimeout(150);
      const found = await page.$$eval('.item h2', (els) => els.map((e) => e.textContent));
      const ok = found.map(squash).includes(squash(first.title));
      out.search.push({ name: `запрос «${first.title}» находит этот рецепт`, status: ok ? 'PASS' : 'FAIL', msg: ok ? '' : `найдено: ${found.length}` });
      await page.fill('#q', '');
      await page.waitForTimeout(150);
      const count = await page.$$eval('.item', (els) => els.length);
      out.search.push({ name: 'пустой запрос возвращает весь список', status: count === recipes.length ? 'PASS' : 'FAIL', msg: count === recipes.length ? '' : `${count} из ${recipes.length}` });
      if (errors.length) out.search.push({ name: 'ошибки на странице поиска', status: 'FAIL', msg: errors.slice(0, 3).join('; ') });
      // Шрифты только для живого сайта
      if (MODE === 'live') {
        const f = await page.evaluate(async () => {
          const res = {};
          for (const [fam, spec] of [['Lora', '600 16px "Lora"'], ['Onest', '400 16px "Onest"']]) {
            try { await document.fonts.load(spec); } catch (e) { /* проверка ниже покажет результат */ }
            res[fam] = {
              check: document.fonts.check(spec),
              loaded: [...document.fonts].filter((x) => x.family.replace(/["']/g, '') === fam && x.status === 'loaded').length,
            };
          }
          return res;
        });
        for (const fam of Object.keys(f)) {
          const ok = f[fam].check && f[fam].loaded > 0;
          out.fonts.push({ name: fam, status: ok ? 'PASS' : 'FAIL', msg: ok ? '' : `check=${f[fam].check}, загружено начертаний: ${f[fam].loaded}` });
        }
      }
    } finally {
      await ctx.close();
    }
    out.routes = routes;
  } finally {
    await browser.close();
  }
  return out;
}

function collectDefects(out) {
  const d = [];
  for (const r of out.routes) {
    for (const [k, c] of Object.entries(r.checks)) if (c.status === 'FAIL') d.push(`${r.hash}: ${k} — ${c.msg}`);
    for (const [w, c] of Object.entries(r.hs)) if (c.status === 'FAIL') d.push(`${r.hash}: горизонтальная прокрутка — ${c.msg}`);
  }
  for (const s of [...out.search, ...out.fonts]) if (s.status === 'FAIL') d.push(`${s.name}${s.msg ? ' — ' + s.msg : ''}`);
  return d;
}

function buildReport(out, fatal) {
  const commit = (env.SMOKE_COMMIT || 'неизвестен').slice(0, 7);
  const lines = [MARKER];
  const defects = fatal ? [fatal] : collectDefects(out);
  lines.push(`## Smoke-проверка: ${defects.length ? 'ДЕФЕКТ' : 'ПРОШЁЛ'}`, '');
  if (!fatal) {
    lines.push('| Маршрут | title | h1 | Заголовки | Консоль | 320×640 | 390×844 | 768×1024 | 1280×900 |', '|---|---|---|---|---|---|---|---|---|');
    for (const r of out.routes) {
      const c = r.checks;
      lines.push(`| \`${r.hash}\` | ${cell(c.title)} | ${cell(c.h1)} | ${cell(c.levels)} | ${cell(c.console)} | ${VIEWPORTS.map(([w]) => cell(r.hs[w])).join(' | ')} |`);
    }
    lines.push('', '**Поиск**', '');
    for (const s of out.search) lines.push(`- ${cell(s)}: ${s.name}${s.msg ? ' (' + s.msg + ')' : ''}`);
    if (out.fonts.length) {
      lines.push('', '**Шрифты (document.fonts)**', '');
      for (const s of out.fonts) lines.push(`- ${cell(s)}: ${s.name}${s.msg ? ' (' + s.msg + ')' : ''}`);
    }
    const warns = [];
    for (const r of out.routes) for (const [k, c] of Object.entries(r.checks)) if (c.status === 'WARN') warns.push(`${r.hash}: ${k} — ${c.msg}`);
    if (warns.length || out.notes.length) {
      lines.push('', '**Замечания (не блокируют)**', '');
      [...warns, ...out.notes].forEach((w) => lines.push('- ' + w));
    }
  }
  if (defects.length) {
    lines.push('', '**Дефекты**', '');
    defects.forEach((x) => lines.push('- ' + x));
  }
  lines.push('', `Версия: коммит \`${commit}\`, ${out.base ? 'URL ' + out.base : 'URL ' + env.SMOKE_URL}, ${out.browser || 'Chromium'}, режим ${MODE === 'live' ? 'живой сайт' : 'локальная копия'}.`);
  return { text: lines.join('\n'), failed: defects.length > 0 };
}

async function api(method, url, body) {
  const res = await fetch((env.GITHUB_API_URL || 'https://api.github.com') + url, {
    method,
    headers: {
      Authorization: 'Bearer ' + env.GITHUB_TOKEN,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'recipes-smoke',
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`GitHub API ${method} ${url}: HTTP ${res.status}`);
  return res.json();
}

// Комментарий обновляется, а не дублируется: ищем свой по маркеру
async function postComment(text) {
  const issue = String(env.SMOKE_ISSUE || '').trim();
  if (!/^\d+$/.test(issue) || !env.GITHUB_TOKEN || !env.SMOKE_REPO) {
    console.log('Комментарий не публикуется: не указан номер PR/issue.');
    return;
  }
  try {
    let existing = null;
    for (let page = 1; page <= 10 && !existing; page++) {
      const list = await api('GET', `/repos/${env.SMOKE_REPO}/issues/${issue}/comments?per_page=100&page=${page}`);
      existing = list.find((c) => c.user && c.user.login === 'github-actions[bot]' && c.body.includes(MARKER));
      if (list.length < 100) break;
    }
    if (existing) await api('PATCH', `/repos/${env.SMOKE_REPO}/issues/comments/${existing.id}`, { body: text });
    else await api('POST', `/repos/${env.SMOKE_REPO}/issues/${issue}/comments`, { body: text });
    console.log('Комментарий ' + (existing ? 'обновлён' : 'создан') + '.');
  } catch (e) {
    // PR из форка: токен только для чтения, комментарий не публикуется
    console.log(`::warning::Комментарий не опубликован: ${e.message}`);
  }
}

let out = {};
let fatal = '';
try {
  out = await run();
} catch (e) {
  fatal = 'сбой прогона: ' + e.message;
}
const report = buildReport(out, fatal);
console.log(report.text);
if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, report.text + '\n');
await postComment(report.text);
process.exitCode = report.failed ? 1 : 0;
