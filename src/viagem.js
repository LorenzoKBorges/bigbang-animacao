import * as THREE from 'three';
import { smoothstep, clamp, lerp } from './utils.js';

const CIMA = new THREE.Vector3(0, 1, 0);
const M = 3000; // amostras ao longo do caminho
const SUAVIZAR = 100; // a câmera segue a direção média de ±100 de caminho (faz as curvas com calma)
const GIRO = 0.95; // ~55°: a câmera gira de trás da estrela até o lado dela
const LIXA = 30; // o caminho é arredondado numa janela de ±30 unidades

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
 * A viagem da estrela pelo universo recém-nascido: o caminho, a velocidade em cada trecho
 * e onde a câmera fica a cada instante.
 */
export class Viagem {
  constructor(m, duracao) {
    this.duracao = duracao;
    const { inicio, galaxia, planeta, passagem, fim } = m;
    const sobreGal = Viagem.sobreGalaxia(galaxia);

    // Curva única e aberta (raio grande) que passa por `passagem`, ao lado de Saturno.
    // Ela vira exatamente o ângulo entre a chegada e a saída, então não há "quiques".
    const entra = passagem.clone().sub(sobreGal).normalize();
    const sai = fim.clone().sub(passagem).normalize();
    const angulo = entra.angleTo(sai);
    const frente = entra.clone().add(sai).normalize();
    const dentro = angulo > 0.05 ? sai.clone().sub(entra).normalize() : new THREE.Vector3(1, 0, 0);
    const RAIO_CURVA = 110;
    const centroCurva = passagem.clone().addScaledVector(dentro, RAIO_CURVA);
    const naCurva = (f) => {
      const a = (f * angulo) / 2;
      return centroCurva
        .clone()
        .addScaledVector(dentro, -Math.cos(a) * RAIO_CURVA)
        .addScaledVector(frente, Math.sin(a) * RAIO_CURVA);
    };

    const pts = [
      inicio.clone(),
      new THREE.Vector3().lerpVectors(inicio, sobreGal, 0.5),
      sobreGal, // 1) desliza por cima do núcleo da galáxia
      naCurva(-1), // 2) faz a curva passando ao lado de Saturno
      naCurva(-0.5),
      naCurva(0),
      naCurva(0.5),
      naCurva(1),
      new THREE.Vector3().lerpVectors(naCurva(1), fim, 0.5), // 3) segue reto, desacelerando
      fim.clone(),
    ];

    this.curva = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
    this.curva.arcLengthDivisions = 6000;
    this.curva.updateArcLengths();
    this.L = this.curva.getLength(); // atualizado em amostrar() depois de arredondar o caminho

    // Marcos: o que pode ser destacado, quanto a estrela desacelera e quanto a câmera olha para ele
    this.marcos = [
      { nome: 'galaxia', obj: galaxia, centro: galaxia.centro, raio: galaxia.raio, vel: 0.8, olhar: 0 },
      { nome: 'planeta', obj: planeta, centro: planeta.centro, raio: planeta.raio, vel: 0.7, olhar: 0.12 },
    ];

    this.amostrar();
    this.tabelaDeTempo();

    // A câmera gira para o lado de fora da curva: assim Saturno aparece atrás da estrela
    // (e a câmera nunca passa por dentro dos anéis).
    let maisPerto = 0;
    let menor = Infinity;
    const q = new THREE.Vector3();
    for (let i = 0; i <= M; i += 5) {
      const d = this.pontoBase((i / M) * this.L, q).distanceTo(planeta.centro);
      if (d < menor) [menor, maisPerto] = [d, (i / M) * this.L];
    }
    const T = new THREE.Vector3();
    const U = new THREE.Vector3();
    const R = new THREE.Vector3();
    this.quadro(maisPerto, T, U, R);
    this.giroFinal = GIRO * (R.dot(planeta.centro.clone().sub(this.pontoBase(maisPerto, q))) > 0 ? -1 : 1);
  }

  /** Ponto por cima do núcleo da galáxia por onde a estrela passa. */
  static sobreGalaxia(galaxia) {
    return galaxia.centro.clone().addScaledVector(galaxia.normal, 40);
  }

  /** Onde Saturno fica: do lado de dentro da curva que a estrela faz em `passagem`. */
  static centroDeSaturno(galaxia, passagem, fim, distancia) {
    const entra = passagem.clone().sub(Viagem.sobreGalaxia(galaxia)).normalize();
    const sai = fim.clone().sub(passagem).normalize();
    return passagem.clone().addScaledVector(sai.sub(entra).normalize(), distancia);
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

    // Direção suavizada (média numa janela): é ela que orienta a câmera,
    // então a câmera faz as curvas com calma em vez de virar junto com a estrela.
    this.T = new Float32Array((M + 1) * 3);
    const janela = Math.max(1, Math.round((SUAVIZAR / this.L) * M));
    const soma = [0, 0, 0];
    const somar = (i, sinal) => {
      for (let k = 0; k < 3; k++) soma[k] += sinal * T[i * 3 + k];
    };
    for (let i = 0; i <= Math.min(M, janela); i++) somar(i, 1);
    for (let i = 0; i <= M; i++) {
      if (i > 0 && i + janela <= M) somar(i + janela, 1);
      if (i - janela - 1 >= 0) somar(i - janela - 1, -1);
      t.fromArray(soma).normalize();
      this.T.set([t.x, t.y, t.z], i * 3);
    }

    // "Cima" da câmera: acompanha a direção suavizada e fica nivelado com o horizonte
    this.U = new Float32Array((M + 1) * 3);
    const u = new THREE.Vector3();
    for (let i = 0; i <= M; i++) {
      t.fromArray(this.T, i * 3);
      u.copy(CIMA).addScaledVector(t, -CIMA.dot(t)).normalize();
      this.U.set([u.x, u.y, u.z], i * 3);
    }
  }

  /** Velocidade relativa em cada ponto: um pouco mais devagar perto do que vale a pena ver. */
  fatorVelocidade(s, p) {
    let f = 1;
    for (const mc of this.marcos) f += (mc.vel - 1) * this.peso(mc, p);
    f *= lerp(0.06, 1, smoothstep(0, this.L * 0.12, s));
    f *= lerp(0.06, 1, 1 - smoothstep(this.L * 0.88, this.L, s));
    return f;
  }

  tabelaDeTempo() {
    this.tempo = new Float64Array(M + 1);
    this.fator = new Float32Array(M + 1);
    const p = new THREE.Vector3();
    const ds = this.L / M;
    for (let i = 0; i <= M; i++) {
      this.pontoBase(i * ds, p);
      this.fator[i] = this.fatorVelocidade(i * ds, p);
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

  /** Orientação da câmera em s (frente suavizada, cima e direita). */
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

  /** Câmera que acompanha a estrela. Preenche pos, alvo e cima; devolve o FOV. */
  camera(t, pos, alvo, cima) {
    const s = this.sEm(t);
    const base = this.pontoBase(s, (this._B ??= new THREE.Vector3()));
    const T = (this._cT ??= new THREE.Vector3());
    const U = (this._cU ??= new THREE.Vector3());
    const R = (this._cR ??= new THREE.Vector3());
    this.quadro(s, T, U, R);

    let wMax = 0;
    alvo.copy(base);
    const finalzinho = 1 - smoothstep(this.L * 0.75, this.L * 0.95, s); // no fim, só a estrela importa
    const desvio = (this._desvio ??= new THREE.Vector3()).set(0, 0, 0);
    for (const mc of this.marcos) {
      const d = this._d(mc.centro, base);
      // só puxa o olhar para o que está do lado ou à frente (nunca para trás da câmera)
      const aFrente = smoothstep(-0.7, 0.5, d.dot(T) / (d.length() + 1e-6));
      const w = this.peso(mc, base) * finalzinho;
      wMax = Math.max(wMax, w);
      desvio.addScaledVector(d, mc.olhar * w * aFrente);
    }
    alvo.add(desvio.clampLength(0, 9));

    const atras = 14 + 4 * wMax;
    const altura = 3.5 + 2 * wMax;

    // Um único giro lento em volta da estrela: começa atrás dela e termina ao lado,
    // exatamente onde a câmera fica para assistir a explosão final.
    const giro = this.giroFinal * smoothstep(this.L * 0.08, this.L * 0.92, s);

    const off = (this._off ??= new THREE.Vector3());
    off.copy(T).multiplyScalar(-atras * Math.cos(giro)).addScaledVector(R, atras * Math.sin(giro)).addScaledVector(U, altura);
    cima.copy(U);
    pos.copy(base).add(off);

    return 60 + 5 * smoothstep(0.6, 1, this.velocidade(t));
  }

  /** Direção (no fim da viagem) de onde a câmera assiste a explosão. */
  ladoFinal(out) {
    const T = new THREE.Vector3();
    const U = new THREE.Vector3();
    const R = new THREE.Vector3();
    this.quadro(this.L, T, U, R);
    return out
      .copy(T)
      .multiplyScalar(-Math.cos(this.giroFinal))
      .addScaledVector(R, Math.sin(this.giroFinal))
      .addScaledVector(U, 0.25)
      .normalize();
  }

  _d(a, b) {
    return (this._dv ??= new THREE.Vector3()).subVectors(a, b);
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
