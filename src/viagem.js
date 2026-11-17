import * as THREE from 'three';
import { smoothstep, clamp, lerp } from './utils.js';

const M = 3000; // amostras ao longo do caminho
const SUAVIZAR = 35; // a câmera de perseguição segue a direção média de ±35 de caminho
const LIXA = 10; // o caminho é arredondado numa janela de ±10 (tira quinas sem encolher a órbita)
const GIRO = 1.1; // ~63°: quanto a câmera vira para o lado ao sair do braço da galáxia
const RAIO_ORBITA = 34; // a estrela dá a volta em Saturno a esta distância do centro (anéis vão até 28)
const RAIO_CAMERA = 60; // a câmera acompanha por fora, um pouco acima do plano da volta...
const ATRASO_CAMERA = 0.6; // ...começando ~35° atrás da estrela...
const EXTRA_ORBITA = THREE.MathUtils.degToRad(30); // a estrela dá 360° + 30° e sai pela tangente
const GIRO_CAMERA_SATURNO = Math.PI * 2 + EXTRA_ORBITA; // ...e a câmera dá a volta inteira junto com ela
const DIRECAO_DO_BRACO = new THREE.Vector3(-0.25, 0, -1); // a estrela atravessa o braço indo "para dentro" da cena

/** Média móvel de uma lista de pontos (x, y, z) com janela ±k. */
function mediaMovel(src, k) {
  const n = src.length / 3;
  const out = new Float32Array(src.length);
  const soma = [0, 0, 0];
  let ini = 0;
  let fim = -1;
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - k);
    const b = Math.min(n - 1, i + k);
    while (fim < b) {
      fim++;
      for (let c = 0; c < 3; c++) soma[c] += src[fim * 3 + c];
    }
    while (ini < a) {
      for (let c = 0; c < 3; c++) soma[c] -= src[ini * 3 + c];
      ini++;
    }
    for (let c = 0; c < 3; c++) out[i * 3 + c] = soma[c] / (b - a + 1);
  }
  return out;
}

/**
 * Planeja a rota antes de criar Saturno: posiciona a galáxia para que a estrela chegue
 * alinhada com um braço, e diz onde Saturno deve ficar para a volta completa.
 *
 * @param braco  { indice, raio, tempo }: o braço, a distância do núcleo onde a estrela o cruza
 *               e o instante aproximado da passagem (a galáxia gira devagar)
 */
export function planejarRota(galaxia, inicio, braco) {
  const { indice, raio, tempo } = braco;
  const MEIA_TRAVESSIA = 45; // a estrela fica ~90 unidades dentro do braço
  const n = galaxia.normal;

  // 1) gira a galáxia (em volta do eixo vertical) para o braço apontar para dentro da cena,
  //    e a coloca de modo que o braço comece 70 unidades à frente do ponto inicial,
  //    na mesma direção em que o braço segue (a estrela entra nele de frente)
  galaxia.moverPara(new THREE.Vector3());
  const direcaoDoBraco = () => {
    const a = galaxia.pontoDoBraco(indice, raio, tempo);
    return galaxia.pontoDoBraco(indice, raio - 1, tempo).sub(a).normalize();
  };
  const atual = direcaoDoBraco();
  const ajuste = Math.atan2(DIRECAO_DO_BRACO.x, DIRECAO_DO_BRACO.z) - Math.atan2(atual.x, atual.z);
  galaxia.grupo.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), ajuste));
  galaxia.grupo.updateMatrixWorld();
  const meio0 = galaxia.pontoDoBraco(indice, raio, tempo);
  const dirBraco = direcaoDoBraco();
  galaxia.moverPara(inicio.clone().addScaledVector(dirBraco, 70 + MEIA_TRAVESSIA).sub(meio0));

  // 2) atravessa o braço em linha reta, tangente a ele no meio (no plano do disco):
  //    como o braço curva devagar, a reta fica dentro da faixa de estrelas o trecho todo
  const meio = galaxia.pontoDoBraco(indice, raio, tempo);
  const noBraco = [-1, -0.5, 0, 0.5, 1].map((f) => meio.clone().addScaledVector(dirBraco, f * MEIA_TRAVESSIA));
  const fimBraco = noBraco[noBraco.length - 1];
  const dirFim = dirBraco;

  // 3) sobe do disco até a entrada da órbita, e Saturno fica ao lado (do lado do núcleo)
  const entrada = fimBraco.clone().addScaledVector(dirFim, 72).addScaledVector(n, 20);
  const dEnt = entrada.clone().sub(fimBraco).normalize();
  const praNucleo = galaxia.centro.clone().sub(entrada);
  const lado = praNucleo.addScaledVector(dEnt, -praNucleo.dot(dEnt)).normalize();
  const saturno = entrada.clone().addScaledVector(lado, RAIO_ORBITA);

  return { noBraco, entrada, dEnt, lado, saturno };
}

/**
 * A viagem da estrela: atravessa um braço da galáxia, dá uma volta completa em Saturno
 * e segue até o ponto onde vai explodir. Também diz onde a câmera fica a cada instante.
 */
export class Viagem {
  constructor({ inicio, galaxia, planeta, rota }, duracao) {
    this.duracao = duracao;
    const { noBraco, entrada, dEnt, lado } = rota;
    const C = planeta.centro;

    // volta completa (360° + um pouco) em torno de Saturno, entrando e saindo pela tangente
    const EXTRA = EXTRA_ORBITA;
    const naOrbita = (fi) =>
      C.clone()
        .addScaledVector(lado, -Math.cos(fi) * RAIO_ORBITA)
        .addScaledVector(dEnt, Math.sin(fi) * RAIO_ORBITA);
    const orbita = [];
    const total = Math.PI * 2 + EXTRA;
    const nOrb = Math.ceil(total / 0.22);
    for (let k = 0; k <= nOrb; k++) orbita.push(naOrbita((total * k) / nOrb));
    const saida = orbita[orbita.length - 1];
    const dSai = lado.clone().multiplyScalar(Math.sin(EXTRA)).addScaledVector(dEnt, Math.cos(EXTRA));
    const fim = saida.clone().addScaledVector(dSai, 28); // para logo depois da volta, ao lado de Saturno

    const pts = [
      inicio.clone(),
      new THREE.Vector3().lerpVectors(inicio, noBraco[0], 0.5),
      ...noBraco, // 1) por dentro do braço da galáxia
      new THREE.Vector3().lerpVectors(noBraco[noBraco.length - 1], entrada, 0.5), // 2) sobe até Saturno
      ...orbita, // 3) volta completa em Saturno
      new THREE.Vector3().lerpVectors(saida, fim, 0.5), // 4) desacelera e para ao lado de Saturno
      fim,
    ];
    this.curva = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
    this.curva.arcLengthDivisions = 8000;
    this.curva.updateArcLengths();
    this.L = this.curva.getLength(); // atualizado em amostrar() depois de arredondar o caminho

    // dados da órbita para a câmera que dá a volta junto
    this.saturno = C.clone();
    // eixo da volta (regra da mão direita: girar em torno dele leva a estrela para a frente)
    this.eixoOrbita = new THREE.Vector3().crossVectors(lado.clone().negate(), dEnt).normalize();
    // a câmera fica do lado de "cima" da órbita (o mesmo lado de cima da galáxia)
    this.cimaOrbita = this.eixoOrbita.clone().multiplyScalar(this.eixoOrbita.dot(galaxia.normal) >= 0 ? 1 : -1);

    // Marcos: o que pode ser destacado e quanto a estrela desacelera perto dele
    this.marcos = [
      { nome: 'galaxia', centro: galaxia.centro, raio: galaxia.raio },
      { nome: 'planeta', centro: planeta.centro, raio: planeta.raio },
    ];
    this.entradaOrbita = entrada.clone();
    this.saidaOrbita = saida.clone();

    this.amostrar();

    // onde (em s) começam e terminam o braço e a volta em Saturno
    this.sBracoIni = this.sMaisPerto(noBraco[0]);
    this.sBracoFim = this.sMaisPerto(noBraco[noBraco.length - 1]);
    this.sOrbIni = this.sMaisPerto(entrada);
    this.sOrbFim = this.sMaisPerto(saida, this.sOrbIni + 50);
    this.tabelaDeTempo();

    // ângulo (em volta de Saturno) onde a câmera começa a acompanhar a volta
    this.eixoCamera = this.eixoOrbita.clone();
    this.inicioCamera = lado.clone().negate().applyAxisAngle(this.eixoOrbita, -ATRASO_CAMERA);

    // Quanto a câmera já girou em volta de Saturno em cada ponto do caminho. No meio da volta ela
    // gira exatamente junto com a estrela (sempre ~35° atrás); na entrada e na saída acelera e
    // freia aos poucos, para não dar tranco.
    this.anguloCamera = new Float32Array(M + 1);
    const ds = this.L / M;
    let acumulado = 0;
    for (let i = 0; i <= M; i++) {
      const si = i * ds;
      acumulado += smoothstep(this.sOrbIni - 30, this.sOrbIni + 30, si) * (1 - smoothstep(this.sOrbFim - 30, this.sOrbFim + 30, si)) * ds;
      this.anguloCamera[i] = acumulado;
    }
    for (let i = 0; i <= M; i++) this.anguloCamera[i] *= GIRO_CAMERA_SATURNO / acumulado;

    // ao sair do braço a câmera vira para o lado de fora da volta (Saturno fica do outro lado)
    const T = new THREE.Vector3();
    const U = new THREE.Vector3();
    const R = new THREE.Vector3();
    this.quadro(this.sOrbIni, T, U, R);
    this.giroFinal = GIRO * (R.dot(lado) > 0 ? -1 : 1);
  }

  /** s do ponto do caminho mais perto de p (procurando a partir de `desde`). */
  sMaisPerto(p, desde = 0) {
    let melhor = 0;
    let menor = Infinity;
    const q = new THREE.Vector3();
    for (let i = Math.floor((desde / this.L) * M); i <= M; i++) {
      const d = this.pontoBase((i / M) * this.L, q).distanceToSquared(p);
      if (d < menor) [menor, melhor] = [d, (i / M) * this.L];
    }
    return melhor;
  }

  /** Proximidade (0..1) de um ponto a um marco. */
  peso(mc, p) {
    return smoothstep(mc.raio * 1.5, mc.raio * 0.55, p.distanceTo(mc.centro));
  }

  amostrar() {
    // 1) amostra a curva em passos iguais de comprimento
    const P0 = new Float32Array((M + 1) * 3);
    const p = new THREE.Vector3();
    const t = new THREE.Vector3();
    for (let i = 0; i <= M; i++) {
      this.curva.getPointAt(i / M, p);
      P0.set([p.x, p.y, p.z], i * 3);
    }

    // 2) "lixa" o caminho: média móvel das posições (duas passadas), arredondando qualquer quina.
    //    Perto do começo e do fim o efeito some, para a estrela sair e chegar exatamente nos pontos.
    const k = Math.max(1, Math.round((LIXA / this.L) * M));
    let Q = P0;
    for (let passada = 0; passada < 2; passada++) Q = mediaMovel(Q, k);
    const Ps = new Float32Array((M + 1) * 3);
    for (let i = 0; i <= M; i++) {
      const w = smoothstep(0, 1.2 * k, i) * smoothstep(M, M - 1.2 * k, i);
      for (let c = 0; c < 3; c++) Ps[i * 3 + c] = lerp(P0[i * 3 + c], Q[i * 3 + c], w);
    }

    // 3) reamostra o caminho lixado em passos iguais de comprimento
    const acum = new Float64Array(M + 1);
    for (let i = 1; i <= M; i++) {
      acum[i] = acum[i - 1] + Math.hypot(Ps[i * 3] - Ps[i * 3 - 3], Ps[i * 3 + 1] - Ps[i * 3 - 2], Ps[i * 3 + 2] - Ps[i * 3 - 1]);
    }
    this.L = acum[M];
    this.P = new Float32Array((M + 1) * 3);
    let j = 0;
    for (let i = 0; i <= M; i++) {
      const alvo = (i / M) * this.L;
      while (j < M - 1 && acum[j + 1] < alvo) j++;
      const f = (alvo - acum[j]) / (acum[j + 1] - acum[j] || 1);
      for (let c = 0; c < 3; c++) this.P[i * 3 + c] = lerp(Ps[j * 3 + c], Ps[(j + 1) * 3 + c], f);
    }

    // direção do movimento em cada ponto
    const T = new Float32Array((M + 1) * 3);
    for (let i = 0; i <= M; i++) {
      const a = Math.max(0, i - 1);
      const b = Math.min(M, i + 1);
      t.set(this.P[b * 3] - this.P[a * 3], this.P[b * 3 + 1] - this.P[a * 3 + 1], this.P[b * 3 + 2] - this.P[a * 3 + 2]).normalize();
      T.set([t.x, t.y, t.z], i * 3);
    }

    // Direção suavizada (média numa janela): é ela que orienta a câmera de perseguição,
    // então a câmera faz as curvas com calma em vez de virar junto com a estrela.
    this.T = new Float32Array((M + 1) * 3);
    const janela = Math.max(1, Math.round((SUAVIZAR / this.L) * M));
    const soma = [0, 0, 0];
    const somar = (i, sinal) => {
      for (let c = 0; c < 3; c++) soma[c] += sinal * T[i * 3 + c];
    };
    for (let i = 0; i <= Math.min(M, janela); i++) somar(i, 1);
    for (let i = 0; i <= M; i++) {
      if (i > 0 && i + janela <= M) somar(i + janela, 1);
      if (i - janela - 1 >= 0) somar(i - janela - 1, -1);
      t.fromArray(soma).normalize();
      this.T.set([t.x, t.y, t.z], i * 3);
    }

    // "Cima" da câmera: nivelado com o horizonte
    this.U = new Float32Array((M + 1) * 3);
    const cima = new THREE.Vector3(0, 1, 0);
    const u = new THREE.Vector3();
    for (let i = 0; i <= M; i++) {
      t.fromArray(this.T, i * 3);
      u.copy(cima).addScaledVector(t, -cima.dot(t)).normalize();
      this.U.set([u.x, u.y, u.z], i * 3);
    }
  }

  /** Velocidade relativa em cada ponto: rápida pelo braço da galáxia, mais calma na volta em Saturno. */
  fatorVelocidade(s) {
    let f = lerp(1, 0.5, smoothstep(this.sBracoFim - 40, this.sBracoFim + 10, s)); // freia na saída do braço
    f *= lerp(0.06, 1, smoothstep(0, this.L * 0.06, s));
    f *= lerp(0.08, 1, 1 - smoothstep(this.sOrbFim - 15, this.L, s));
    return f;
  }

  tabelaDeTempo() {
    this.tempo = new Float64Array(M + 1);
    this.fator = new Float32Array(M + 1);
    const p = new THREE.Vector3();
    const ds = this.L / M;
    for (let i = 0; i <= M; i++) {
      this.pontoBase(i * ds, p);
      this.fator[i] = this.fatorVelocidade(i * ds);
    }
    for (let i = 1; i <= M; i++) {
      this.tempo[i] = this.tempo[i - 1] + ds / ((this.fator[i - 1] + this.fator[i]) / 2);
    }
    const escala = this.duracao / this.tempo[M];
    for (let i = 0; i <= M; i++) this.tempo[i] *= escala;
    this.velMax = Math.max(...this.fator);
  }

  _interp(arr, s, out, normalizar) {
    const x = clamp(s / this.L, 0, 1) * M;
    const i = Math.min(M - 1, Math.floor(x));
    const f = x - i;
    const a = i * 3;
    const b = a + 3;
    out.set(lerp(arr[a], arr[b], f), lerp(arr[a + 1], arr[b + 1], f), lerp(arr[a + 2], arr[b + 2], f));
    return normalizar ? out.normalize() : out;
  }

  pontoBase(s, out) {
    return this._interp(this.P, s, out, false);
  }

  /** Orientação da câmera de perseguição em s (frente suavizada, cima e direita). */
  quadro(s, T, U, R) {
    this._interp(this.T, s, T, true);
    this._interp(this.U, s, U, true);
    U.addScaledVector(T, -U.dot(T)).normalize();
    R.crossVectors(T, U);
  }

  /** Distância percorrida (s) depois de `t` segundos de viagem. */
  sEm(t) {
    const tab = this.tempo;
    if (t <= 0) return 0;
    if (t >= tab[M]) return this.L;
    let lo = 0;
    let hi = M;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (tab[mid] <= t) lo = mid;
      else hi = mid;
    }
    const f = (t - tab[lo]) / (tab[hi] - tab[lo]);
    return ((lo + f) / M) * this.L;
  }

  /** Velocidade normalizada (0..1) no instante t. */
  velocidade(t) {
    const x = (this.sEm(t) / this.L) * M;
    const i = Math.min(M, Math.round(x));
    return this.fator[i] / this.velMax;
  }

  /** Posição da estrela no instante t da viagem. */
  estrelaEm(t, out) {
    return this.pontoBase(this.sEm(t), out);
  }

  /**
   * Câmera. Mistura duas "gruas":
   *  - perseguição: atrás da estrela (dentro do braço), virando para o lado ao sair dele;
   *  - Saturno: por fora da volta, dando a volta inteira em torno do planeta junto com a
   *    estrela. Depois da volta ela só se aproxima da estrela, sem girar, para a explosão final.
   * Preenche pos, alvo e cima; devolve o FOV.
   */
  camera(t, pos, alvo, cima) {
    const s = this.sEm(t);
    const estrela = this.pontoBase(s, (this._B ??= new THREE.Vector3()));

    // --- perseguição
    const T = (this._cT ??= new THREE.Vector3());
    const U = (this._cU ??= new THREE.Vector3());
    const R = (this._cR ??= new THREE.Vector3());
    this.quadro(s, T, U, R);
    const giro = this.giroFinal * smoothstep(this.sBracoIni, this.sOrbIni + 30, s);
    const pPers = (this._pP ??= new THREE.Vector3())
      .copy(estrela)
      .addScaledVector(T, -14 * Math.cos(giro))
      .addScaledVector(R, 14 * Math.sin(giro))
      .addScaledVector(U, 3.5);

    // --- Saturno: a câmera dá a volta inteira junto com a estrela
    const x = clamp(s / this.L, 0, 1) * M;
    const i0 = Math.min(M - 1, Math.floor(x));
    const ang = lerp(this.anguloCamera[i0], this.anguloCamera[i0 + 1], x - i0);
    const dirCam = (this._dc ??= new THREE.Vector3()).copy(this.inicioCamera).applyAxisAngle(this.eixoCamera, ang);
    const pSat = (this._pS ??= new THREE.Vector3())
      .copy(this.saturno)
      .addScaledVector(dirCam, RAIO_CAMERA)
      .addScaledVector(this.cimaOrbita, 20);
    const aSat = (this._aS ??= new THREE.Vector3()).lerpVectors(this.saturno, estrela, 0.3);

    // depois da volta: mesma linha de visão, chegando perto da estrela
    const fimDaVolta = smoothstep(this.sOrbFim, this.L, s);
    const perto = (this._pt ??= new THREE.Vector3()).subVectors(pSat, estrela);
    perto.setLength(lerp(perto.length(), 20, fimDaVolta)).add(estrela);
    aSat.lerp(estrela, fimDaVolta);

    // começa no meio do braço: a câmera vira aos poucos enquanto a estrela ainda está lá dentro
    const w = smoothstep((this.sBracoIni + this.sBracoFim) / 2, this.sOrbIni + 60, s);
    pos.lerpVectors(pPers, perto, w);
    alvo.lerpVectors(estrela, aSat, w);
    cima.copy(U).lerp(this.cimaOrbita, w).normalize();

    return 60 + 4 * smoothstep(0.6, 1, this.velocidade(t));
  }

  /**
   * Inclinação dos anéis de Saturno: quase no plano da volta (15° fora dele). Como a câmera
   * dá a volta inteira um pouco acima desse plano, os anéis aparecem abertos o tempo todo.
   */
  normalDosAneis() {
    return this.cimaOrbita.clone().multiplyScalar(Math.cos(0.26)).addScaledVector(this.inicioCamera, Math.sin(0.26)).normalize();
  }

  /** Quanto cada marco deve brilhar agora (estrela perto = destaque). */
  destaques(estrela) {
    const out = {};
    for (const mc of this.marcos) out[mc.nome] = smoothstep(mc.raio * 1.3, mc.raio * 0.35, estrela.distanceTo(mc.centro));
    return out;
  }

  /** Direção do movimento no fim da viagem (para a estrela continuar deslizando no final). */
  tangenteFinal(out) {
    const a = this.pontoBase(this.L, new THREE.Vector3());
    return this.pontoBase(this.L - 5, out).sub(a).negate().normalize();
  }
}
