import * as THREE from 'three';
import { smoothstep, janela, clamp, lerp } from './utils.js';

const M = 6000; // amostras ao longo do caminho
const SUAVIZAR = 35; // a câmera de perseguição segue a direção média de ±35 de caminho
const SUAVIZAR_ALTA = 40; // a câmera alta do sistema solar segue a posição média da estrela (±40)
const LIXA = 10; // o caminho é arredondado numa janela de ±10 (tira quinas sem encolher as curvas)
const GIRO = 0.85; // ~50°: quanto a câmera vira para o lado entre o braço da galáxia e o salto
const COMPRIMENTO_SALTO = 1400; // o salto é um trecho reto e longo, percorrido muito rápido
const FATOR_SALTO = 16; // ...a esta velocidade (em relação à normal)
const RAIO_ORBITA = 34; // a estrela dá a volta em Saturno a esta distância do centro (anéis vão até 28)
const RAIO_CAMERA = 60; // a câmera acompanha por fora, um pouco acima do plano da volta...
const ATRASO_CAMERA = 0.6; // ...sempre ~35° atrás da estrela
const EXTRA_ORBITA = THREE.MathUtils.degToRad(30); // a estrela dá 360° + 30° e sai pela tangente
const GIRO_CAMERA_SATURNO = Math.PI * 2 + EXTRA_ORBITA; // a câmera dá a volta inteira junto com ela
const DIRECAO_DO_BRACO = new THREE.Vector3(-0.25, 0, -1); // a estrela atravessa o braço indo "para dentro" da cena

// Sistema solar, em coordenadas locais (x = direção de chegada do salto, y = cima), antes da escala.
// Os planetas estão na posição do encontro: a estrela faz zigue-zague passando por eles.
const ESCALA_SISTEMA = 0.75;
const SISTEMA = {
  chegada: [-330, 20, -60],
  sol: [0, 0, -150],
  planetas: [
    [-200, 0, 20],
    [-90, 0, -70],
    [20, 0, 40],
    [130, 0, -50],
  ],
  saturno: [250, 0, 40],
};

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

/** Direções (normalizadas) suavizadas por média móvel com janela ±k amostras. */
function suavizarDirecoes(T, k) {
  const out = mediaMovel(T, k);
  const v = new THREE.Vector3();
  for (let i = 0; i < out.length; i += 3) {
    v.fromArray(out, i).normalize();
    v.toArray(out, i);
  }
  return out;
}

/** Pontos de um estilingue: um arco em volta do planeta P, por fora da curva, a distância rp. */
function estilingue(P, entra, sai, rp) {
  const angulo = entra.angleTo(sai);
  const frente = entra.clone().add(sai).normalize();
  const dentro = sai.clone().sub(entra).normalize();
  return [-1, -0.5, 0, 0.5, 1].map((f) => {
    const a = (f * angulo) / 2;
    return P.clone().addScaledVector(dentro, -Math.cos(a) * rp).addScaledVector(frente, Math.sin(a) * rp);
  });
}

/**
 * Planeja a rota antes de criar os planetas: posiciona a galáxia para a estrela entrar de
 * frente num braço, define o salto e onde ficam o sol, os planetas e Saturno.
 *
 * @param braco  { indice, raio, tempo }: o braço, a distância do núcleo onde a estrela o cruza
 *               e o instante aproximado da passagem (a galáxia gira devagar)
 * @param raios  raios dos quatro planetas do sistema solar (para o estilingue passar perto, mas fora)
 */
export function planejarRota(galaxia, inicio, braco, raios) {
  const { indice, raio, tempo } = braco;
  const MEIA_TRAVESSIA = 45; // a estrela fica ~90 unidades dentro do braço
  const n = galaxia.normal;

  // 1) gira a galáxia (em volta do eixo vertical) para o braço apontar para dentro da cena,
  //    e a coloca de modo que o braço comece 70 unidades à frente do ponto inicial
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

  // 2) atravessa o braço em linha reta, tangente a ele no meio (no plano do disco)
  const meio = galaxia.pontoDoBraco(indice, raio, tempo);
  const noBraco = [-1, -0.5, 0, 0.5, 1].map((f) => meio.clone().addScaledVector(dirBraco, f * MEIA_TRAVESSIA));
  const fimBraco = noBraco[noBraco.length - 1];

  // 3) sobe para fora do disco, "carrega" e salta em linha reta
  const preSalto = fimBraco.clone().addScaledVector(dirBraco, 90).addScaledVector(n, 25);
  const dirSalto = preSalto.clone().sub(fimBraco).normalize();
  const iniSalto = preSalto.clone().addScaledVector(dirSalto, 40);
  const fimSalto = iniSalto.clone().addScaledVector(dirSalto, COMPRIMENTO_SALTO);

  // 4) sistema solar onde o salto termina (x local = direção da chegada, plano horizontal)
  const ex = dirSalto.clone().setY(0).normalize();
  const cima = new THREE.Vector3(0, 1, 0);
  const ez = new THREE.Vector3().crossVectors(ex, cima);
  const local = ([x, y, z]) =>
    new THREE.Vector3()
      .addScaledVector(ex, x * ESCALA_SISTEMA)
      .addScaledVector(cima, y * ESCALA_SISTEMA)
      .addScaledVector(ez, z * ESCALA_SISTEMA);
  const origem = fimSalto.clone().sub(local(SISTEMA.chegada));
  const mundo = (c) => local(c).add(origem);
  const sol = mundo(SISTEMA.sol);
  const planetas = SISTEMA.planetas.map(mundo);
  const saturno = mundo(SISTEMA.saturno);

  // 5) entrada na volta de Saturno: vem do último planeta e continua a curva do último estilingue
  const ultimo = planetas[planetas.length - 1];
  const dEnt = saturno.clone().sub(ultimo).normalize();
  const dentroUltimo = dEnt.clone().sub(ultimo.clone().sub(planetas[planetas.length - 2]).normalize());
  const lado = dentroUltimo.addScaledVector(dEnt, -dentroUltimo.dot(dEnt)).normalize();
  const entrada = saturno.clone().addScaledVector(lado, -RAIO_ORBITA);

  return { noBraco, preSalto, iniSalto, fimSalto, sol, cima, planetas, raios, saturno, entrada, dEnt, lado };
}

/**
 * A viagem da estrela: atravessa um braço da galáxia, salta para um sistema solar, faz
 * estilingue em quatro planetas, dá uma volta completa em Saturno e para ao lado dele.
 * Também diz onde a câmera fica a cada instante.
 */
export class Viagem {
  constructor({ inicio, galaxia, planeta, rota }, duracao) {
    this.duracao = duracao;
    const { noBraco, preSalto, iniSalto, fimSalto, planetas, raios, entrada, dEnt, lado, cima } = rota;
    const C = planeta.centro;
    this.cimaSistema = cima.clone();
    // no sistema solar a câmera alta olha sempre na mesma direção: da chegada do salto para Saturno
    this.frenteSistema = C.clone().sub(fimSalto);
    this.frenteSistema.addScaledVector(cima, -this.frenteSistema.dot(cima)).normalize();

    // estilingues: cada planeta desvia a estrela, que passa por fora da curva
    const arcos = planetas.map((P, k) => {
      const antes = k === 0 ? fimSalto : planetas[k - 1];
      const depois = k === planetas.length - 1 ? entrada : planetas[k + 1];
      return estilingue(P, P.clone().sub(antes).normalize(), depois.clone().sub(P).normalize(), raios[k] + 12);
    });
    const fimArcos = arcos[arcos.length - 1][4];

    // volta completa (360° + um pouco) em torno de Saturno, entrando e saindo pela tangente
    const naOrbita = (fi) =>
      C.clone()
        .addScaledVector(lado, -Math.cos(fi) * RAIO_ORBITA)
        .addScaledVector(dEnt, Math.sin(fi) * RAIO_ORBITA);
    const orbita = [];
    const total = Math.PI * 2 + EXTRA_ORBITA;
    const nOrb = Math.ceil(total / 0.22);
    for (let k = 0; k <= nOrb; k++) orbita.push(naOrbita((total * k) / nOrb));
    const saida = orbita[orbita.length - 1];
    const dSai = lado.clone().multiplyScalar(Math.sin(EXTRA_ORBITA)).addScaledVector(dEnt, Math.cos(EXTRA_ORBITA));
    const fim = saida.clone().addScaledVector(dSai, 28); // para logo depois da volta, ao lado de Saturno

    const fimBraco = noBraco[noBraco.length - 1];
    const pts = [
      inicio.clone(),
      new THREE.Vector3().lerpVectors(inicio, noBraco[0], 0.5),
      ...noBraco, // 1) por dentro do braço da galáxia
      new THREE.Vector3().lerpVectors(fimBraco, preSalto, 0.5), // 2) sobe e carrega o salto
      preSalto,
      iniSalto,
      new THREE.Vector3().lerpVectors(iniSalto, fimSalto, 1 / 3), // 3) o salto
      new THREE.Vector3().lerpVectors(iniSalto, fimSalto, 2 / 3),
      fimSalto,
      ...arcos.flat(), // 4) estilingues no sistema solar
      new THREE.Vector3().lerpVectors(fimArcos, entrada, 0.5),
      ...orbita, // 5) volta completa em Saturno
      new THREE.Vector3().lerpVectors(saida, fim, 0.5), // 6) desacelera e para ao lado de Saturno
      fim,
    ];
    this.curva = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
    this.curva.arcLengthDivisions = 12000;
    this.curva.updateArcLengths();
    this.L = this.curva.getLength(); // atualizado em amostrar() depois de arredondar o caminho

    // dados da órbita para a câmera que dá a volta junto
    this.saturno = C.clone();
    // eixo da volta (regra da mão direita: girar em torno dele leva a estrela para a frente)
    this.eixoOrbita = new THREE.Vector3().crossVectors(lado.clone().negate(), dEnt).normalize();
    // a câmera fica do lado de "cima" da órbita (o mesmo lado de cima do sistema solar)
    this.cimaOrbita = this.eixoOrbita.clone().multiplyScalar(this.eixoOrbita.dot(cima) >= 0 ? 1 : -1);

    // Marcos que podem ser destacados (a galáxia e Saturno; os planetas cuidam de si)
    this.marcos = [
      { nome: 'galaxia', centro: galaxia.centro, raio: galaxia.raio },
      { nome: 'planeta', centro: planeta.centro, raio: planeta.raio },
    ];

    this.amostrar();

    // onde (em s) começa e termina cada trecho
    this.sBracoIni = this.sMaisPerto(noBraco[0]);
    this.sBracoFim = this.sMaisPerto(noBraco[noBraco.length - 1]);
    this.sSaltoIni = this.sMaisPerto(iniSalto);
    this.sSaltoFim = this.sMaisPerto(fimSalto, this.sSaltoIni);
    this.sPlanetas = planetas.map((P) => this.sMaisPerto(P, this.sSaltoFim));
    this.sOrbIni = this.sMaisPerto(entrada, this.sPlanetas[this.sPlanetas.length - 1]);
    this.sOrbFim = this.sMaisPerto(saida, this.sOrbIni + 50);
    this.tabelaDeTempo();

    // ângulo (em volta de Saturno) onde a câmera começa a acompanhar a volta
    this.inicioCamera = lado.clone().negate().applyAxisAngle(this.eixoOrbita, -ATRASO_CAMERA);

    // Quanto a câmera já girou em volta de Saturno em cada ponto do caminho. No meio da volta ela
    // gira exatamente junto com a estrela; na entrada e na saída acelera e freia aos poucos.
    this.anguloCamera = new Float32Array(M + 1);
    const ds = this.L / M;
    let acumulado = 0;
    for (let i = 0; i <= M; i++) {
      const si = i * ds;
      acumulado += smoothstep(this.sOrbIni - 30, this.sOrbIni + 30, si) * (1 - smoothstep(this.sOrbFim - 30, this.sOrbFim + 30, si)) * ds;
      this.anguloCamera[i] = acumulado;
    }
    for (let i = 0; i <= M; i++) this.anguloCamera[i] *= GIRO_CAMERA_SATURNO / acumulado;

    // ao sair do braço a câmera vira para o lado de fora (olhando de volta para o núcleo da galáxia)
    const T = new THREE.Vector3();
    const U = new THREE.Vector3();
    const R = new THREE.Vector3();
    this.quadro(this.sBracoFim, T, U, R);
    this.giroFinal = GIRO * (R.dot(galaxia.centro.clone().sub(fimBraco)) > 0 ? -1 : 1);
  }

  /** s do ponto do caminho mais perto de p (procurando a partir de `desde`). */
  sMaisPerto(p, desde = 0) {
    let melhor = 0;
    let menor = Infinity;
    for (let i = Math.floor((desde / this.L) * M); i <= M; i++) {
      const dx = this.P[i * 3] - p.x;
      const dy = this.P[i * 3 + 1] - p.y;
      const dz = this.P[i * 3 + 2] - p.z;
      const d = dx * dx + dy * dy + dz * dz;
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

    // Direções suavizadas: orientam as câmeras, que assim fazem as curvas com calma
    this.T = suavizarDirecoes(T, Math.max(1, Math.round((SUAVIZAR / this.L) * M)));
    // posição suavizada da estrela: a câmera alta a acompanha, então a estrela aparece
    // fazendo a curva em volta de cada planeta enquanto a câmera desliza sem girar
    const kA = Math.max(1, Math.round((SUAVIZAR_ALTA / this.L) * M));
    this.PA = mediaMovel(mediaMovel(this.P, kA), kA);

    // "Cima" da câmera de perseguição: nivelado com o horizonte
    this.U = new Float32Array((M + 1) * 3);
    const cima = new THREE.Vector3(0, 1, 0);
    const u = new THREE.Vector3();
    for (let i = 0; i <= M; i++) {
      t.fromArray(this.T, i * 3);
      u.copy(cima).addScaledVector(t, -cima.dot(t)).normalize();
      this.U.set([u.x, u.y, u.z], i * 3);
    }
  }

  /** Velocidade relativa em cada ponto do caminho. */
  fatorVelocidade(s) {
    let f = 1;
    // depois do braço, um pouco mais devagar: a estrela "carrega" o salto
    f *= lerp(1, 0.7, janela(s, this.sBracoFim - 20, this.sBracoFim + 30, this.sSaltoIni - 40, this.sSaltoIni));
    // o salto: acelera muito, cruza o espaço e freia ao chegar no sistema solar
    f *= lerp(1, FATOR_SALTO, smoothstep(this.sSaltoIni, this.sSaltoIni + 350, s) * (1 - smoothstep(this.sSaltoFim - 350, this.sSaltoFim, s)));
    // no sistema solar um pouco mais calma, e cada estilingue dá um empurrão perto do planeta
    f *= lerp(1, 0.85, smoothstep(this.sSaltoFim - 100, this.sSaltoFim, s));
    for (const sp of this.sPlanetas) f *= 1 + 0.18 * Math.exp(-(((s - sp) / 22) ** 2));
    // a volta em Saturno é mais lenta
    f *= lerp(1, 0.6, smoothstep(this.sOrbIni - 60, this.sOrbIni, s));
    // começo (sai do repouso) e fim (para ao lado de Saturno)
    f *= lerp(0.06, 1, smoothstep(0, 30, s));
    f *= lerp(0.08, 1, 1 - smoothstep(this.sOrbFim - 15, this.L, s));
    return f;
  }

  tabelaDeTempo() {
    this.tempo = new Float64Array(M + 1);
    this.fator = new Float32Array(M + 1);
    const ds = this.L / M;
    for (let i = 0; i <= M; i++) this.fator[i] = this.fatorVelocidade(i * ds);
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

  /** Em quantos segundos de viagem a estrela chega em s. */
  tempoDe(s) {
    const x = clamp(s / this.L, 0, 1) * M;
    const i = Math.min(M - 1, Math.floor(x));
    return lerp(this.tempo[i], this.tempo[i + 1], x - i);
  }

  /** Velocidade normalizada (0..1, 1 = auge do salto) no instante t. */
  velocidade(t) {
    const x = (this.sEm(t) / this.L) * M;
    const i = Math.min(M, Math.round(x));
    return this.fator[i] / this.velMax;
  }

  /** Intensidade do efeito do salto (0..1) no instante t da viagem. */
  intensidadeSalto(t) {
    return smoothstep(0.12, 0.55, this.velocidade(t));
  }

  /** Posição da estrela no instante t da viagem. */
  estrelaEm(t, out) {
    return this.pontoBase(this.sEm(t), out);
  }

  /** Um s qualquer do caminho, fora do salto (para espalhar poeira onde a câmera passa devagar). */
  sAleatorio(rand) {
    for (;;) {
      const s = rand() * this.L;
      if (s < this.sSaltoIni - 50 || s > this.sSaltoFim + 50) return s;
    }
  }

  /**
   * Câmera. Mistura três "gruas":
   *  - perseguição: atrás da estrela (no braço e no salto); vira para o lado ao sair do braço
   *    e volta para trás dela antes de saltar;
   *  - alta: no sistema solar, acima e atrás, mostrando os planetas e os estilingues;
   *  - Saturno: por fora da volta, dando a volta inteira junto com a estrela. Depois da volta
   *    ela só se aproxima da estrela, sem girar, para a explosão final.
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
    // vira para o lado e volta para trás da estrela numa onda só, do braço até o salto
    const giro = this.giroFinal * Math.sin(Math.PI * clamp((s - (this.sBracoIni - 40)) / (this.sSaltoIni + 40 - (this.sBracoIni - 40)))) ** 2;
    const pPers = (this._pP ??= new THREE.Vector3())
      .copy(estrela)
      .addScaledVector(T, -14 * Math.cos(giro))
      .addScaledVector(R, 14 * Math.sin(giro))
      .addScaledVector(U, 3.5);

    // --- alta (sistema solar): direção fixa, segue a posição suavizada da estrela
    const ancora = this._interp(this.PA, s, (this._an ??= new THREE.Vector3()), false);
    const pAlta = (this._pA ??= new THREE.Vector3())
      .copy(ancora)
      .addScaledVector(this.frenteSistema, -30)
      .addScaledVector(this.cimaSistema, 26);
    const aAlta = (this._aA ??= new THREE.Vector3()).copy(ancora).addScaledVector(this.frenteSistema, 10);

    // --- Saturno: a câmera dá a volta inteira junto com a estrela
    const x = clamp(s / this.L, 0, 1) * M;
    const i0 = Math.min(M - 1, Math.floor(x));
    const ang = lerp(this.anguloCamera[i0], this.anguloCamera[i0 + 1], x - i0);
    const dirCam = (this._dc ??= new THREE.Vector3()).copy(this.inicioCamera).applyAxisAngle(this.eixoOrbita, ang);
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

    // mistura suave entre as três
    const wAlta = smoothstep(this.sSaltoFim - 30, this.sSaltoFim + 90, s);
    const wSat = smoothstep(this.sOrbIni - 160, this.sOrbIni + 30, s);
    pos.lerpVectors(pPers, pAlta, wAlta).lerp(perto, wSat);
    alvo.copy(estrela).lerp(aAlta, wAlta).lerp(aSat, wSat);
    cima.copy(U).lerp(this.cimaSistema, wAlta).lerp(this.cimaOrbita, wSat).normalize();

    // no salto o campo de visão abre (sensação de velocidade)
    return 60 + 38 * this.intensidadeSalto(t);
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
