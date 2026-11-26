/*
 * Olho com falhas.
 *
 * Um olho simples (esclera preta, íris azul/violeta com anel magenta) cercado de estática e
 * pedaços de imagem corrompida. Ele olha para onde o mouse (ou o dedo) está; se o ponteiro
 * fica parado por mais de 5 segundos, ele passa a olhar para os lados sozinho, e assim que o
 * ponteiro mexe ele volta a seguir.
 *
 * Tudo é desenhado numa imagem pequena (uns 340 "pixels" de largura, cada um vira um quadradinho
 * na tela) e ampliada sem suavizar: é isso que dá o aspecto granulado, de imagem estragada.
 */
(() => {
  'use strict';

  // ---------------------------------------------------------------- ajustes
  const RESOLUCAO = 340; // largura (em "pixels" grandes) da imagem: menor = mais granulado
  const PARADO = 5000; // ms com o ponteiro parado até o olho começar a olhar para os lados
  const COR = {
    fundo: '#07020c',
    olho: '#000000',
    contorno: '#4a1d8c',
    iris: ['#8b2cff', '#5a3bff', '#2f4dff', '#1a2acc'], // de dentro para fora
    fibra: '#7fa4ff',
    anel: '#ff2d6f',
    anelEscuro: '#9c0f45',
    pupila: '#0a0010',
    brilho: '#ffd6f0',
    estatica: '#f4f0ff',
    falhas: ['#ff2a2a', '#ffe14d', '#39ff88', '#2ee6ff', '#ff2d6f', '#8b2cff'],
  };
  const reduzir = matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---------------------------------------------------------------- telas
  const tela = document.getElementById('olho');
  const ctx = tela.getContext('2d');
  const img = document.createElement('canvas'); // a imagem pequena, onde tudo é desenhado
  const g = img.getContext('2d');
  const copia = document.createElement('canvas'); // cópia para deslocar faixas nas falhas
  const gc = copia.getContext('2d');
  let linhas = null; // padrão de linhas de TV por cima de tudo

  let W = 0;
  let H = 0;
  let PIXEL = 3; // tamanho de cada "pixel" da imagem na tela (depende do tamanho da tela)
  let S = 0; // largura do olho (em pixels da imagem pequena)
  let cx = 0;
  let cy = 0;

  function redimensionar() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    tela.width = Math.round(innerWidth * dpr);
    tela.height = Math.round(innerHeight * dpr);
    // a imagem tem sempre mais ou menos o mesmo tamanho: em telas grandes os pixels ficam maiores
    PIXEL = Math.min(6, Math.max(2, Math.min(innerWidth, innerHeight * 1.78) / RESOLUCAO));
    W = Math.max(90, Math.round(innerWidth / PIXEL));
    H = Math.max(90, Math.round(innerHeight / PIXEL));
    img.width = copia.width = W;
    img.height = copia.height = H;
    S = Math.min(W * 0.56, H * 1.05);
    cx = W / 2;
    cy = H / 2;
    // linhas de TV: uma linha escura a cada 3 px da tela de verdade
    const p = document.createElement('canvas');
    p.width = 1;
    p.height = Math.max(3, Math.round(3 * dpr));
    const pg = p.getContext('2d');
    pg.fillStyle = 'rgba(0,0,0,0.22)';
    pg.fillRect(0, 0, 1, Math.max(1, Math.round(dpr)));
    linhas = ctx.createPattern(p, 'repeat');
  }
  addEventListener('resize', redimensionar);
  redimensionar();

  // ---------------------------------------------------------------- utilidades
  const rand = (a = 1, b) => (b === undefined ? Math.random() * a : a + Math.random() * (b - a));
  const escolher = (lista) => lista[Math.floor(Math.random() * lista.length)];
  const gauss = () => (Math.random() + Math.random() + Math.random() - 1.5) / 1.5;
  const suave = (x) => x * x * (3 - 2 * x);

  // ---------------------------------------------------------------- para onde o olho olha
  // x, y vão de -1 a 1 (canto do olho); o alvo muda e o olhar vai até ele com uma mola
  const olhar = { x: 0, y: 0, vx: 0, vy: 0, alvoX: 0, alvoY: 0 };
  let ponteiro = null;
  let ultimoMovimento = performance.now();
  let modo = 'seguindo'; // 'seguindo' o ponteiro ou 'vagando' (olhando para os lados sozinho)
  let proximaOlhada = 0;

  function moveu(e) {
    ponteiro = { x: e.clientX / PIXEL, y: e.clientY / PIXEL };
    ultimoMovimento = performance.now();
    if (modo === 'vagando') {
      // acordou: volta a seguir com uma falha rápida
      modo = 'seguindo';
      falhar(0.55);
    }
  }
  addEventListener('pointermove', moveu, { passive: true });
  addEventListener('pointerdown', moveu, { passive: true });

  function atualizarOlhar(dt, agora) {
    if (modo === 'seguindo' && agora - ultimoMovimento > PARADO) {
      modo = 'vagando';
      proximaOlhada = agora;
    }
    let k;
    if (modo === 'seguindo') {
      if (ponteiro) {
        const dx = ponteiro.x - cx;
        const dy = (ponteiro.y - cy) * 1.4; // o olho é mais largo que alto
        const d = Math.hypot(dx, dy) || 1;
        const f = Math.min(1, d / (S * 0.75)); // perto do olho ele mexe menos
        olhar.alvoX = (dx / d) * f;
        olhar.alvoY = (dy / d) * f;
      }
      k = 110;
    } else {
      if (agora >= proximaOlhada) {
        // olha para os lados (mais na horizontal); às vezes volta para a frente
        if (Math.random() < 0.18) {
          olhar.alvoX = rand(-0.15, 0.15);
          olhar.alvoY = rand(-0.1, 0.1);
        } else {
          const lado = Math.random() < 0.5 ? -1 : 1;
          olhar.alvoX = lado * rand(0.45, 1);
          olhar.alvoY = rand(-0.55, 0.55);
        }
        proximaOlhada = agora + rand(450, 1900);
        if (Math.random() < 0.3) falhar(0.25);
      }
      k = 420; // movimentos rápidos e paradas, como um olho de verdade
    }
    // limita o alvo à borda do olho
    const m = Math.hypot(olhar.alvoX, olhar.alvoY);
    if (m > 1) {
      olhar.alvoX /= m;
      olhar.alvoY /= m;
    }
    // mola sem balanço (criticamente amortecida), em passos pequenos
    const c = 2 * Math.sqrt(k);
    const passos = 4;
    const h = dt / passos;
    for (let i = 0; i < passos; i++) {
      olhar.vx += (k * (olhar.alvoX - olhar.x) - c * olhar.vx) * h;
      olhar.vy += (k * (olhar.alvoY - olhar.y) - c * olhar.vy) * h;
      olhar.x += olhar.vx * h;
      olhar.y += olhar.vy * h;
    }
  }

  // ---------------------------------------------------------------- piscar
  let piscada = -1;
  let proximaPiscada = performance.now() + rand(2500, 5000);
  const DURACAO_PISCADA = 170;

  function abertura(agora) {
    if (agora >= proximaPiscada && piscada < 0) {
      piscada = agora;
      // às vezes pisca duas vezes seguidas
      proximaPiscada = agora + (Math.random() < 0.2 ? 260 : rand(2500, 6500));
    }
    if (piscada < 0) return 1;
    const p = (agora - piscada) / DURACAO_PISCADA;
    if (p >= 1) {
      piscada = -1;
      return 1;
    }
    const fechado = p < 0.4 ? p / 0.4 : 1 - (p - 0.4) / 0.6;
    return 1 - suave(fechado) * 0.97;
  }

  // ---------------------------------------------------------------- falhas
  let surto = 0; // 0..1: quão forte está a falha agora (cai sozinho)
  function falhar(f) {
    if (reduzir) f *= 0.3;
    surto = Math.max(surto, f + rand(0.15));
  }

  // manchas de estática grudadas na borda do olho (duram um pouco e somem)
  const manchas = [];
  function novaMancha() {
    return {
      t: rand(0.03, 0.97),
      lado: Math.random() < 0.5 ? -1 : 1,
      dist: rand(0.02, 0.2),
      r: rand(0.04, 0.12),
      vida: rand(0.25, 1.2),
      idade: 0,
      cor: Math.random() < 0.18 ? escolher(COR.falhas) : null,
    };
  }
  for (let i = 0; i < 9; i++) manchas.push(novaMancha());

  // blocos coloridos corrompidos (aparecem por alguns quadros)
  const blocos = [];
  function novoBloco(perto) {
    const ang = rand(Math.PI * 2);
    const d = perto ? rand(0.85, 1.25) : rand(1.1, 2);
    return {
      x: cx + Math.cos(ang) * (S / 2) * d + gauss() * S * 0.05,
      y: cy + Math.sin(ang) * S * 0.3 * d + gauss() * S * 0.04,
      w: rand(2, S * 0.12),
      h: rand(1, S * 0.03),
      cor: escolher(COR.falhas),
      vida: rand(0.05, 0.3),
    };
  }

  // ---------------------------------------------------------------- desenho
  /** Contorno de amêndoa (o formato do olho), meia altura `mh`. */
  function amendoa(x, y, largura, mh) {
    const c = mh / 0.75; // ponto de controle que dá exatamente essa meia altura
    g.beginPath();
    g.moveTo(x - largura / 2, y);
    g.bezierCurveTo(x - largura * 0.2, y - c, x + largura * 0.2, y - c, x + largura / 2, y);
    g.bezierCurveTo(x + largura * 0.2, y + c, x - largura * 0.2, y + c, x - largura / 2, y);
    g.closePath();
  }

  /** Círculo com a borda um pouco irregular (parece desenhado à mão / corrompido). */
  function circuloTorto(x, y, r, aspereza, semente) {
    g.beginPath();
    const n = 48;
    for (let i = 0; i <= n; i++) {
      const a = (i / n) * Math.PI * 2;
      const ruido = Math.sin(a * 5 + semente) * 0.5 + Math.sin(a * 11 - semente * 1.7) * 0.3 + Math.sin(a * 23 + semente * 3.1) * 0.2;
      const rr = r * (1 + ruido * aspereza);
      const px = x + Math.cos(a) * rr;
      const py = y + Math.sin(a) * rr;
      if (i === 0) g.moveTo(px, py);
      else g.lineTo(px, py);
    }
    g.closePath();
  }

  /**
   * Ponto do contorno do olho (t de 0 a 1, da ponta esquerda à direita; lado -1 = em cima,
   * 1 = embaixo) e a direção para fora nesse ponto. `c` é o controle da curva (meia altura / 0,75).
   */
  const contorno = { x: 0, y: 0, nx: 0, ny: 0 };
  function pontoContorno(t, lado, c) {
    const u = 1 - t;
    const bx = u * u * u * -0.5 + 3 * u * u * t * -0.2 + 3 * u * t * t * 0.2 + t * t * t * 0.5;
    const by = 3 * u * u * t + 3 * u * t * t;
    const dx = 3 * u * u * 0.3 + 6 * u * t * 0.4 + 3 * t * t * 0.3;
    const dy = 3 * u * u - 3 * t * t;
    const nx = -dy * c;
    const ny = lado * dx * S;
    const nl = Math.hypot(nx, ny) || 1;
    contorno.x = cx + bx * S;
    contorno.y = cy + lado * by * c;
    contorno.nx = nx / nl;
    contorno.ny = ny / nl;
    return contorno;
  }

  function desenharEstatica(dt, mh) {
    const area = W * H;
    // neve fraquinha no fundo todo
    g.fillStyle = COR.estatica;
    const fundo = Math.round(area * 0.0016);
    for (let i = 0; i < fundo; i++) {
      g.globalAlpha = rand(0.05, 0.35);
      g.fillRect(Math.floor(rand(W)), Math.floor(rand(H)), 1, 1);
    }
    // aura de estática grudada no contorno do olho: bem densa encostada na borda, rareando para
    // fora (a densidade varia em volta, como manchas de neve de TV)
    const n = Math.round(S * S * (0.3 + surto * 0.25));
    const c = Math.max(mh, S * 0.16) / 0.75; // mesma curva da amêndoa
    const fase = Math.floor(performance.now() / 90) * 0.7; // o desenho das manchas muda aos saltos
    for (let i = 0; i < n; i++) {
      // ponto no contorno (curva de cima ou de baixo) e a direção para fora nesse ponto
      const lado = Math.random() < 0.5 ? -1 : 1;
      const { x: px, y: py, nx, ny } = pontoContorno(Math.random(), lado, c);
      const a = Math.atan2(py - cy, px - cx);
      const forca = 0.55 + 0.45 * Math.sin(a * 3 + fase) * Math.sin(a * 7 - fase * 1.3);
      if (Math.random() > forca + 0.3) continue;
      const fora = S * (0.012 + Math.pow(Math.random(), 2.3) * (0.08 + 0.26 * forca));
      g.globalAlpha = rand(0.45, 1);
      const tam = Math.random() < 0.15 ? 2 : 1;
      g.fillRect(Math.floor(px + nx * fora), Math.floor(py + ny * fora), tam, tam);
    }
    // manchas de estática (pedaços de "neve" mais densos)
    for (let i = 0; i < manchas.length; i++) {
      const m = manchas[i];
      m.idade += dt;
      if (m.idade > m.vida) {
        manchas[i] = novaMancha();
        continue;
      }
      const p = pontoContorno(m.t, m.lado, c);
      const mx = p.x + p.nx * m.dist * S;
      const my = p.y + p.ny * m.dist * S;
      const r = m.r * S;
      const pontos = Math.round(r * r * 1.6);
      for (let j = 0; j < pontos; j++) {
        const px = mx + gauss() * r;
        const py = my + gauss() * r * 0.7;
        g.globalAlpha = rand(0.4, 1);
        g.fillStyle = m.cor && Math.random() < 0.35 ? m.cor : COR.estatica;
        g.fillRect(Math.floor(px), Math.floor(py), 1, 1);
      }
      g.fillStyle = COR.estatica;
    }
    g.globalAlpha = 1;
  }

  function desenharIris(ix, iy, R, t) {
    const semente = Math.floor(t * (2 + surto * 12)) * 1.3; // a borda muda aos saltos
    const aspereza = 0.025 + surto * 0.06;
    // íris: anéis de azul a violeta
    const grad = g.createRadialGradient(ix, iy, R * 0.45, ix, iy, R);
    COR.iris.forEach((c, i) => grad.addColorStop(i / (COR.iris.length - 1), c));
    circuloTorto(ix, iy, R, aspereza, semente);
    g.fillStyle = grad;
    g.fill();
    // fibras da íris
    g.strokeStyle = COR.fibra;
    g.lineWidth = 1;
    for (let i = 0; i < 34; i++) {
      const a = (i / 34) * Math.PI * 2 + Math.sin(i * 7.3) * 0.08;
      const r0 = R * (0.58 + 0.06 * Math.sin(i * 3.1));
      const r1 = R * (0.86 + 0.08 * Math.sin(i * 5.7 + semente));
      g.globalAlpha = 0.25 + 0.2 * Math.sin(i * 2.3);
      g.beginPath();
      g.moveTo(ix + Math.cos(a) * r0, iy + Math.sin(a) * r0);
      g.lineTo(ix + Math.cos(a) * r1, iy + Math.sin(a) * r1);
      g.stroke();
    }
    g.globalAlpha = 1;
    // borda escura da íris
    circuloTorto(ix, iy, R, aspereza, semente);
    g.strokeStyle = '#0b0730';
    g.lineWidth = Math.max(1, R * 0.05);
    g.stroke();
    // anel magenta
    circuloTorto(ix, iy, R * 0.56, aspereza * 1.5, semente + 2);
    g.fillStyle = COR.anel;
    g.fill();
    circuloTorto(ix, iy, R * 0.46, aspereza * 1.5, semente + 4);
    g.fillStyle = COR.anelEscuro;
    g.fill();
    // pupila (respira um pouco)
    const rp = R * (0.36 + 0.025 * Math.sin(t * 0.9));
    circuloTorto(ix, iy, rp, aspereza, semente + 6);
    g.fillStyle = COR.pupila;
    g.fill();
    // grão: pontinhos claros e escuros espalhados pela íris (imagem "suja")
    const graos = Math.round(R * R * 0.5);
    for (let i = 0; i < graos; i++) {
      const a = rand(Math.PI * 2);
      const rr = R * Math.sqrt(Math.random());
      g.fillStyle = Math.random() < 0.5 ? '#c9d6ff' : '#05021a';
      g.globalAlpha = rand(0.15, 0.5);
      g.fillRect(Math.floor(ix + Math.cos(a) * rr), Math.floor(iy + Math.sin(a) * rr), 1, 1);
    }
    g.globalAlpha = 1;
    // brilho
    g.fillStyle = COR.brilho;
    g.globalAlpha = 0.9;
    g.beginPath();
    g.arc(ix - R * 0.2, iy - R * 0.22, Math.max(1.5, R * 0.085), 0, Math.PI * 2);
    g.fill();
    g.globalAlpha = 0.6;
    g.beginPath();
    g.arc(ix - R * 0.06, iy - R * 0.08, Math.max(1, R * 0.035), 0, Math.PI * 2);
    g.fill();
    g.globalAlpha = 1;
  }

  function desenharOlho(t, aberto) {
    const largura = S * (1 + 0.008 * Math.sin(t * 1.3));
    const mh = S * 0.27 * aberto; // meia altura
    const R = S * 0.2;
    // separação de cores: cópias do contorno em vermelho e ciano, deslocadas
    const desvio = 1 + surto * 7;
    g.globalCompositeOperation = 'lighter';
    g.lineWidth = 2;
    amendoa(cx - desvio, cy, largura, Math.max(mh, 1));
    g.strokeStyle = 'rgba(255,40,60,0.7)';
    g.stroke();
    amendoa(cx + desvio, cy, largura, Math.max(mh, 1));
    g.strokeStyle = 'rgba(40,220,255,0.7)';
    g.stroke();
    g.globalCompositeOperation = 'source-over';
    // o olho em si
    amendoa(cx, cy, largura, Math.max(mh, 0.5));
    g.fillStyle = COR.olho;
    g.fill();
    if (aberto > 0.08) {
      g.save();
      amendoa(cx, cy, largura, mh);
      g.clip();
      let ix = cx + olhar.x * S * 0.24;
      let iy = cy + olhar.y * S * 0.13;
      if (surto > 0.05) {
        ix += gauss() * surto * 4;
        iy += gauss() * surto * 2;
      }
      // fantasmas coloridos da íris (separação RGB)
      g.globalCompositeOperation = 'lighter';
      g.globalAlpha = 0.55;
      g.fillStyle = '#ff1f3d';
      g.beginPath();
      g.arc(ix - desvio, iy, R, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#1fd8ff';
      g.beginPath();
      g.arc(ix + desvio, iy, R, 0, Math.PI * 2);
      g.fill();
      g.globalAlpha = 1;
      g.globalCompositeOperation = 'source-over';
      desenharIris(ix, iy, R, t);
      g.restore();
    }
    // contorno
    amendoa(cx, cy, largura, Math.max(mh, 0.5));
    g.strokeStyle = COR.contorno;
    g.lineWidth = 1;
    g.stroke();
    return mh;
  }

  function desenharBlocos(dt) {
    // de vez em quando (e muito durante uma falha) aparecem blocos coloridos
    const chance = (reduzir ? 0.4 : 2.5) * dt + surto * 0.6;
    if (Math.random() < chance) {
      const quantos = 1 + Math.floor(rand(3 + surto * 8));
      for (let i = 0; i < quantos; i++) blocos.push(novoBloco(Math.random() < 0.7));
    }
    for (let i = blocos.length - 1; i >= 0; i--) {
      const b = blocos[i];
      b.vida -= dt;
      if (b.vida <= 0) {
        blocos.splice(i, 1);
        continue;
      }
      g.fillStyle = b.cor;
      g.globalAlpha = 0.85;
      g.fillRect(Math.floor(b.x), Math.floor(b.y), Math.ceil(b.w), Math.ceil(b.h));
      // um pedacinho de estática dentro do bloco
      g.fillStyle = COR.estatica;
      for (let j = 0; j < b.w * b.h * 0.15; j++) g.fillRect(Math.floor(b.x + rand(b.w)), Math.floor(b.y + rand(b.h)), 1, 1);
    }
    g.globalAlpha = 1;
  }

  /** Faixas horizontais deslocadas (a imagem "escorrega"). */
  function deslocarFaixas() {
    if (surto < 0.12) return;
    gc.clearRect(0, 0, W, H);
    gc.drawImage(img, 0, 0);
    const faixas = 2 + Math.floor(surto * 9);
    for (let i = 0; i < faixas; i++) {
      const y = Math.floor(cy + gauss() * S * 0.35);
      const h = Math.ceil(rand(1, 3 + surto * 14));
      const dx = Math.round(gauss() * surto * S * 0.18);
      g.drawImage(copia, 0, y, W, h, dx, y, W, h);
      if (Math.random() < 0.3) {
        g.globalCompositeOperation = 'lighter';
        g.fillStyle = escolher(COR.falhas);
        g.globalAlpha = 0.25;
        g.fillRect(0, y, W, h);
        g.globalAlpha = 1;
        g.globalCompositeOperation = 'source-over';
      }
    }
  }

  // ---------------------------------------------------------------- laço
  let antes = performance.now();
  function quadro(agora) {
    const dt = Math.min(0.05, (agora - antes) / 1000);
    antes = agora;
    const t = agora / 1000;

    // falhas aleatórias de tempos em tempos
    if (!reduzir && Math.random() < dt * 0.5) falhar(rand(0.25, 0.7));
    surto *= Math.exp(-dt * 7);

    atualizarOlhar(dt, agora);
    const aberto = abertura(agora);

    g.globalCompositeOperation = 'source-over';
    g.globalAlpha = 1;
    g.fillStyle = COR.fundo;
    g.fillRect(0, 0, W, H);
    desenharEstatica(dt, S * 0.27 * Math.max(aberto, 0.6));
    desenharOlho(t, aberto);
    desenharBlocos(dt);
    deslocarFaixas();

    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(img, 0, 0, tela.width, tela.height);
    ctx.fillStyle = linhas;
    ctx.fillRect(0, 0, tela.width, tela.height);

    requestAnimationFrame(quadro);
  }
  requestAnimationFrame(quadro);

  // para testes: window.olho mostra o estado atual
  window.olho = {
    get modo() {
      return modo;
    },
    get olhar() {
      return { x: olhar.x, y: olhar.y };
    },
  };
})();
