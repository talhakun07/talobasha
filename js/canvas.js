// ══ nomad · the canvas of work ══════════════════════════════════════════
// An endless plane of films you drag through. Everything — films, the two
// text cards, the cursor grid — is composited into one 2D canvas, because
// the grid effect has to sample the frame underneath it. Two passes:
//
//   pass 1  draw the tiled plane into an offscreen buffer
//   pass 2  blit that buffer, then re-draw the cells around the cursor from
//           a shrinking source rect, so the pointer magnifies what it is over
//
// Cell size is ~3× a cursor (54 CSS px). Adapted from creativeocean's
// "Canvas Grid Mouse Effect" (CodePen emBOove); GSAP's quickTo is replaced
// with a plain critically-damped lerp so the site carries no CDN.

import { WORKS, CARDS } from './data.js';
import { Trackers } from './track.js';

const clamp = (v, a, b) => v < a ? a : v > b ? b : v;

/* ── touch ──────────────────────────────────────────────────────────────
   A finger leaves no cursor behind it, so on a coarse pointer the lens has
   nothing to follow. Instead of the cursor grid plus the soft edge, a touch
   device gets ONE treatment on the periphery: the grid magnification itself,
   absent at the centre of the frame and fading in toward the corners. It
   replaces `softenEdges` rather than joining it — a frame gets one edge
   treatment, not two. Flip EDGE_GRID to true unconditionally to put the same
   viewfinder edge on the desktop build. */
const COARSE     = matchMedia('(pointer: coarse)').matches;
const EDGE_GRID  = COARSE;
const MAX_DECODE = COARSE ? 3 : 99;   // concurrent hardware decoders to ask for
const TAP        = COARSE ? 12 : 8;   // a finger wanders; a mouse does not

/* ── the repeating block ────────────────────────────────────────────────
   Four columns, three rows, two slots deliberately left empty so the plane
   breathes. Per-column vertical offsets break the rows without breaking the
   tiling — a constant offset per column repeats cleanly. */
const COLS = 7, ROWS = 6;
const COL_GAP = 0.34, ROW_GAP = 0.42;
const TILE_AR = 9 / 16;
const COL_OFF = [0, 0.28, 0.12, 0.42, 0.08, 0.35, 0.18];

function generateSlots(){
  const slots = [];
  const emptyPositions = new Set(['1,1', '3,2', '5,0', '0,4', '4,4', '2,5', '6,3']);
  const cardPositions = { '2,1': 0, '4,3': 1 };
  let workIdx = 0;
  for (let r = 0; r < ROWS; r++){
    for (let c = 0; c < COLS; c++){
      const key = `${c},${r}`;
      if (emptyPositions.has(key)) continue;
      if (cardPositions[key] !== undefined && cardPositions[key] < CARDS.length){
        slots.push({ c, r, kind: 'card', i: cardPositions[key] });
      } else if (workIdx < WORKS.length){
        slots.push({ c, r, kind: 'work', i: workIdx++ });
      }
    }
  }
  while (workIdx < WORKS.length){
    const r = Math.floor(workIdx / COLS) % ROWS;
    const c = workIdx % COLS;
    slots.push({ c, r, kind: 'work', i: workIdx++ });
  }
  return slots;
}
const SLOTS = generateSlots();

/* Edge softness. Real glass is sharp on axis and falls off toward the corner
   of the image circle; this is that, not a decorative blur. Done at a third
   of the resolution — the upscale is itself a blur, so a small radius down
   there buys a large, smooth one up here for a fraction of the cost. */
const BLUR_SCALE = 0.34;
const BLUR_PX    = 3.3;   // radius in the small buffer
const BLUR_START = 0.50;  // fraction of the image circle that stays sharp

/* The peripheral grid. Same lattice and the same dot as the cursor lens, but
   the strength is radial from the centre of the frame rather than from the
   pointer, and the magnification is capped — an uncapped corner blows a
   single pixel up to a whole cell. */
const EDGE_START = 0.50;  // exactly BLUR_START: it lands where the blur did
const EDGE_FALL  = 1.90;  // stays at nothing for longer, then arrives quickly
const EDGE_MAX   = 0.42;  // hardest magnification at the corner (≈ 1.7×)
const EDGE_DOT   = 0.30;  // the dot is a permanent resident here, not a cursor

const GRID_BOX   = 54;    // ≈ 3 × a cursor
const GRID_R     = 285;   // reach of the effect, CSS px
const GRID_FALL  = 1.5;   // steeper than linear: a tight core, a soft edge
const DOT_ALPHA  = 0.62;

export class WorkCanvas {
  constructor(canvas, opts = {}){
    this.cv = canvas;
    this.ctx = canvas.getContext('2d');
    this.buf = document.createElement('canvas');
    this.bctx = this.buf.getContext('2d');
    this.onRoute = opts.onRoute || (() => {});
    this.onFirstDrag = opts.onFirstDrag || (() => {});
    this.reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.coarse = COARSE;
    this.edgeGrid = EDGE_GRID;

    this.x = 0; this.y = 0;          // rendered offset
    this.tx = 0; this.ty = 0;        // target offset
    this.vx = 0; this.vy = 0;
    this.drag = null;
    this.dragged = false;
    this.hotCard = null;

    this.mx = -9999; this.my = -9999;   // smoothed cursor
    this.px = -9999; this.py = -9999;   // raw cursor
    this.spread = 1;

    this.media = WORKS.map(w => {
      const isVideo = w.type === 'video' || /\.(mp4|webm|mov)$/i.test(w.src);
      if (isVideo){
        const v = document.createElement('video');
        v.src = COARSE ? w.src.replace('/tiles/', '/tiles-sm/') : w.src;
        v.muted = true; v.loop = true; v.playsInline = true;
        v.preload = 'auto'; v.setAttribute('playsinline','');
        v.addEventListener('loadeddata', () => { this.ready = true; });
        return { kind: 'video', el: v, loaded: false };
      } else {
        const img = new Image();
        img.decoding = 'async';
        img.onload = () => { this.ready = true; };
        img.src = w.src;
        return { kind: 'image', el: img, loaded: true };
      }
    });
    this.playing = new Array(this.media.length).fill(false);

    this.trackers = new Trackers();
    this.blurCv = document.createElement('canvas');
    this.bl = this.blurCv.getContext('2d');
    this.maskCv = document.createElement('canvas');
    this.running = false;
    this._bind();
    this.resize();
  }

  /* ── geometry ─────────────────────────────────────────────────────── */
  resize(){
    const w = window.innerWidth, h = window.innerHeight;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    // two full-frame passes every frame: past roughly 3.2 Mpx a phone drops
    // frames faster than the extra resolution buys anything back
    if (COARSE) while (this.dpr > 1 && w * h * this.dpr * this.dpr > 3.2e6) this.dpr -= 0.25;
    for (const c of [this.cv, this.buf]){
      c.width = Math.round(w * this.dpr);
      c.height = Math.round(h * this.dpr);
    }
    this.cv.style.width = w + 'px'; this.cv.style.height = h + 'px';
    this.w = w; this.h = h;

    // a narrow viewport wants a bigger share of its width per tile and
    // tighter gutters, or you get one lonely column in a field of paper
    const narrow = w < 640;
    this.tileW = narrow ? clamp(w * 0.66, 180, 320) : clamp(w * 0.30, 230, 460);
    this.tileH = this.tileW * TILE_AR;
    const cg = narrow ? 0.24 : COL_GAP, rg = narrow ? 0.30 : ROW_GAP;
    this.colPitch = this.tileW * (1 + cg);
    this.rowPitch = this.tileH + this.tileW * rg;
    this.blockW = COLS * this.colPitch;
    this.blockH = ROWS * this.rowPitch;
    this.trackers.resize(w, h);

    // the soft-edge buffer and its falloff mask — not allocated at all when
    // the periphery is carrying the grid instead
    if (this.edgeGrid){ this.blurCv.width = this.blurCv.height = 1; return; }
    const bw = Math.max(2, Math.round(w * BLUR_SCALE));
    const bh = Math.max(2, Math.round(h * BLUR_SCALE));
    this.blurCv.width = this.maskCv.width = bw;
    this.blurCv.height = this.maskCv.height = bh;
    const m = this.maskCv.getContext('2d');
    const half = Math.hypot(bw, bh) / 2;          // the image circle
    const g = m.createRadialGradient(bw / 2, bh / 2, half * BLUR_START, bw / 2, bh / 2, half);
    g.addColorStop(0.00, 'rgba(0,0,0,0)');
    g.addColorStop(0.45, 'rgba(0,0,0,0.30)');
    g.addColorStop(0.78, 'rgba(0,0,0,0.74)');
    g.addColorStop(1.00, 'rgba(0,0,0,1)');
    m.clearRect(0, 0, bw, bh);
    m.fillStyle = g; m.fillRect(0, 0, bw, bh);
  }

  /* ── input ────────────────────────────────────────────────────────── */
  _bind(){
    const cv = this.cv;
    cv.addEventListener('pointerdown', e => {
      cv.setPointerCapture(e.pointerId);
      this.drag = { x:e.clientX, y:e.clientY, ox:this.tx, oy:this.ty, moved:0, t:performance.now() };
      cv.classList.add('is-drag');
    });
    cv.addEventListener('pointermove', e => {
      this.px = e.clientX; this.py = e.clientY;
      if (this.drag){
        const dx = e.clientX - this.drag.x, dy = e.clientY - this.drag.y;
        this.drag.moved = Math.max(this.drag.moved, Math.hypot(dx, dy));
        this.tx = this.drag.ox + dx;
        this.ty = this.drag.oy + dy;
        if (this.drag.moved > TAP && !this.dragged){ this.dragged = true; this.onFirstDrag(); }
      } else {
        this._hover(e.clientX, e.clientY);
      }
    });
    const end = (e) => {
      if (!this.drag) return;
      const d = this.drag; this.drag = null;
      cv.classList.remove('is-drag');
      // flick
      const dt = Math.max(16, performance.now() - d.t);
      if (d.moved > TAP){
        this.tx += this.vx * 90 / dt * 4;
        this.ty += this.vy * 90 / dt * 4;
      } else {
        const card = this._cardAt(e.clientX, e.clientY);
        if (card) this.onRoute(card.route);
      }
    };
    cv.addEventListener('pointerup', e => {
      end(e);
      // a finger leaves no cursor behind it, so the lens must be put away
      if (e.pointerType === 'touch'){ this.px = this.py = -9999; this.mx = this.my = -9999; }
    });
    cv.addEventListener('pointercancel', () => { this.drag = null; cv.classList.remove('is-drag'); });
    cv.addEventListener('wheel', e => {
      e.preventDefault();
      this.tx -= e.deltaX; this.ty -= e.deltaY;
      if (!this.dragged){ this.dragged = true; this.onFirstDrag(); }
    }, { passive:false });
    cv.addEventListener('pointerleave', () => { this.px = this.py = -9999; });

    // keyboard: the plane must be reachable without a pointer
    window.addEventListener('keydown', e => {
      if (!this.running) return;
      const step = this.tileW * 0.6;
      if (e.key === 'ArrowLeft')  { this.tx += step; e.preventDefault(); }
      if (e.key === 'ArrowRight') { this.tx -= step; e.preventDefault(); }
      if (e.key === 'ArrowUp')    { this.ty += step; e.preventDefault(); }
      if (e.key === 'ArrowDown')  { this.ty -= step; e.preventDefault(); }
    });
  }

  _hover(x, y){
    const card = this._cardAt(x, y);
    const hot = !!card;
    if (hot !== this._hot){ this._hot = hot; this.cv.classList.toggle('is-hot', hot); }
  }

  _cardAt(x, y){
    // a fingertip is about 9 mm across; the type is not
    const p = this.coarse ? 16 : 0;
    for (const r of (this._cardRects || [])){
      if (x >= r.x - p && x <= r.x + r.w + p && y >= r.y - p && y <= r.y + r.h + p) return r;
    }
    return null;
  }

  /* ── run ──────────────────────────────────────────────────────────── */
  start(){
    if (this.running) return;
    this.running = true;
    this._last = performance.now();
    const loop = (now) => {
      if (!this.running) return;
      this._raf = requestAnimationFrame(loop);
      this.frame(now);
    };
    this._raf = requestAnimationFrame(loop);
    document.addEventListener('visibilitychange', this._vis = () => {
      if (document.hidden){
        this.media.forEach(m => { if (m.kind === 'video') m.el.pause(); });
      } else {
        this.playing.forEach((p, i) => {
          if (p && this.media[i]?.kind === 'video') this.media[i].el.play().catch(()=>{});
        });
      }
    });
  }
  stop(){
    this.running = false;
    cancelAnimationFrame(this._raf);
    this.media.forEach(m => { if (m.kind === 'video') m.el.pause(); });
    this.playing.fill(false);
    if (this._vis) document.removeEventListener('visibilitychange', this._vis);
  }

  frame(now){
    const dt = Math.min(64, now - this._last); this._last = now;
    const k = 1 - Math.pow(0.0009, dt / 1000);       // frame-rate independent
    const nx = this.x + (this.tx - this.x) * k;
    const ny = this.y + (this.ty - this.y) * k;
    this.vx = nx - this.x; this.vy = ny - this.y;
    this.x = nx; this.y = ny;

    // cursor: same easing family, a touch looser
    const ck = 1 - Math.pow(0.002, dt / 1000);
    if (this.px > -9998){
      if (this.mx < -9998){ this.mx = this.px; this.my = this.py; }
      this.mx += (this.px - this.mx) * ck;
      this.my += (this.py - this.my) * ck;
    }
    const chase = Math.hypot(this.px - this.mx, this.py - this.my);
    this.spread += (clamp(1 + chase / 260, 1, 2.1) - this.spread) * 0.12;

    this.drawPlane();
    this.drawGrid();
    this.drawTrackers(dt);
    this.softenEdges();
  }

  /* ── pass 1 ───────────────────────────────────────────────────────── */
  drawPlane(){
    const c = this.bctx, dpr = this.dpr;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, this.w, this.h);
    c.fillStyle = '#f8f6f2';
    c.fillRect(0, 0, this.w, this.h);

    const need = new Array(this.media.length).fill(false);
    const near = new Array(this.media.length).fill(Infinity);
    const cards = [];
    const tiles = [];
    const fcx = this.w / 2, fcy = this.h / 2;

    const i0 = Math.floor((-this.x - this.blockW) / this.blockW);
    const i1 = Math.ceil((-this.x + this.w + this.blockW) / this.blockW);
    const j0 = Math.floor((-this.y - this.blockH) / this.blockH);
    const j1 = Math.ceil((-this.y + this.h + this.blockH) / this.blockH);

    for (let i = i0; i <= i1; i++){
      for (let j = j0; j <= j1; j++){
        const ox = this.x + i * this.blockW;
        const oy = this.y + j * this.blockH;
        for (const s of SLOTS){
          const x = ox + s.c * this.colPitch;
          const y = oy + s.r * this.rowPitch + COL_OFF[s.c] * this.rowPitch;
          if (x > this.w || x + this.tileW < 0 || y > this.h || y + this.tileH < 0) continue;
          if (s.kind === 'work'){
            need[s.i] = true;
            const dd = Math.hypot(x + this.tileW / 2 - fcx, y + this.tileH / 2 - fcy);
            if (dd < near[s.i]) near[s.i] = dd;
            this.paintWork(c, s.i, x, y);
            tiles.push({ x, y, w: this.tileW, h: this.tileH });
          } else {
            const r = this.paintCard(c, CARDS[s.i], x, y);
            cards.push({ ...r, route: CARDS[s.i].route });
          }
        }
      }
    }
    this._cardRects = cards;
    this._tileRects = tiles;

    /* On mobile / high counts, only decode videos in the active focus area */
    if (MAX_DECODE < this.media.length){
      const live = new Set(
        need.map((n, i) => (n ? i : -1)).filter(i => i >= 0)
            .sort((a, b) => near[a] - near[b]).slice(0, MAX_DECODE));
      for (let n = 0; n < need.length; n++) if (need[n] && !live.has(n)) need[n] = false;
    }

    // only decode/play videos that are actually visible
    for (let n = 0; n < this.media.length; n++){
      const item = this.media[n];
      if (item.kind !== 'video') continue;
      const v = item.el;
      if (need[n] && !this.playing[n]){ this.playing[n] = true; v.play().catch(()=>{}); }
      else if (!need[n] && this.playing[n]){ this.playing[n] = false; v.pause(); }
    }
  }

  paintWork(c, i, x, y){
    const item = this.media[i];
    if (!item) return;
    const w = this.tileW, h = this.tileH;
    
    if (item.kind === 'video'){
      const v = item.el;
      if (v.readyState >= 2 && v.videoWidth){
        const ar = v.videoWidth / v.videoHeight, tr = w / h;
        let sw = v.videoWidth, sh = v.videoHeight, sx = 0, sy = 0;
        if (ar > tr){ sw = v.videoHeight * tr; sx = (v.videoWidth - sw) / 2; }
        else { sh = v.videoWidth / tr; sy = (v.videoHeight - sh) / 2; }
        c.drawImage(v, sx, sy, sw, sh, x, y, w, h);
      } else {
        c.fillStyle = '#f2f1f4';
        c.fillRect(x, y, w, h);
      }
    } else {
      const img = item.el;
      if (img.complete && img.naturalWidth){
        const ar = img.naturalWidth / img.naturalHeight, tr = w / h;
        let sw = img.naturalWidth, sh = img.naturalHeight, sx = 0, sy = 0;
        if (ar > tr){ sw = img.naturalHeight * tr; sx = (img.naturalWidth - sw) / 2; }
        else { sh = img.naturalWidth / tr; sy = (img.naturalHeight - sh) / 2; }
        c.drawImage(img, sx, sy, sw, sh, x, y, w, h);
      } else {
        c.fillStyle = '#f2f1f4';
        c.fillRect(x, y, w, h);
      }
    }

    // Optional label on bottom of tile if present
    const label = WORKS[i]?.label;
    if (label){
      c.save();
      c.fillStyle = 'rgba(17, 16, 20, 0.42)';
      c.fillRect(x, y + h - 22, w, 22);
      c.font = '500 10.5px "SF Pro Display", sans-serif';
      c.fillStyle = '#ffffff';
      c.textAlign = 'left';
      c.textBaseline = 'middle';
      c.fillText(label, x + 8, y + h - 11);
      c.restore();
    }
  }

  paintCard(c, card, x, y){
    const w = this.tileW, h = this.tileH;
    const size = Math.round(clamp(this.tileW * 0.115, 17, 34));
    const cx = x + w / 2, cy = y + h / 2;
    c.fillStyle = '#111014';
    c.textAlign = 'center'; c.textBaseline = 'middle';
    c.font = `500 ${size}px "SF Pro Display", -apple-system, Helvetica, Arial, sans-serif`;
    c.fillText(card.text, cx, cy);
    // subtle handwritten ornament above card text
    c.font = `400 ${Math.round(size * 1.1)}px "Caveat", cursive`;
    c.fillStyle = '#111014';
    c.fillText('~', cx, cy - size * 1.25);

    const tw = Math.max(size * 4.2, c.measureText(card.text).width);
    return { x: cx - tw / 2 - 12, y: cy - size * 2.1, w: tw + 24, h: size * 3.4 };
  }

  /* ── pass 2 · the cursor grid ─────────────────────────────────────── */
  drawGrid(){
    const ctx = this.ctx, dpr = this.dpr;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.cv.width, this.cv.height);
    ctx.drawImage(this.buf, 0, 0);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (this.edgeGrid) return this.edgeGrid_(ctx);
    if (this.mx < -9998) return;

    // The type is punched out of the overlay entirely. Akif's note: the grid
    // must not break the words apart when the cursor passes over them — same
    // rule as the last build, where nothing was ever allowed to cross a word.
    ctx.save();
    this.clipType(ctx);
    const B = GRID_BOX, R = GRID_R * this.spread;
    const gx0 = Math.floor((this.mx - R) / B) * B;
    const gx1 = Math.ceil((this.mx + R) / B) * B;
    const gy0 = Math.floor((this.my - R) / B) * B;
    const gy1 = Math.ceil((this.my + R) / B) * B;

    const dots = [];
    for (let x = gx0; x <= gx1; x += B){
      if (x + B < 0 || x > this.w) continue;
      for (let y = gy0; y <= gy1; y += B){
        if (y + B < 0 || y > this.h) continue;
        const d = Math.hypot(x + B / 2 - this.mx, y + B / 2 - this.my);
        const s = Math.pow(1 - clamp(d / R, 0, 1), GRID_FALL);
        if (s < 0.004) continue;
        const inset = B * s;
        const src = B - inset;
        if (src > 0.5){
          ctx.drawImage(
            this.buf,
            (x + inset / 2) * dpr, (y + inset / 2) * dpr, src * dpr, src * dpr,
            x, y, B, B
          );
        }
        dots.push([x, y, s]);
      }
    }
    ctx.fillStyle = '#111014';
    for (const [x, y, s] of dots){
      ctx.globalAlpha = DOT_ALPHA * s;
      ctx.beginPath();
      ctx.arc(x, y, B * 0.15 * s, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  /* ── pass 2b · the peripheral grid ────────────────────────────────────
     The touch build's edge treatment. The lattice is fixed to the frame, not
     to a pointer, so it reads as a viewfinder the plane moves behind rather
     than as a cursor effect with no cursor. Strength is zero across the sharp
     centre and ramps to EDGE_MAX at the corners of the image circle — the
     same radial law the blur used, so the frame falls off the way it always
     did; it is only what it falls off INTO that changed. */
  edgeGrid_(ctx){
    const B = GRID_BOX, dpr = this.dpr;
    const cx = this.w / 2, cy = this.h / 2;
    const half = Math.hypot(this.w, this.h) / 2;
    // centre the lattice on the frame so the four corners agree
    const x0 = cx - Math.ceil(cx / B) * B;
    const y0 = cy - Math.ceil(cy / B) * B;

    ctx.save();
    this.clipType(ctx);
    const dots = [];
    for (let x = x0; x < this.w; x += B){
      for (let y = y0; y < this.h; y += B){
        const d = Math.hypot(x + B / 2 - cx, y + B / 2 - cy) / half;
        const s = Math.pow(clamp((d - EDGE_START) / (1 - EDGE_START), 0, 1), EDGE_FALL);
        if (s < 0.004) continue;
        const inset = B * s * EDGE_MAX;
        const src = B - inset;
        if (src > 0.5){
          ctx.drawImage(
            this.buf,
            (x + inset / 2) * dpr, (y + inset / 2) * dpr, src * dpr, src * dpr,
            x, y, B, B
          );
        }
        dots.push([x, y, s]);
      }
    }
    ctx.fillStyle = '#111014';
    for (const [x, y, s] of dots){
      ctx.globalAlpha = EDGE_DOT * s;
      ctx.beginPath();
      ctx.arc(x, y, B * 0.115 * s, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  /** Clips to everything EXCEPT the text cards, with a soft rounded hole. */
  clipType(ctx){
    const p = new Path2D();
    p.rect(0, 0, this.w, this.h);
    for (const r of (this._cardRects || [])){
      const x = r.x - 8, y = r.y - 6, w = r.w + 16, h = r.h + 12;
      const rad = Math.min(22, h / 2);
      if (p.roundRect) p.roundRect(x, y, w, h, rad);
      else p.rect(x, y, w, h);
    }
    ctx.clip(p, 'evenodd');
  }

  /* ── the edge of the glass ──────────────────────────────────────────
     Everything already on the canvas is re-sampled small, blurred, masked to
     the outside of the image circle and laid back over itself. It goes last
     on purpose: a lens softens the corner of the whole frame, films, type,
     brackets and all — not one layer of it. */
  softenEdges(){
    if (this.edgeGrid) return;          // the periphery is carrying the grid
    const ctx = this.ctx, b = this.bl;
    const bw = this.blurCv.width, bh = this.blurCv.height;
    if (bw < 4 || bh < 4) return;

    b.setTransform(1, 0, 0, 1, 0, 0);
    b.globalCompositeOperation = 'copy';
    if ('filter' in b) b.filter = `blur(${BLUR_PX}px)`;
    b.drawImage(this.cv, 0, 0, bw, bh);
    if ('filter' in b) b.filter = 'none';

    b.globalCompositeOperation = 'destination-in';
    b.drawImage(this.maskCv, 0, 0);
    b.globalCompositeOperation = 'source-over';

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(this.blurCv, 0, 0, this.cv.width, this.cv.height);
  }

  drawTrackers(dt){
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.save();
    this.clipType(ctx);
    this.trackers.draw(ctx, dt, this._tileRects || []);
    ctx.restore();
  }
}
