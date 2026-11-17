import * as THREE from 'three';
import { criarRng, lerp, clamp } from './utils.js';

// Todas as texturas são desenhadas na hora num <canvas>: o site não depende de imagens.

function tela(w, h = w) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')];
}

function textura(c) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

/** Brilho radial suave (base de quase todos os sprites). */
function brilho() {
  const [c, g] = tela(256);
  const grd = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.06, 'rgba(255,255,255,0.9)');
  grd.addColorStop(0.16, 'rgba(255,255,255,0.45)');
  grd.addColorStop(0.32, 'rgba(255,255,255,0.16)');
  grd.addColorStop(0.6, 'rgba(255,255,255,0.04)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 256, 256);
  return textura(c);
}

/** Anel fino (ondas de choque, pulsos de energia). */
function anel() {
  const [c, g] = tela(512);
  const grd = g.createRadialGradient(256, 256, 0, 256, 256, 256);
  grd.addColorStop(0, 'rgba(255,255,255,0)');
  grd.addColorStop(0.55, 'rgba(255,255,255,0)');
  grd.addColorStop(0.8, 'rgba(255,255,255,0.18)');
  grd.addColorStop(0.92, 'rgba(255,255,255,1)');
  grd.addColorStop(0.96, 'rgba(255,255,255,0.25)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 512, 512);
  return textura(c);
}

/** Raios em cruz de estrela (lens flare). */
function flare() {
  const S = 512;
  const [c, g] = tela(S);
  g.globalCompositeOperation = 'lighter';
  const raio = (ang, comp, larg, alfa) => {
    g.save();
    g.translate(S / 2, S / 2);
    g.rotate(ang);
    const grd = g.createLinearGradient(-S / 2, 0, S / 2, 0);
    grd.addColorStop(0, 'rgba(255,255,255,0)');
    grd.addColorStop(0.5, `rgba(255,255,255,${alfa})`);
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.beginPath();
    g.ellipse(0, 0, (S / 2) * comp, larg, 0, 0, Math.PI * 2);
    g.fill();
    g.restore();
  };
  raio(0, 1, 3, 1);
  raio(Math.PI / 2, 1, 3, 1);
  raio(Math.PI / 4, 0.5, 2, 0.45);
  raio(-Math.PI / 4, 0.5, 2, 0.45);
  const grd = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S * 0.14);
  grd.addColorStop(0, 'rgba(255,255,255,0.9)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, S, S);
  return textura(c);
}

/** Nuvem de gás: vários borrões suaves somados, com borda esmaecida. */
function nuvem(semente) {
  const rand = criarRng(semente);
  const S = 256;
  const [c, g] = tela(S);
  g.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 80; i++) {
    const ang = rand() * Math.PI * 2;
    const dist = Math.pow(rand(), 0.7) * S * 0.3;
    const x = S / 2 + Math.cos(ang) * dist;
    const y = S / 2 + Math.sin(ang) * dist;
    const r = S * (0.05 + rand() * 0.17);
    const a = 0.03 + rand() * 0.08;
    const grd = g.createRadialGradient(x, y, 0, x, y, r);
    grd.addColorStop(0, `rgba(255,255,255,${a})`);
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, S, S);
  }
  g.globalCompositeOperation = 'destination-in';
  const m = g.createRadialGradient(S / 2, S / 2, S * 0.15, S / 2, S / 2, S * 0.5);
  m.addColorStop(0, 'rgba(0,0,0,1)');
  m.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = m;
  g.fillRect(0, 0, S, S);
  return textura(c);
}

/** Ruído de valor 2D, periódico na horizontal (para a textura do planeta "fechar" na volta). */
function criarRuido(semente, periodo) {
  const rand = criarRng(semente);
  const val = new Float32Array(256);
  const perm = new Uint8Array(256);
  for (let i = 0; i < 256; i++) {
    val[i] = rand();
    perm[i] = i;
  }
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [perm[i], perm[j]] = [perm[j], perm[i]];
  }
  const h = (x, y) => val[perm[(perm[x & 255] + y) & 255]];
  const ruido = (x, y, p) => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const xf = x - xi;
    const yf = y - yi;
    const u = xf * xf * (3 - 2 * xf);
    const v = yf * yf * (3 - 2 * yf);
    const x0 = ((xi % p) + p) % p;
    const x1 = (x0 + 1) % p;
    return lerp(lerp(h(x0, yi), h(x1, yi), u), lerp(h(x0, yi + 1), h(x1, yi + 1), u), v);
  };
  return (x, y) => {
    let s = 0;
    let a = 0.5;
    let f = 1;
    for (let o = 0; o < 4; o++) {
      s += ruido(x * f, y * f, periodo * f) * a;
      a *= 0.5;
      f *= 2;
    }
    return s / 0.9375;
  };
}

/** Gigante gasoso em tons de rosa-dourado, com faixas turbulentas e uma tempestade. */
function planeta() {
  const W = 768;
  const H = 384;
  const [c, g] = tela(W, H);
  const fbm = criarRuido(7, 8);
  // cores em sRGB 0..1 (sem passar por THREE.Color, que converteria para linear)
  const paleta = ['#f3d9c0', '#d9a383', '#ecc9ae', '#b9776b', '#f4e6d6', '#c98f7a', '#9f6a72', '#e4b8a0'].map(
    (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
  );
  const img = g.createImageData(W, H);
  const cor = [0, 0, 0];
  for (let y = 0; y < H; y++) {
    const lat = y / H;
    for (let x = 0; x < W; x++) {
      const n = fbm((x / W) * 8, lat * 10);
      const faixa = lat * 9 + (n - 0.5) * 1.6;
      const i = Math.floor(faixa);
      const f = faixa - i;
      const a = paleta[((i % paleta.length) + paleta.length) % paleta.length];
      const b = paleta[(((i + 1) % paleta.length) + paleta.length) % paleta.length];
      const m = f * f * (3 - 2 * f);
      for (let j = 0; j < 3; j++) cor[j] = lerp(a[j], b[j], m);
      const polo = 1 - Math.pow(Math.abs(lat - 0.5) * 2, 6) * 0.45;
      const det = 0.88 + n * 0.24;
      const k = (y * W + x) * 4;
      img.data[k] = clamp(cor[0] * det * polo) * 255;
      img.data[k + 1] = clamp(cor[1] * det * polo) * 255;
      img.data[k + 2] = clamp(cor[2] * det * polo) * 255;
      img.data[k + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  // tempestade oval
  g.save();
  g.translate(W * 0.32, H * 0.63);
  g.scale(2.2, 1);
  const grd = g.createRadialGradient(0, 0, 0, 0, 0, 16);
  grd.addColorStop(0, 'rgba(250,236,226,0.95)');
  grd.addColorStop(0.45, 'rgba(196,110,104,0.85)');
  grd.addColorStop(1, 'rgba(196,110,104,0)');
  g.fillStyle = grd;
  g.beginPath();
  g.arc(0, 0, 16, 0, Math.PI * 2);
  g.fill();
  g.restore();
  return textura(c);
}

/** Faixa radial dos anéis do planeta (u = do raio interno ao externo). */
function aneisPlaneta() {
  const W = 512;
  const [c, g] = tela(W, 4);
  const rand = criarRng(31);
  let ruido = 0.5;
  for (let x = 0; x < W; x++) {
    ruido = clamp(ruido + (rand() - 0.5) * 0.25, 0.15, 1);
    const u = x / W;
    let a = ruido * (0.35 + 0.65 * Math.sin(u * Math.PI));
    if (u > 0.6 && u < 0.66) a *= 0.12; // divisão escura
    a *= Math.min(1, u * 12) * Math.min(1, (1 - u) * 10);
    const r = Math.round(lerp(236, 200, u));
    const gg = Math.round(lerp(214, 186, u));
    const b = Math.round(lerp(200, 222, u));
    g.fillStyle = `rgba(${r},${gg},${b},${a.toFixed(3)})`;
    g.fillRect(x, 0, 1, 4);
  }
  return textura(c);
}

export function criarTexturas() {
  return {
    brilho: brilho(),
    anel: anel(),
    flare: flare(),
    nuvens: [nuvem(11), nuvem(23), nuvem(37), nuvem(53)],
    planeta: planeta(),
    aneisPlaneta: aneisPlaneta(),
  };
}
