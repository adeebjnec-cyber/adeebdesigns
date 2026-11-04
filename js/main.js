const $ = (s, el = document) => el.querySelector(s);
const el = (tag, cls, html) => { const n = document.createElement(tag); if (cls) n.className = cls; if (html != null) n.innerHTML = html; return n; };
const img = (slug, n, size = '-sm') => `assets/img/${slug}-${n}${size}.webp`;

// The story always starts at the desk
if (!location.hash) { history.scrollRestoration = 'manual'; scrollTo(0, 0); }

const site = await fetch('content/site.json').then((r) => r.json());
const projects = site.projects;

/* ---------- Render content ---------- */
const captions = $('#captions');
site.story.forEach((s, i) => {
  const c = el('div', 'caption');
  c.innerHTML = `<p class="kicker">${s.kicker}</p>${i === 0 ? '<h1>' : '<h2>'}${s.title}${i === 0 ? '</h1>' : '</h2>'}<p>${s.text}</p>`;
  captions.append(c);
});

const filters = $('#filters');
['All', ...new Set(projects.map((p) => p.category))].forEach((cat, i) => {
  const b = el('button', i ? '' : 'is-active', cat);
  b.onclick = () => {
    filters.querySelectorAll('button').forEach((x) => x.classList.toggle('is-active', x === b));
    document.querySelectorAll('.print').forEach((pr) => pr.classList.toggle('is-hidden', cat !== 'All' && pr.dataset.cat !== cat));
  };
  filters.append(b);
});

const deskEl = $('#desk');
projects.forEach((p, i) => {
  const b = el('button', 'print reveal');
  b.dataset.cat = p.category;
  b.style.setProperty('--r', `${[-2.2, 1.6, -1, 2.4, -1.8, 1.2][i % 6]}deg`);
  b.innerHTML = `<img src="${img(p.slug, 1)}" alt="${p.title}" loading="lazy">
    <span class="print__label"><b>${p.title}</b><span>${String(i + 1).padStart(2, '0')} · ${p.category}</span></span>`;
  b.onclick = () => openCase(p.slug);
  deskEl.append(b);
});

$('#servicesList').append(...site.services.map((s, i) => {
  const d = el('div', 'service reveal');
  d.innerHTML = `<span class="service__num">0${i + 1}</span><h3>${s.title}</h3><p>${s.text}</p><img class="service__img" src="${s.image}" alt="" loading="lazy">`;
  return d;
}));
$('#audiences').append(...site.audiences.map((a) => el('div', 'audience reveal', `<h3>${a.title}</h3><p>${a.text}</p>`)));
$('#processSteps').append(...site.process.map((s) => el('li', 'reveal', `<h3>${s.title}</h3><p>${s.text}</p>`)));
$('#aboutTitle').innerHTML = site.about.title;
$('#aboutText').textContent = site.about.text;

const clocks = $('#clocks');
const clockEls = site.markets.map((m) => {
  const c = el('div', 'clock', `<span>${m.city}</span><b></b>`);
  clocks.append(c);
  return [c.querySelector('b'), new Intl.DateTimeFormat('en-GB', { timeZone: m.tz, hour: '2-digit', minute: '2-digit' })];
});
const tick = () => clockEls.forEach(([b, f]) => (b.textContent = f.format(new Date())));
tick(); setInterval(tick, 20000);

const b = site.brand;
// WhatsApp only appears once a number is set in content/site.json
const handle = (url) => url.replace(/\/+$/, '').split('/').pop();
$('#contactDirect').innerHTML = `
  <a href="mailto:${b.email}">${b.email}</a>
  ${b.whatsapp ? `<a href="https://wa.me/${b.whatsapp.replace(/\D/g, '')}" target="_blank" rel="noopener">WhatsApp</a>` : ''}
  <a href="${b.instagram}" target="_blank" rel="noopener">Instagram · @${handle(b.instagram)}</a>
  <a href="${b.linkedin}" target="_blank" rel="noopener">LinkedIn · ${handle(b.linkedin)}</a>`;
$('#year').textContent = new Date().getFullYear();

/* ---------- Case study viewer ---------- */
const caseEl = $('#case');
let current = null, idx = 1;
function openCase(slug) {
  current = projects.find((p) => p.slug === slug);
  if (!current) return;
  $('#caseMeta').textContent = `${current.category} · ${current.type}`;
  $('#caseTitle').textContent = current.title;
  $('#caseDesc').textContent = current.description;
  const thumbs = $('#caseThumbs');
  thumbs.innerHTML = '';
  for (let n = 1; n <= current.images; n++) {
    const t = el('button', '', `<img src="${img(current.slug, n)}" alt="View ${n}" loading="lazy">`);
    t.onclick = () => show(n);
    thumbs.append(t);
  }
  show(1);
  caseEl.classList.add('is-open');
  caseEl.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
  $('#caseClose').focus();
}
function show(n) {
  idx = ((n - 1 + current.images) % current.images) + 1;
  const im = $('#caseImg');
  im.style.opacity = 0;
  im.onload = () => (im.style.opacity = 1);
  im.src = img(current.slug, idx, '');
  im.alt = `${current.title}, view ${idx}`;
  $('#caseCount').textContent = `${idx} / ${current.images}`;
  $('#caseThumbs').querySelectorAll('button').forEach((t, i) => t.classList.toggle('is-active', i + 1 === idx));
}
function closeCase() {
  caseEl.classList.remove('is-open');
  caseEl.setAttribute('aria-hidden', 'true');
  document.body.style.overflow = '';
}
$('#caseClose').onclick = closeCase;
$('#casePrev').onclick = () => show(idx - 1);
$('#caseNext').onclick = () => show(idx + 1);
addEventListener('keydown', (e) => {
  if (!caseEl.classList.contains('is-open')) return;
  if (e.key === 'Escape') closeCase();
  if (e.key === 'ArrowLeft') show(idx - 1);
  if (e.key === 'ArrowRight') show(idx + 1);
});

/* ---------- 3D scene + gate ---------- */
const gate = $('#gate'), count = $('#gateCount');
let scene = null, ready, introDone = false;
const loaded = new Promise((r) => (ready = () => { count.textContent = 100; r(); }));
const smooth = (a, b, v) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };
const flash = $('#flash'), veil = $('#veil'), veilImg = $('#veil img');
// Driven by the scene's smoothed progress so the white-out lands exactly as the
// camera reaches the window: light floods the screen, then the bedroom appears.
function blind(p) {
  flash.style.opacity = smooth(0.8, 0.87, p) * (1 - smooth(0.885, 1, p));
  veil.style.opacity = smooth(0.87, 0.88, p);
  veilImg.style.transform = `scale(${1.12 - 0.12 * smooth(0.88, 1, p)})`;
}
// Never trap visitors behind a slow or stalled download: the timer starts before
// the 3D library is fetched, and the scene loads without blocking the intro.
setTimeout(ready, 8000);
import('./scene.js')
  .then(({ createScene }) => {
    scene = createScene($('#scene'), {
      prints: projects.map((p) => ({ slug: p.slug, image: img(p.slug, 1) })),
      onLoadProgress: (f) => (count.textContent = Math.max(+count.textContent, Math.round(f * 100))),
      onLoaded: ready,
      onPrintClick: openCase,
      onProgress: blind,
    });
    if (introDone) scene.start();
  })
  .catch((err) => {
    // No WebGL (or CDN blocked): fall back to the still render behind the captions
    console.warn('3D scene unavailable', err);
    veil.style.opacity = 1;
    ready();
  });

/* ---------- Intro: the "A" becomes the lamp over the desk ---------- */
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const mix = (a, b, t) => a + (b - a) * t;
const tween = (ms, fn) => new Promise((done) => {
  const t0 = performance.now();
  const step = (now) => {
    const t = Math.min(1, (now - t0) / ms);
    fn(ease(t));
    t < 1 ? requestAnimationFrame(step) : done();
  };
  requestAnimationFrame(step);
});
const svgSet = (id, attrs) => { const n = document.getElementById(id); for (const k in attrs) n.setAttribute(k, attrs[k]); };
const svgFade = (id, o) => (document.getElementById(id).style.opacity = o);

async function intro() {
  window.__introStarted = true; // tells the safety net in index.html the site is running
  await Promise.all([loaded, wait(2800)]); // logo drawn and textures ready
  gate.classList.add('is-morphing');
  // Legs spread to the shade's slope, the crossbar slides down into the rim
  await tween(1200, (e) => {
    svgSet('gLegL', { x2: mix(16, -10, e) });
    svgSet('gLegR', { x2: mix(104, 130, e) });
    svgSet('gBar', { x1: mix(34, -10, e), x2: mix(86, 130, e), y1: mix(70, 108, e), y2: mix(70, 108, e) });
    svgSet('gBase', { x1: mix(8, -10, e), x2: mix(112, 130, e) });
    svgFade('gFrame', 1 - e);
  });
  // The cord drops from above and the shade fills in
  await tween(700, (e) => {
    svgSet('gCord', { y2: mix(12, -420, e) });
    svgFade('gShade', e);
  });
  // The bulb flickers on, then light falls onto the desk
  for (const o of [0.5, 0.1, 0.7, 0.25, 1]) { svgFade('gGlow', o); await wait(80); }
  await tween(700, (e) => svgFade('gBeam', e));
  // Dissolve into the 3D scene, where the same lamp hangs at the same spot
  // The 3D lamp sits exactly under the SVG one; hold the camera still until the
  // dissolve has finished, then crane up to the desk
  gate.classList.add('is-gone');
  await wait(1400);
  introDone = true;
  if (scene) scene.start();
  else veil.style.opacity = 1; // 3D still downloading: show the still render meanwhile
  await wait(scene ? 3400 : 0);
  document.body.classList.remove('is-locked');
  gate.remove();
}
intro();

/* ---------- Scroll ---------- */
const story = $('.story'), nav = $('#nav'), hint = $('#hint'), tip = $('#deskTip');
const caps = [...captions.children];
const ranges = [[0, 0.17], [0.19, 0.4], [0.43, 0.64], [0.67, 0.8]];

function onScroll() {
  const max = story.offsetHeight - innerHeight;
  const p = Math.min(1, Math.max(0, scrollY / max));
  scene?.setProgress(p);
  scene?.setActive(scrollY < story.offsetHeight + 50);
  caps.forEach((c, i) => c.classList.toggle('is-on', p >= ranges[i][0] && p <= ranges[i][1]));
  hint.style.opacity = p > 0.02 ? 0 : 1;
  tip.classList.toggle('is-on', !!scene && p < 0.06 && !matchMedia('(hover: none)').matches);
  nav.classList.toggle('is-solid', scrollY > story.offsetHeight - 80);
}
addEventListener('scroll', onScroll, { passive: true });
addEventListener('resize', onScroll);
onScroll();

const io = new IntersectionObserver((entries) => entries.forEach((e) => {
  if (e.isIntersecting) { e.target.classList.add('is-in'); io.unobserve(e.target); }
}), { threshold: 0.15 });
document.querySelectorAll('.reveal').forEach((n) => io.observe(n));

/* ---------- Contact form (FormSubmit emails each enquiry to the brand email) ---------- */
const form = $('#form'), status = $('#formStatus');
form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const local = ['localhost', '127.0.0.1', ''].includes(location.hostname);
  if (local) { status.textContent = 'Preview mode: the form will send once the site is live.'; return; }
  const data = Object.fromEntries(new FormData(form));
  if (data._honey) return; // only bots fill the hidden field
  status.textContent = 'Sending…';
  try {
    const res = await fetch(`https://formsubmit.co/ajax/${b.email}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ ...data, _subject: `New project enquiry: ${data.name || 'website'}`, _template: 'table', _captcha: 'false' }),
    });
    const out = await res.json();
    if (!res.ok || String(out.success) !== 'true') throw new Error(out.message || res.status);
    form.reset();
    status.textContent = 'Thank you, your brief has arrived. Expect a reply within 24 hours.';
  } catch {
    status.textContent = `Something went wrong. Please email ${b.email} directly.`;
  }
});
