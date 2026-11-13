// The excellence roadmap shown in the conversation, as an MCP App (extension
// io.modelcontextprotocol/ui, SEP-1865, specification 2026-01-26), next to the
// X-Matrix view of lib/matrix-view.js: docs/sprint-roadmap-excellence.md. Two
// tools share one page: show_roadmap (one site against the grid) and
// show_site_comparison (the sites side by side). "Hoshin garantit, l'agent présente":
// the page is drawn from the data an agent reads with get_excellence_roadmap,
// and every figure on it is computed here, in roadmapViewPayload, so the text
// the model gets and the drawing the person sees cannot disagree.
//
// The page loads nothing from anywhere and writes text with textContent only.
// Its side of the protocol is the one of the matrix view, kept as a copy on
// purpose: that page was verified in claude.ai and is not touched here.

export const ROADMAP_VIEW_URI = 'ui://hoshin/roadmap';
const VIEW_MIME = 'text/html;profile=mcp-app';
const PROTOCOL_VERSION = '2026-01-26';

export const ROADMAP_VIEW_RESOURCE = {
  uri: ROADMAP_VIEW_URI,
  name: 'roadmap-view',
  title: 'Excellence roadmap view',
  description: 'A site against the excellence roadmap, or the sites side by side, displayed in the conversation by hosts that support MCP Apps (show_roadmap, show_site_comparison).',
  mimeType: VIEW_MIME,
  _meta: { ui: { prefersBorder: true } },
};

/** Mean of the levels given, to one decimal; null when none is known. Levels are ordinal: it is a reading aid, said as such on the page. */
export function averageLevel(levels) {
  const known = levels.filter((l) => typeof l === 'number');
  return known.length ? Math.round((known.reduce((a, b) => a + b, 0) / known.length) * 10) / 10 : null;
}

/** An initiative that will not raise anything any more (CLOSED_STATUSES of src/lib/roadmap.ts). */
const CLOSED = new Set(['completed', 'cancelled']);
const known = (levels) => levels.filter((l) => typeof l === 'number').length;

const head = (site) => {
  const assessed = known(site.cells.map((c) => c.level));
  return {
    matrixId: site.matrixId,
    name: site.name,
    reference: site.reference ? { basis: site.reference.basis, assessedOn: site.reference.assessedOn, status: site.reference.status } : null,
    average: averageLevel(site.cells.map((c) => c.level)),
    assessed,
    // Out of the items that apply to this site: one marked not applicable is not "left to assess".
    applicable: site.cells.filter((c) => !c.notApplicable).length,
    // A site never assessed is not "0 below target": nothing is known.
    belowTarget: site.reference && assessed > 0 ? site.cells.filter((c) => typeof c.gap === 'number' && c.gap > 0).length : null,
  };
};

/**
 * What the page draws, from the roadmap as GET /api/roadmaps/{id} answers it.
 * mode "site": one site, item by item. mode "comparison": every site, theme by
 * theme, and the items where they differ most.
 */
export function roadmapViewPayload(view, { mode, matrixId } = {}) {
  const levels = view.levels.map((l) => l.name);
  const base = {
    kind: 'roadmap',
    mode,
    // The page has its labels in every language a roadmap can be read in; it falls back to English.
    lang: typeof view.locale === 'string' ? view.locale : 'en',
    roadmap: { id: view.id, name: view.name, locale: view.locale, levels },
    total: view.themes.reduce((n, t) => n + t.items.length, 0),
  };
  const cellsOf = (site) => new Map(site.cells.map((c) => [c.itemId, c]));

  if (mode === 'comparison') {
    const maps = view.sites.map(cellsOf);
    const levelsOf = (item) => maps.map((m) => (typeof m.get(item.id)?.level === 'number' ? m.get(item.id).level : null));
    const sites = view.sites.map(head);
    return {
      ...base,
      sites,
      // Two sites assessed at least: below that there is nothing to compare, which is not "no difference".
      comparable: sites.filter((s) => s.assessed > 0).length >= 2,
      // Each average with the number of items it stands on: one item is not a theme.
      themes: view.themes.map((t) => ({
        name: t.name,
        averages: maps.map((m) => {
          const levelsHere = t.items.map((i) => m.get(i.id)?.level);
          return { value: averageLevel(levelsHere), items: known(levelsHere) };
        }),
      })),
      // The items two sites are furthest apart on: where one plant has something to show the other.
      spreads: view.themes
        .flatMap((t) =>
          t.items.map((i) => {
            const row = levelsOf(i);
            const scored = row.filter((l) => l !== null);
            return { theme: t.name, question: i.question, levels: row, spread: scored.length > 1 ? Math.max(...scored) - Math.min(...scored) : 0 };
          }),
        )
        .filter((s) => s.spread >= 1)
        .sort((a, b) => b.spread - a.spread)
        .slice(0, 6),
    };
  }

  const site = view.sites.find((s) => s.matrixId === matrixId);
  if (!site) return null;
  const cells = cellsOf(site);
  return {
    ...base,
    site: head(site),
    themes: view.themes.map((t) => {
      const items = t.items.map((i) => {
        const c = cells.get(i.id) || {};
        const level = typeof c.level === 'number' ? c.level : null;
        return {
          id: i.id,
          question: i.question,
          level,
          targetLevel: typeof c.targetLevel === 'number' ? c.targetLevel : null,
          notApplicable: Boolean(c.notApplicable),
          gap: typeof c.gap === 'number' ? c.gap : null,
          // Where the site stands, and what the next level asks for.
          levelDescription: level ? i.levelDescriptions[level - 1] || null : null,
          nextDescription: level && level < levels.length ? i.levelDescriptions[level] || null : null,
          initiative: c.linkedElement ? { title: c.linkedElement.title, status: c.linkedElement.status, closed: CLOSED.has(c.linkedElement.status) } : null,
        };
      });
      return { name: t.name, objective: t.objective ?? null, average: averageLevel(items.map((i) => i.level)), items };
    }),
  };
}

export const ROADMAP_VIEW_HTML = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Excellence roadmap</title>
<style>
  :root { --ink:#0f172a; --muted:#64748b; --line:#e2e8f0; --brand:#0f4c5c; --amber:#b45309; --amber-bg:#fef3c7; --bg:#ffffff; --card:#f8fafc; --step:#e2e8f0; }
  :root[data-theme="dark"] { --ink:#e2e8f0; --muted:#94a3b8; --line:#334155; --brand:#7cc4d4; --amber:#fbbf24; --amber-bg:#3b2a08; --bg:#0b1220; --card:#111a2b; --step:#334155; }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 12px; font: 14px/1.45 Helvetica, Arial, sans-serif; color: var(--ink); background: var(--bg); }
  h1 { margin: 0; font-size: 18px; color: var(--brand); }
  h2 { font-size: 13px; text-transform: uppercase; letter-spacing: .04em; color: var(--brand); margin: 18px 0 8px; display: flex; gap: 8px; align-items: baseline; }
  h2 span { color: var(--muted); font-weight: 400; text-transform: none; letter-spacing: 0; }
  .meta { color: var(--muted); font-size: 12px; margin-top: 2px; }
  .note { color: var(--muted); font-size: 12px; margin-top: 10px; }
  .empty { color: var(--muted); }
  .item { border: 1px solid var(--line); border-radius: 8px; padding: 10px; background: var(--card); margin-bottom: 8px; }
  .item.below { border-color: var(--amber); }
  .q { font-weight: 600; }
  .track { display: flex; align-items: center; gap: 4px; margin-top: 8px; }
  .step { width: 28px; height: 10px; border-radius: 3px; background: var(--step); }
  .step.on { background: var(--brand); }
  .step.target { outline: 2px solid var(--amber); outline-offset: 1px; }
  .track b { margin-left: 8px; font-size: 13px; }
  .track i { font-style: normal; color: var(--muted); font-size: 12px; margin-left: 6px; }
  .field { margin-top: 6px; font-size: 13px; }
  .field b { display: block; font-size: 11px; text-transform: uppercase; letter-spacing: .04em; color: var(--muted); font-weight: 600; }
  .warn { display: inline-block; margin-top: 6px; padding: 2px 8px; border-radius: 999px; font-size: 12px; color: var(--amber); background: var(--amber-bg); }
  .wrap { overflow-x: auto; border: 1px solid var(--line); border-radius: 8px; margin-top: 10px; }
  table { border-collapse: collapse; width: 100%; font-size: 13px; }
  th, td { padding: 8px 10px; text-align: left; border-bottom: 1px solid var(--line); vertical-align: top; }
  th { font-size: 12px; color: var(--muted); font-weight: 600; background: var(--card); }
  th small, td small { display: block; font-weight: 400; color: var(--muted); }
  tr:last-child td { border-bottom: 0; }
  tr.total td { font-weight: 600; background: var(--card); }
  .bar { height: 6px; border-radius: 3px; background: var(--step); margin-top: 4px; min-width: 60px; }
  .bar div { height: 6px; border-radius: 3px; background: var(--brand); }
  .chips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }
  .chip { font-size: 12px; padding: 2px 8px; border-radius: 999px; border: 1px solid var(--line); }
</style>
</head>
<body>
<div id="app"><p class="empty">…</p></div>
<script>
(function () {
  // The labels of this page, in the languages a roadmap can be read in (ROADMAP_LOCALES):
  // a plant that reads its grid in Portuguese does not get English headings around it.
  var L = {
    en: {"official":"Official assessment","self":"Self-assessment","draft":"draft","never":"Not assessed yet","below":"{n} item(s) below target","assessed":"{a} items assessed out of {t}","avg":"Average level","target":"target","na":"Not applicable","notAssessed":"Not assessed","here":"Current level","next":"Next level","initiative":"Initiative","noInit":"Below target, no initiative","closed":"Below target, initiative closed","items":"{n} item(s)","theme":"Theme","overall":"Overall","belowRow":"Items below target","coverRow":"Coverage","differ":"Where the sites differ most","same":"No item differs by a level or more.","notComparable":"Fewer than two sites are assessed: nothing to compare yet.","note":"Averages are over the items assessed; a level is a step, the average helps compare, it is not a grade.","nothing":"Nothing to show."},
    fr: {"official":"Évaluation officielle","self":"Auto-évaluation","draft":"brouillon","never":"Pas encore évalué","below":"{n} item(s) sous la cible","assessed":"{a} items évalués sur {t}","avg":"Niveau moyen","target":"cible","na":"Non applicable","notAssessed":"Non évalué","here":"Niveau actuel","next":"Niveau suivant","initiative":"Chantier","noInit":"Sous la cible, sans chantier","closed":"Sous la cible, chantier clos","items":"{n} item(s)","theme":"Thème","overall":"Ensemble","belowRow":"Items sous la cible","coverRow":"Couverture","differ":"Là où les sites diffèrent le plus","same":"Aucun item ne diffère d’un niveau ou plus.","notComparable":"Moins de deux sites sont évalués : rien à comparer pour l’instant.","note":"Les moyennes portent sur les items évalués ; un niveau est un palier, la moyenne sert à comparer, pas à noter.","nothing":"Rien à afficher."},
    es: {"official":"Evaluación oficial","self":"Autoevaluación","draft":"borrador","never":"Aún no evaluado","below":"{n} ítem(s) por debajo del objetivo","assessed":"{a} ítems evaluados de {t}","avg":"Nivel medio","target":"objetivo","na":"No aplicable","notAssessed":"No evaluado","here":"Nivel actual","next":"Nivel siguiente","initiative":"Iniciativa","noInit":"Por debajo del objetivo, sin iniciativa","closed":"Por debajo del objetivo, iniciativa cerrada","items":"{n} ítem(s)","theme":"Tema","overall":"Conjunto","belowRow":"Ítems por debajo del objetivo","coverRow":"Cobertura","differ":"Dónde más difieren los sitios","same":"Ningún ítem difiere en un nivel o más.","notComparable":"Menos de dos sitios están evaluados: todavía no hay nada que comparar.","note":"Las medias se calculan sobre los ítems evaluados; un nivel es un escalón, la media sirve para comparar, no es una nota.","nothing":"Nada que mostrar."},
    pt: {"official":"Avaliação oficial","self":"Autoavaliação","draft":"rascunho","never":"Ainda não avaliado","below":"{n} item(ns) abaixo da meta","assessed":"{a} itens avaliados de {t}","avg":"Nível médio","target":"meta","na":"Não aplicável","notAssessed":"Não avaliado","here":"Nível atual","next":"Próximo nível","initiative":"Iniciativa","noInit":"Abaixo da meta, sem iniciativa","closed":"Abaixo da meta, iniciativa encerrada","items":"{n} item(ns)","theme":"Tema","overall":"Conjunto","belowRow":"Itens abaixo da meta","coverRow":"Cobertura","differ":"Onde os sites mais diferem","same":"Nenhum item difere em um nível ou mais.","notComparable":"Menos de dois sites estão avaliados: ainda não há nada a comparar.","note":"As médias consideram os itens avaliados; um nível é um degrau, a média serve para comparar, não é uma nota.","nothing":"Nada a mostrar."},
    de: {"official":"Offizielle Bewertung","self":"Selbstbewertung","draft":"Entwurf","never":"Noch nicht bewertet","below":"{n} Punkt(e) unter dem Ziel","assessed":"{a} von {t} Punkten bewertet","avg":"Durchschnittliche Stufe","target":"Ziel","na":"Nicht anwendbar","notAssessed":"Nicht bewertet","here":"Aktuelle Stufe","next":"Nächste Stufe","initiative":"Maßnahme","noInit":"Unter dem Ziel, keine Maßnahme","closed":"Unter dem Ziel, Maßnahme abgeschlossen","items":"{n} Punkt(e)","theme":"Thema","overall":"Gesamt","belowRow":"Punkte unter dem Ziel","coverRow":"Abdeckung","differ":"Wo sich die Standorte am stärksten unterscheiden","same":"Kein Punkt weicht um eine Stufe oder mehr ab.","notComparable":"Weniger als zwei Standorte sind bewertet: noch nichts zu vergleichen.","note":"Die Durchschnitte beziehen sich auf die bewerteten Punkte; eine Stufe ist ein Schritt, der Durchschnitt dient dem Vergleich und ist keine Note.","nothing":"Nichts anzuzeigen."},
    it: {"official":"Valutazione ufficiale","self":"Autovalutazione","draft":"bozza","never":"Non ancora valutato","below":"{n} voce/i sotto l’obiettivo","assessed":"{a} voci valutate su {t}","avg":"Livello medio","target":"obiettivo","na":"Non applicabile","notAssessed":"Non valutato","here":"Livello attuale","next":"Livello successivo","initiative":"Iniziativa","noInit":"Sotto l’obiettivo, nessuna iniziativa","closed":"Sotto l’obiettivo, iniziativa chiusa","items":"{n} voce/i","theme":"Tema","overall":"Complessivo","belowRow":"Voci sotto l’obiettivo","coverRow":"Copertura","differ":"Dove i siti differiscono di più","same":"Nessuna voce differisce di un livello o più.","notComparable":"Meno di due siti sono valutati: ancora nulla da confrontare.","note":"Le medie riguardano le voci valutate; un livello è un gradino, la media serve a confrontare, non è un voto.","nothing":"Niente da mostrare."},
    nl: {"official":"Officiële beoordeling","self":"Zelfbeoordeling","draft":"concept","never":"Nog niet beoordeeld","below":"{n} item(s) onder het doel","assessed":"{a} van {t} items beoordeeld","avg":"Gemiddeld niveau","target":"doel","na":"Niet van toepassing","notAssessed":"Niet beoordeeld","here":"Huidig niveau","next":"Volgend niveau","initiative":"Initiatief","noInit":"Onder het doel, geen initiatief","closed":"Onder het doel, initiatief afgesloten","items":"{n} item(s)","theme":"Thema","overall":"Totaal","belowRow":"Items onder het doel","coverRow":"Dekking","differ":"Waar de locaties het meest verschillen","same":"Geen item verschilt een niveau of meer.","notComparable":"Minder dan twee locaties zijn beoordeeld: nog niets te vergelijken.","note":"Gemiddelden gaan over de beoordeelde items; een niveau is een trede, het gemiddelde helpt vergelijken en is geen cijfer.","nothing":"Niets te tonen."},
    pl: {"official":"Ocena oficjalna","self":"Samoocena","draft":"wersja robocza","never":"Jeszcze nie oceniono","below":"Pozycje poniżej celu: {n}","assessed":"Oceniono {a} z {t} pozycji","avg":"Średni poziom","target":"cel","na":"Nie dotyczy","notAssessed":"Nie oceniono","here":"Obecny poziom","next":"Następny poziom","initiative":"Inicjatywa","noInit":"Poniżej celu, brak inicjatywy","closed":"Poniżej celu, inicjatywa zamknięta","items":"Pozycje: {n}","theme":"Temat","overall":"Ogółem","belowRow":"Pozycje poniżej celu","coverRow":"Pokrycie","differ":"Gdzie zakłady różnią się najbardziej","same":"Żadna pozycja nie różni się o poziom lub więcej.","notComparable":"Oceniono mniej niż dwa zakłady: nie ma jeszcze czego porównywać.","note":"Średnie dotyczą ocenionych pozycji; poziom to stopień, średnia służy do porównania, nie jest oceną.","nothing":"Brak danych do wyświetlenia."},
    cs: {"official":"Oficiální hodnocení","self":"Sebehodnocení","draft":"koncept","never":"Zatím nehodnoceno","below":"Položky pod cílem: {n}","assessed":"Hodnoceno {a} z {t} položek","avg":"Průměrná úroveň","target":"cíl","na":"Nevztahuje se","notAssessed":"Nehodnoceno","here":"Současná úroveň","next":"Další úroveň","initiative":"Iniciativa","noInit":"Pod cílem, bez iniciativy","closed":"Pod cílem, iniciativa uzavřena","items":"Položky: {n}","theme":"Téma","overall":"Celkem","belowRow":"Položky pod cílem","coverRow":"Pokrytí","differ":"Kde se závody liší nejvíce","same":"Žádná položka se neliší o úroveň nebo více.","notComparable":"Hodnoceny jsou méně než dva závody: zatím není co porovnávat.","note":"Průměry se počítají z hodnocených položek; úroveň je stupeň, průměr slouží k porovnání, není to známka.","nothing":"Není co zobrazit."},
    ro: {"official":"Evaluare oficială","self":"Autoevaluare","draft":"ciornă","never":"Neevaluat încă","below":"Elemente sub țintă: {n}","assessed":"{a} elemente evaluate din {t}","avg":"Nivel mediu","target":"țintă","na":"Nu se aplică","notAssessed":"Neevaluat","here":"Nivel actual","next":"Nivelul următor","initiative":"Inițiativă","noInit":"Sub țintă, fără inițiativă","closed":"Sub țintă, inițiativă închisă","items":"Elemente: {n}","theme":"Temă","overall":"Ansamblu","belowRow":"Elemente sub țintă","coverRow":"Acoperire","differ":"Unde diferă cel mai mult site-urile","same":"Niciun element nu diferă cu un nivel sau mai mult.","notComparable":"Mai puțin de două site-uri sunt evaluate: încă nu este nimic de comparat.","note":"Mediile privesc elementele evaluate; un nivel este o treaptă, media ajută la comparare, nu este o notă.","nothing":"Nimic de afișat."},
    tr: {"official":"Resmî değerlendirme","self":"Öz değerlendirme","draft":"taslak","never":"Henüz değerlendirilmedi","below":"Hedefin altında {n} madde","assessed":"{t} maddeden {a} tanesi değerlendirildi","avg":"Ortalama seviye","target":"hedef","na":"Uygulanamaz","notAssessed":"Değerlendirilmedi","here":"Mevcut seviye","next":"Sonraki seviye","initiative":"Girişim","noInit":"Hedefin altında, girişim yok","closed":"Hedefin altında, girişim kapatıldı","items":"{n} madde","theme":"Tema","overall":"Genel","belowRow":"Hedefin altındaki maddeler","coverRow":"Kapsam","differ":"Tesislerin en çok ayrıştığı yerler","same":"Hiçbir madde bir seviye veya daha fazla farklılaşmıyor.","notComparable":"İkiden az tesis değerlendirildi: henüz karşılaştırılacak bir şey yok.","note":"Ortalamalar değerlendirilen maddeler üzerindendir; seviye bir basamaktır, ortalama karşılaştırmaya yarar, not değildir.","nothing":"Gösterilecek bir şey yok."},
    zh: {"official":"正式评估","self":"自评","draft":"草稿","never":"尚未评估","below":"{n} 项低于目标","assessed":"已评估 {a} 项，共 {t} 项","avg":"平均等级","target":"目标","na":"不适用","notAssessed":"未评估","here":"当前等级","next":"下一等级","initiative":"举措","noInit":"低于目标，无举措","closed":"低于目标，举措已关闭","items":"{n} 项","theme":"主题","overall":"总体","belowRow":"低于目标的项目","coverRow":"覆盖范围","differ":"各工厂差异最大的项目","same":"没有项目相差一个等级或以上。","notComparable":"已评估的工厂不足两个：暂无可比较的内容。","note":"平均值基于已评估的项目；等级是一个台阶，平均值用于比较，而不是评分。","nothing":"没有可显示的内容。"},
    ja: {"official":"公式評価","self":"自己評価","draft":"下書き","never":"未評価","below":"目標未達 {n} 項目","assessed":"{t} 項目中 {a} 項目を評価","avg":"平均レベル","target":"目標","na":"該当なし","notAssessed":"未評価","here":"現在のレベル","next":"次のレベル","initiative":"施策","noInit":"目標未達・施策なし","closed":"目標未達・施策は終了","items":"{n} 項目","theme":"テーマ","overall":"全体","belowRow":"目標未達の項目","coverRow":"評価範囲","differ":"拠点間の差が最も大きい項目","same":"1 レベル以上の差がある項目はありません。","notComparable":"評価済みの拠点が 2 つ未満のため、まだ比較できません。","note":"平均は評価済みの項目が対象です。レベルは段階であり、平均は比較のためのもので、成績ではありません。","nothing":"表示する内容がありません。"}
  };
  var nextId = 1, pending = {};
  function send(msg) { window.parent.postMessage(msg, '*'); }
  function request(method, params) {
    var id = nextId++;
    send({ jsonrpc: '2.0', id: id, method: method, params: params || {} });
    return new Promise(function (resolve, reject) { pending[id] = { resolve: resolve, reject: reject }; });
  }
  function notify(method, params) { send({ jsonrpc: '2.0', method: method, params: params || {} }); }
  function el(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = String(text); return n; }
  function theme(ctx) { if (ctx && (ctx.theme === 'dark' || ctx.theme === 'light')) document.documentElement.setAttribute('data-theme', ctx.theme); }
  function num(v) { return typeof v === 'number' ? String(v) : '–'; }
  // Word order differs by language: the numbers go where the label says.
  function fill(label, values) { return String(label).replace(/\\{(\\w)\\}/g, function (m, k) { return values[k] != null ? String(values[k]) : m; }); }

  function failure(result) {
    var root = document.getElementById('app');
    root.textContent = '';
    var text = result && result.content && result.content[0] && result.content[0].text;
    var message = '';
    try { message = JSON.parse(text).error || text; } catch (e) { message = text || ''; }
    root.appendChild(el('p', 'empty', message || 'Hoshin Kanri: nothing to show.'));
    resized();
  }

  function reference(t, site) {
    var r = site.reference;
    if (!r) return t.never;
    return (r.basis === 'official' ? t.official : t.self) + ', ' + r.assessedOn + (r.status === 'draft' ? ' (' + t.draft + ')' : '');
  }

  function renderSite(root, data, t) {
    var count = data.roadmap.levels.length;
    var s = data.site;
    root.appendChild(el('h1', null, data.roadmap.name + ' — ' + s.name));
    var meta = [reference(t, s), fill(t.assessed, { a: s.assessed, t: s.applicable })];
    if (typeof s.average === 'number') meta.push(t.avg + ' ' + s.average + ' / ' + count);
    if (typeof s.belowTarget === 'number' && s.belowTarget > 0) meta.push(fill(t.below, { n: s.belowTarget }));
    root.appendChild(el('div', 'meta', meta.join(' · ')));
    (data.themes || []).forEach(function (th) {
      var h = el('h2', null, th.name);
      if (typeof th.average === 'number') h.appendChild(el('span', null, th.average + ' / ' + count));
      root.appendChild(h);
      (th.items || []).forEach(function (it) {
        var below = typeof it.gap === 'number' && it.gap > 0;
        var card = el('div', below ? 'item below' : 'item');
        card.appendChild(el('div', 'q', it.question));
        var track = el('div', 'track');
        for (var k = 1; k <= count; k++) {
          var cls = 'step' + (it.level != null && k <= it.level ? ' on' : '') + (it.targetLevel === k ? ' target' : '');
          track.appendChild(el('span', cls));
        }
        if (it.notApplicable) track.appendChild(el('b', null, t.na));
        else if (it.level == null) track.appendChild(el('b', null, t.notAssessed));
        else track.appendChild(el('b', null, it.level + ' / ' + count + ' · ' + (data.roadmap.levels[it.level - 1] || '')));
        if (it.targetLevel != null) track.appendChild(el('i', null, t.target + ' ' + it.targetLevel));
        card.appendChild(track);
        if (it.levelDescription) { var f = el('div', 'field'); f.appendChild(el('b', null, t.here)); f.appendChild(el('span', null, it.levelDescription)); card.appendChild(f); }
        if (below && it.nextDescription) { var g = el('div', 'field'); g.appendChild(el('b', null, t.next)); g.appendChild(el('span', null, it.nextDescription)); card.appendChild(g); }
        if (it.initiative) { var i = el('div', 'field'); i.appendChild(el('b', null, t.initiative)); i.appendChild(el('span', null, it.initiative.title)); card.appendChild(i); }
        if (below && !it.initiative) card.appendChild(el('span', 'warn', t.noInit));
        if (below && it.initiative && it.initiative.closed) card.appendChild(el('span', 'warn', t.closed));
        root.appendChild(card);
      });
    });
  }

  // An average, the number of items it stands on, and a bar. Nobody is marked as ahead:
  // the sites are not judged on the same kind of assessment nor on the same items.
  function cell(value, items, count, t) {
    var td = el('td');
    td.appendChild(el('span', null, typeof value === 'number' ? value + ' / ' + count : '–'));
    if (typeof value === 'number') {
      td.appendChild(el('small', null, fill(t.items, { n: items })));
      var bar = el('div', 'bar'); var inner = el('div');
      inner.style.width = Math.max(0, Math.min(100, Math.round((value / count) * 100))) + '%';
      bar.appendChild(inner); td.appendChild(bar);
    }
    return td;
  }

  function renderComparison(root, data, t) {
    var count = data.roadmap.levels.length;
    var sites = data.sites || [];
    root.appendChild(el('h1', null, data.roadmap.name));
    var table = el('table'); var thead = el('thead'); var hr = el('tr');
    hr.appendChild(el('th', null, t.theme));
    // What each site is judged on sits under its name: a draft is not read as an official assessment.
    sites.forEach(function (s) { var th = el('th', null, s.name); th.appendChild(el('small', null, reference(t, s))); hr.appendChild(th); });
    thead.appendChild(hr); table.appendChild(thead);
    var body = el('tbody');
    (data.themes || []).forEach(function (th) {
      var tr = el('tr'); tr.appendChild(el('td', null, th.name));
      (th.averages || []).forEach(function (a) { tr.appendChild(cell(a.value, a.items, count, t)); });
      body.appendChild(tr);
    });
    var total = el('tr', 'total'); total.appendChild(el('td', null, t.overall));
    sites.forEach(function (s) { total.appendChild(cell(s.average, s.assessed, count, t)); });
    body.appendChild(total);
    var below = el('tr'); below.appendChild(el('td', null, t.belowRow));
    sites.forEach(function (s) { below.appendChild(el('td', null, num(s.belowTarget))); });
    body.appendChild(below);
    var last = el('tr'); last.appendChild(el('td', null, t.coverRow));
    sites.forEach(function (s) { last.appendChild(el('td', null, fill(t.assessed, { a: s.assessed, t: s.applicable }))); });
    body.appendChild(last);
    table.appendChild(body);
    var wrap = el('div', 'wrap'); wrap.appendChild(table); root.appendChild(wrap);

    var h = el('h2', null, t.differ); root.appendChild(h);
    var spreads = data.spreads || [];
    if (!spreads.length) root.appendChild(el('p', 'empty', data.comparable ? t.same : t.notComparable));
    spreads.forEach(function (sp) {
      var card = el('div', 'item');
      card.appendChild(el('div', 'q', sp.question));
      card.appendChild(el('div', 'meta', sp.theme));
      var chips = el('div', 'chips');
      sites.forEach(function (s, i) { chips.appendChild(el('span', 'chip', s.name + ' ' + num(sp.levels[i]))); });
      card.appendChild(chips);
      root.appendChild(card);
    });
    root.appendChild(el('p', 'note', t.note));
  }

  function render(data) {
    if (!data || data.kind !== 'roadmap' || !data.roadmap) return;
    var t = L[data.lang] || L.en;
    var root = document.getElementById('app');
    root.textContent = '';
    if (data.mode === 'comparison') renderComparison(root, data, t);
    else if (data.site) renderSite(root, data, t);
    else root.appendChild(el('p', 'empty', t.nothing));
    resized();
  }

  // Sizes go to the host only once connected (after ui/initialize), measured on the
  // content rather than the viewport, so the view can shrink as well as grow.
  var lastH = 0, connected = false;
  function resized() {
    if (!connected) return;
    var rect = document.body.getBoundingClientRect ? document.body.getBoundingClientRect() : { height: document.documentElement.scrollHeight, width: document.documentElement.scrollWidth };
    var h = Math.ceil(rect.height + 24);
    if (h !== lastH) { lastH = h; notify('ui/notifications/size-changed', { width: Math.ceil(rect.width + 24), height: h }); }
  }

  window.addEventListener('message', function (event) {
    if (event.source !== window.parent) return;
    var msg = event.data;
    if (!msg || msg.jsonrpc !== '2.0') return;
    if (msg.id != null && !msg.method && pending[msg.id]) {
      var p = pending[msg.id]; delete pending[msg.id];
      if (msg.error) p.reject(msg.error); else p.resolve(msg.result);
      return;
    }
    if (msg.method === 'ui/notifications/tool-result') {
      var r = msg.params || {};
      if (r.isError || !r.structuredContent) failure(r); else render(r.structuredContent);
      return;
    }
    if (msg.method === 'ui/notifications/host-context-changed') { theme(msg.params); return; }
    if (msg.id != null && msg.method) {
      // ui/resource-teardown, ping: nothing to keep; anything else is not ours.
      var known = msg.method === 'ui/resource-teardown' || msg.method === 'ping';
      send(known ? { jsonrpc: '2.0', id: msg.id, result: {} } : { jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'Method not found' } });
    }
  });

  request('ui/initialize', { appInfo: { name: 'Hoshin Kanri', version: '1' }, appCapabilities: {}, protocolVersion: '${PROTOCOL_VERSION}' })
    .then(function (res) { theme(res && res.hostContext); }, function () {})
    .then(function () {
      notify('ui/notifications/initialized');
      connected = true;
      resized();
      if (window.ResizeObserver) new ResizeObserver(resized).observe(document.body);
    });
})();
</script>
</body>
</html>
`;
