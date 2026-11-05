// Painted night plate behind the canvas. office/assets/lofi-city.webp (and a smaller
// lofi-city-phone.webp) are optional: if either file is missing or broken, the procedural
// skyline and rain stay up. A loaded plate is object-fit cover, drifts slowly, and gets a
// dark edge so the glass panels stay readable.

const DESK = new URL('../assets/lofi-city.webp', import.meta.url).href;
const PHONE = new URL('../assets/lofi-city-phone.webp', import.meta.url).href;
const REDUCED = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

export function mountBackdrop(container, onPhoto) {
  const wrap = document.createElement('div');
  wrap.className = 'lofi-bg';
  wrap.hidden = true;
  wrap.setAttribute('aria-hidden', 'true');

  const pic = document.createElement('picture');
  const source = document.createElement('source');
  source.media = '(max-width: 600px), (max-height: 500px) and (max-width: 950px)';
  source.srcset = PHONE;
  source.type = 'image/webp';
  const img = document.createElement('img');
  img.alt = '';
  img.decoding = 'async';
  img.src = DESK;
  pic.append(source, img);

  const shade = document.createElement('div');
  shade.className = 'lofi-bg-shade';
  shade.hidden = true;
  wrap.append(pic);
  container.prepend(wrap);
  container.append(shade);
  if (!REDUCED) wrap.classList.add('is-drift');

  let live = false;
  const show = () => {
    if (live || !img.naturalWidth) return;
    live = true;
    wrap.hidden = false;
    shade.hidden = false;
    document.documentElement.dataset.lofi = 'photo';
    onPhoto(true);
  };
  const hide = () => {
    if (live) return;
    wrap.remove();
    shade.remove();
    document.documentElement.dataset.lofi = 'procedural';
    onPhoto(false);
  };
  if (img.complete && img.naturalWidth) show();
  else {
    img.addEventListener('load', show, { once: true });
    img.addEventListener('error', hide, { once: true });
  }

  return {
    nudge(x, z) {
      if (!live || REDUCED) return;
      wrap.style.setProperty('--lofi-x', `${(-x * 8).toFixed(1)}px`);
      wrap.style.setProperty('--lofi-z', `${(z * 5).toFixed(1)}px`);
    },
  };
}
