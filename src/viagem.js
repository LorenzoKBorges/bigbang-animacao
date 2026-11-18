import * as THREE from 'three';
import { smoothstep, clamp, lerp } from './utils.js';
import { PLANETAS, ORBITA_SATURNO, SistemaSolar } from './sistema.js';

const M = 6000; // amostras ao longo do caminho
const SUAVIZAR = 35; // a câmera de perseguição segue a direção média de ±35 de caminho
const LIXA = 10; // o caminho é arredondado numa janela de ±10 (tira quinas sem encolher as curvas)
const LIXA_SISTEMA = 30; // entre os planetas o arredondamento é bem maior (curvas abertas, sem quinas)
const AMPLIACAO = 400; // a "lupa" amplia o pontinho do braço 400 vezes até virar o sistema solar
const FATOR_LUPA = 4.5; // velocidade (relativa) com que a ampliação acontece
const DISTANCIA_CAMERA = 400; // de onde a câmera vê o sistema solar inteiro
const ELEVACAO_CAMERA = THREE.MathUtils.degToRad(28); // ...e quão acima do plano das órbitas
const INCLINACAO_SISTEMA = THREE.MathUtils.degToRad(55); // plano das órbitas x disco da galáxia
const DERIVA_CAMERA = THREE.MathUtils.degToRad(35); // a câmera gira devagar em volta do sistema
const RAIO_ORBITA = 34; // a volta em Saturno começa a esta distância do centro (anéis vão até 28)...
const VARIACAO_ORBITA = 12; // ...abre até 46 do outro lado (volta menos "certinha")...
const BALANCO_ORBITA = 5; // ...e sobe e desce um pouco
const RAIO_CAMERA = 74; // a câmera acompanha por fora, um pouco acima do plano da volta...
const ATRASO_CAMERA = 0.6; // ...sempre ~35° atrás da estrela
const EXTRA_ORBITA = THREE.MathUtils.degToRad(30); // a estrela dá 360° + 30° e sai pela tangente
const GIRO_CAMERA_SATURNO = Math.PI * 2 + EXTRA_ORBITA; // a câmera dá a volta inteira junto com ela
const DIRECAO_DO_BRACO = new THREE.Vector3(-0.25, 0, -1); // a estrela atravessa o braço indo "para dentro" da cena
// De Júpiter a Mercúrio a câmera desce e segue a estrela girando em volta da direção dela (espiral)
const VOLTAS_ESPIRAL = 1;
const ESPIRAL_RAIO = 8;
const ESPIRAL_ATRAS = 13;

// Rota no sistema solar: onde (ângulo na órbita, em graus) cada planeta está quando a estrela passa.
// A estrela começa em Netuno, vai para Vênus, Júpiter, volta para Mercúrio e voa para Saturno.
const GIRO_DA_ROTA = 0; // gira a rota inteira em volta do sol (ajuste fino do enquadramento)
const DESVIO_LUPA = 15; // graus: a estrela passa um pouco ao lado do pontinho (não por cima dele)
const ROTA = [
  { nome: 'netuno', graus: 248 },
  { nome: 'venus', graus: 20 },
  { nome: 'jupiter', graus: 100 },
  { nome: 'mercurio', graus: 150 },
];
const GRAUS_SATURNO = 190;
const CHEGADA_NETUNO = -10; // direção (graus) em que a estrela chega em Netuno

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

/**
 * Pontos de um estilingue: uma hipérbole em volta do planeta P (como a trajetória de verdade),
 * passando por fora da curva a uma distância mínima rp. A estrela chega de lado, faz uma curva
 * aberta e sai pela tangente; quanto maior o desvio, mais ela "abraça" o planeta.
 */
function estilingue(P, entra, sai, rp) {
  const desvio = Math.max(entra.angleTo(sai), 0.25);
  const e = 1 / Math.sin(desvio / 2); // excentricidade que dá exatamente esse desvio
  const assintota = Math.acos(-1 / e);
  // desenha cada lado até a distância ficar ~2,4x a mínima (o resto vira a ligação com o próximo)
  const limite = Math.min(Math.acos(clamp(((1 + e) / 2.4 - 1) / e, -1, 1)), assintota * 0.9);
  const fora = entra.clone().sub(sai).normalize();
  const frente = entra.clone().add(sai).normalize();
  const pts = [];
  for (let k = -4; k <= 4; k++) {
    const th = (k / 4) * limite;
    const r = (rp * (1 + e)) / (1 + e * Math.cos(th));
    pts.push(P.clone().addScaledVector(fora, Math.cos(th) * r).addScaledVector(frente, Math.sin(th) * r));
  }
  return pts;
}

/**
 * Planeja a rota antes de criar o sistema solar: posiciona a galáxia para a estrela entrar de
 * frente num braço, escolhe o pontinho do braço que a lupa vai ampliar (onde fica o sol) e
 * define a orientação do sistema, a câmera e por onde a estrela passa.
 *
 * @param braco  { indice, raio, tempo }: o braço, a distância do núcleo onde a estrela o cruza
 *               e o instante aproximado da passagem (a galáxia gira devagar)
 */
export function planejarRota(galaxia, inicio, braco) {
  const { indice, raio, tempo } = braco;
  const MEIA_TRAVESSIA = 45; // a estrela fica ~90 unidades dentro do braço

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
  const n = galaxia.normal;

  // 2) atravessa o braço em linha reta, tangente a ele no meio (no plano do disco)
  const meio = galaxia.pontoDoBraco(indice, raio, tempo);
  const noBraco = [-1, -0.5, 0, 0.5, 1].map((f) => meio.clone().addScaledVector(dirBraco, f * MEIA_TRAVESSIA));
  const fimBraco = noBraco[noBraco.length - 1];

  // 3) o pontinho do braço onde está o sistema solar: o ponto de braço mais "à frente" da estrela
  let melhor = null;
  for (let b = 0; b < 3; b++) {
    for (let r = 15; r <= 112; r++) {
      const p = galaxia.pontoDoBraco(b, r, tempo);
      const d = p.clone().sub(fimBraco);
      const dist = d.length();
      if (dist < 70 || dist > 220) continue;
      const nota = THREE.MathUtils.radToDeg(d.normalize().angleTo(dirBraco)) + Math.max(0, 100 - dist) * 0.3;
      if (!melhor || nota < melhor.nota) melhor = { p, nota };
    }
  }
  const sol = melhor.p;
  const antesDoPontinho = fimBraco.clone().addScaledVector(dirBraco, 45);
  const dChegada = sol.clone().sub(antesDoPontinho).normalize(); // a estrela chega no pontinho nesta direção

  // 4) orientação do sistema: plano das órbitas inclinado em volta da direção de chegada (assim a
  //    estrela chega no plano das órbitas); a câmera fica atrás, do lado de onde a estrela vem
  const cima = n.clone().applyAxisAngle(dChegada, INCLINACAO_SISTEMA).normalize();
  const e1 = dChegada.clone().negate();
  const e2 = new THREE.Vector3().crossVectors(e1, cima);
  const base = { sol, e1, e2, cima };
  // câmera da lupa e do sistema: perto do plano da galáxia, para ela virar uma faixa atrás do sistema
  const camera = sol
    .clone()
    .addScaledVector(e1, Math.cos(ELEVACAO_CAMERA) * DISTANCIA_CAMERA)
    .addScaledVector(cima, Math.sin(ELEVACAO_CAMERA) * DISTANCIA_CAMERA);
  const mundo = (local) =>
    new THREE.Vector3().addScaledVector(e1, local.x).addScaledVector(cima, local.y).addScaledVector(e2, local.z).add(sol);

  // 5) gira a rota em volta do sol para o ponto de onde a estrela começa (fora de Netuno) ficar
  //    bem na frente da direção de chegada: durante a lupa ela segue reto, sem curva
  const netunoTipo = PLANETAS.find((x) => x.nome === 'netuno');
  const inicioLocal = (giro) => {
    const a = THREE.MathUtils.degToRad(CHEGADA_NETUNO + giro);
    return SistemaSolar.local(netunoTipo.orbita, ROTA[0].graus + giro).add(new THREE.Vector3(-Math.cos(a) * 80, 0, -Math.sin(a) * 80));
  };
  const i0 = inicioLocal(0);
  const giro = 180 + DESVIO_LUPA - THREE.MathUtils.radToDeg(Math.atan2(i0.z, i0.x)) + GIRO_DA_ROTA;
  const encontros = ROTA.map(({ nome, graus }) => {
    const p = PLANETAS.find((x) => x.nome === nome);
    return { nome, graus: graus + giro, raio: p.raio, pos: mundo(SistemaSolar.local(p.orbita, graus + giro)) };
  });
  const grausSaturno = GRAUS_SATURNO + giro;
  const saturno = mundo(SistemaSolar.local(ORBITA_SATURNO, grausSaturno));
  const inicioSistema = mundo(inicioLocal(giro));

  // 6) antes da lupa o sistema é 30x menor: a estrela passa pelo pontinho e para logo depois dele
  const sigma0 = 1 / AMPLIACAO;
  const fimAproximacao = sol.clone().lerp(inicioSistema, sigma0);

  // 7) entrada na volta de Saturno: vem de Mercúrio e continua a curva do último estilingue
  const ultimo = encontros[encontros.length - 1].pos;
  const dEnt = saturno.clone().sub(ultimo).normalize();
  const dentroUltimo = dEnt.clone().sub(ultimo.clone().sub(encontros[encontros.length - 2].pos).normalize());
  const lado = dentroUltimo.addScaledVector(dEnt, -dentroUltimo.dot(dEnt)).normalize();
  const entrada = saturno.clone().addScaledVector(lado, -RAIO_ORBITA);

  return {
    noBraco,
    base,
    camera,
    sigma0,
    antesDoPontinho,
    fimAproximacao,
    inicioSistema,
    encontros,
    grausSaturno,
    saturno,
    entrada,
    dEnt,
    lado,
  };
}

/**
 * A viagem da estrela: atravessa um braço da galáxia, voa até um pontinho do braço que a lupa
 * amplia até virar o sistema solar, passa por Netuno, Vênus, Júpiter e Mercúrio (estilingue em
 * cada um), dá uma volta completa em Saturno e para ao lado dele.
 * Também diz onde a câmera fica a cada instante e quanto a lupa está ampliando.
 */
export class Viagem {
  constructor({ inicio, galaxia, planeta, rota }, duracao) {
    this.duracao = duracao;
    const { noBraco, base, antesDoPontinho, fimAproximacao, inicioSistema, encontros, entrada, dEnt, lado } = rota;
    const C = planeta.centro;
    this.sol = base.sol.clone();
    this.cimaSistema = base.cima.clone();
    this.cameraSistema = rota.camera.clone();
    this.sigma0 = rota.sigma0;
    this.distanciaLupa = inicioSistema.distanceTo(this.sol);

    // estilingues: cada planeta desvia a estrela, que passa por fora da curva
    const arcos = encontros.map((e, k) => {
      const antes = k === 0 ? inicioSistema : encontros[k - 1].pos;
      const depois = k === encontros.length - 1 ? entrada : encontros[k + 1].pos;
      return estilingue(e.pos, e.pos.clone().sub(antes).normalize(), depois.clone().sub(e.pos).normalize(), e.raio * 1.6 + 9);
    });
    const fimArcos = arcos[arcos.length - 1].at(-1);

    // volta completa (360° + um pouco) em torno de Saturno, entrando e saindo pela tangente;
    // o raio abre do outro lado e a estrela sobe e desce um pouco (volta menos "certinha")
    const eixo = new THREE.Vector3().crossVectors(lado.clone().negate(), dEnt).normalize();
    const naOrbita = (fi) => {
      const r = RAIO_ORBITA + VARIACAO_ORBITA * Math.sin(fi / 2) ** 2;
      return C.clone()
        .addScaledVector(lado, -Math.cos(fi) * r)
        .addScaledVector(dEnt, Math.sin(fi) * r)
        .addScaledVector(eixo, BALANCO_ORBITA * Math.sin(fi));
    };
    const orbita = [];
    const total = Math.PI * 2 + EXTRA_ORBITA;
    const nOrb = Math.ceil(total / 0.22);
    for (let k = 0; k <= nOrb; k++) orbita.push(naOrbita((total * k) / nOrb));
    const saida = orbita[orbita.length - 1];
    const dSai = saida.clone().sub(naOrbita(total - 0.01)).normalize();
    const fim = saida.clone().addScaledVector(dSai, 28); // para logo depois da volta, ao lado de Saturno

    const fimBraco = noBraco[noBraco.length - 1];
    const naLupa = (f) => this.sol.clone().lerp(inicioSistema, f);
    const pts = [
      inicio.clone(),
      new THREE.Vector3().lerpVectors(inicio, noBraco[0], 0.5),
      ...noBraco, // 1) por dentro do braço da galáxia
      antesDoPontinho, // 2) voa até o pontinho do braço e quase para
      new THREE.Vector3().lerpVectors(antesDoPontinho, fimAproximacao, 0.5),
      fimAproximacao,
      naLupa(0.12), // 3) a lupa: a estrela vai do pontinho até fora da órbita de Netuno
      naLupa(0.3),
      naLupa(0.6),
      inicioSistema,
      ...arcos.flat(), // 4) Netuno, Vênus, Júpiter e Mercúrio
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
    this.eixoOrbita = eixo;
    // a câmera fica do lado de "cima" da órbita (o mesmo lado de cima do sistema solar)
    this.cimaOrbita = this.eixoOrbita.clone().multiplyScalar(this.eixoOrbita.dot(this.cimaSistema) >= 0 ? 1 : -1);

    // Marcos que podem ser destacados (Saturno; os outros planetas cuidam de si)
    this.marcos = [{ nome: 'planeta', centro: planeta.centro, raio: planeta.raio }];

    this.amostrar(inicioSistema, entrada);

    // onde (em s) começa e termina cada trecho
    this.sBracoIni = this.sMaisPerto(noBraco[0]);
    this.sBracoFim = this.sMaisPerto(fimBraco);
    this.sLupaIni = this.sMaisPerto(fimAproximacao, this.sBracoFim);
    this.sLupaFim = this.sMaisPerto(inicioSistema, this.sLupaIni);
    this.sPlanetas = encontros.map((e) => this.sMaisPerto(e.pos, this.sLupaFim));
    this.encontros = encontros.map((e, k) => ({ nome: e.nome, graus: e.graus, s: this.sPlanetas[k] }));
    // (a volta passa duas vezes perto da entrada: procura só logo depois de Mercúrio)
    const sUltimo = this.sPlanetas[this.sPlanetas.length - 1];
    this.sOrbIni = this.sMaisPerto(entrada, sUltimo, sUltimo + 1.6 * encontros.at(-1).pos.distanceTo(entrada) + 40);
    this.sOrbFim = this.sMaisPerto(saida, this.sOrbIni + 120);

    // quanto a lupa amplia em cada ponto (1/30 antes, 1 depois): no trecho da lupa a estrela
    // está sempre em sol + ampliação x (início do sistema - sol), ou seja, parada no sistema ampliado
    this.ampliacaoEm = new Float32Array(M + 1);
    let maior = this.sigma0;
    const q = new THREE.Vector3();
    for (let i = 0; i <= M; i++) {
      const s = (i / M) * this.L;
      let a = this.sigma0;
      if (s >= this.sLupaFim) a = 1;
      else if (s > this.sLupaIni) a = clamp(this.pontoBase(s, q).distanceTo(this.sol) / this.distanciaLupa, this.sigma0, 1);
      maior = Math.max(maior, a);
      this.ampliacaoEm[i] = s > this.sLupaIni ? maior : this.sigma0;
    }

    this.tabelaDeTempo();
    // o recuo da câmera é medido em tempo (a estrela sai do braço rápida e vai freando)
    this.tRecuoIni = this.tempoDe(this.sBracoFim - 10);
    this.tRecuoFim = this.tempoDe(this.sLupaIni - 10);

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

    // Espiral de Júpiter a Mercúrio: quanto a câmera já girou em volta da direção da estrela,
    // acelerando e freando aos poucos; e quando ela desce da vista de longe para perto da estrela
    const [, , sJ, sM] = this.sPlanetas;
    // (o giro começa depois que a estrela termina a curva em volta de Júpiter)
    const giroIni = sJ + 35;
    const giroFim = sM - 10;
    const rampa = (giroFim - giroIni) * 0.25;
    this.anguloEspiral = new Float32Array(M + 1);
    acumulado = 0;
    for (let i = 0; i <= M; i++) {
      const si = i * ds;
      acumulado += smoothstep(giroIni, giroIni + rampa, si) * (1 - smoothstep(giroFim - rampa, giroFim, si)) * ds;
      this.anguloEspiral[i] = acumulado;
    }
    for (let i = 0; i <= M; i++) this.anguloEspiral[i] *= (VOLTAS_ESPIRAL * Math.PI * 2) / acumulado;
    this.tEspiralIni = this.tempoDe(sJ) - 0.6;
    this.tEspiralCheia = this.tempoDe(sJ) + 0.25;
  }

  /** s do ponto do caminho mais perto de p (procurando entre `desde` e `ate`). */
  sMaisPerto(p, desde = 0, ate = Infinity) {
    let melhor = desde;
    let menor = Infinity;
    const fim = Math.min(M, Math.floor((ate / this.L) * M));
    for (let i = Math.floor((desde / this.L) * M); i <= fim; i++) {
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

  /** Índice da amostra mais perto de p (procurando a partir de `desde`). */
  static maisPerto(P, p, desde = 0) {
    let melhor = desde;
    let menor = Infinity;
    for (let i = desde; i <= M; i++) {
      const d = (P[i * 3] - p.x) ** 2 + (P[i * 3 + 1] - p.y) ** 2 + (P[i * 3 + 2] - p.z) ** 2;
      if (d < menor) [menor, melhor] = [d, i];
    }
    return melhor;
  }

  /** inicioSistema/entradaSaturno: entre esses pontos o caminho é arredondado com mais força. */
  amostrar(inicioSistema, entradaSaturno) {
    // 1) amostra a curva em passos iguais de comprimento
    let P0 = new Float32Array((M + 1) * 3);
    const p = new THREE.Vector3();
    const t = new THREE.Vector3();
    for (let i = 0; i <= M; i++) {
      this.curva.getPointAt(i / M, p);
      P0.set([p.x, p.y, p.z], i * 3);
    }

    // 1b) no sistema solar (dos estilingues até a entrada em Saturno) arredonda bem mais,
    //     para as ligações entre os planetas virarem curvas abertas, sem quinas
    const iSis = Viagem.maisPerto(P0, inicioSistema);
    // (a volta em Saturno passa duas vezes perto da entrada: fica com a primeira passagem)
    let iSat = Viagem.maisPerto(P0, entradaSaturno, iSis);
    const dSat = (j) => Math.hypot(P0[j * 3] - entradaSaturno.x, P0[j * 3 + 1] - entradaSaturno.y, P0[j * 3 + 2] - entradaSaturno.z);
    for (let j = iSis; j < iSat; j++) {
      if (dSat(j) < 3) {
        iSat = j;
        break;
      }
    }
    const kS = Math.max(1, Math.round((LIXA_SISTEMA / this.L) * M));
    const forte = mediaMovel(mediaMovel(P0, kS), kS);
    const P1 = new Float32Array(P0.length);
    for (let i = 0; i <= M; i++) {
      const w = smoothstep(iSis, iSis + 2 * kS, i) * (1 - smoothstep(iSat - 3 * kS, iSat - kS, i));
      for (let c = 0; c < 3; c++) P1[i * 3 + c] = lerp(P0[i * 3 + c], forte[i * 3 + c], w);
    }
    P0 = P1;

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

    // direção do movimento em cada ponto, suavizada: orienta a câmera de perseguição
    const T = new Float32Array((M + 1) * 3);
    for (let i = 0; i <= M; i++) {
      const a = Math.max(0, i - 1);
      const b = Math.min(M, i + 1);
      t.set(this.P[b * 3] - this.P[a * 3], this.P[b * 3 + 1] - this.P[a * 3 + 1], this.P[b * 3 + 2] - this.P[a * 3 + 2]).normalize();
      T.set([t.x, t.y, t.z], i * 3);
    }
    this.T = suavizarDirecoes(T, Math.max(1, Math.round((SUAVIZAR / this.L) * M)));

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
  fatorVelocidade(s, ampliacao) {
    let f = 1;
    if (s < this.sLupaIni) {
      // voa até o pontinho do braço freando (quanto mais perto, mais devagar)
      const x = clamp((this.sLupaIni - s) / (this.sLupaIni - this.sBracoFim));
      if (s > this.sBracoFim) f = lerp(FATOR_LUPA * this.sigma0, 0.55, Math.sqrt(x));
    } else if (s < this.sLupaFim) {
      // na lupa a velocidade cresce junto com a ampliação (o zoom parece constante)
      f = lerp(FATOR_LUPA * ampliacao, 1, smoothstep(0.55, 1, ampliacao));
    } else {
      // no sistema solar cada estilingue dá um empurrão perto do planeta
      for (const sp of this.sPlanetas) f *= 1 + 0.18 * Math.exp(-(((s - sp) / 22) ** 2));
      // de Júpiter a Mercúrio mais devagar: a câmera vem junto, girando em volta da estrela
      const [, , sJ, sM] = this.sPlanetas;
      f *= lerp(1, 0.45, smoothstep(sJ - 40, sJ + 20, s) * (1 - smoothstep(sM - 20, sM + 30, s)));
      // a volta em Saturno é mais lenta
      f *= lerp(1, 0.42, smoothstep(this.sOrbIni - 60, this.sOrbIni, s));
    }
    // começo (sai do repouso) e fim (para ao lado de Saturno)
    f *= lerp(0.06, 1, smoothstep(0, 30, s));
    f *= lerp(0.2, 1, 1 - smoothstep(this.sOrbFim - 15, this.L, s));
    return f;
  }

  tabelaDeTempo() {
    this.tempo = new Float64Array(M + 1);
    this.fator = new Float32Array(M + 1);
    const ds = this.L / M;
    for (let i = 0; i <= M; i++) this.fator[i] = this.fatorVelocidade(i * ds, this.ampliacaoEm[i]);
    for (let i = 1; i <= M; i++) {
      this.tempo[i] = this.tempo[i - 1] + ds / ((this.fator[i - 1] + this.fator[i]) / 2);
    }
    const escala = this.duracao / this.tempo[M];
    for (let i = 0; i <= M; i++) this.tempo[i] *= escala;
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

  _interp1(arr, s) {
    const x = clamp(s / this.L, 0, 1) * M;
    const i = Math.min(M - 1, Math.floor(x));
    return lerp(arr[i], arr[i + 1], x - i);
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
    return this._interp1(this.tempo, s);
  }

  /** Quanto a lupa está ampliando no instante t da viagem (1/30 antes da lupa, 1 depois). */
  ampliacao(t) {
    return this._interp1(this.ampliacaoEm, this.sEm(t));
  }

  /** Posição da estrela no instante t da viagem. */
  estrelaEm(t, out) {
    return this.pontoBase(this.sEm(t), out);
  }

  /** Um s qualquer antes da lupa (para espalhar poeira onde a câmera passa perto). */
  sAleatorio(rand) {
    return rand() * (this.sLupaIni - 30);
  }

  /**
   * Câmera. Mistura três "gruas":
   *  - perseguição: atrás da estrela, no braço da galáxia;
   *  - de longe: recua até ver a galáxia inteira, fica parada durante a lupa e depois mostra o
   *    sistema solar inteiro, girando devagar em volta dele;
   *  - Saturno: por fora da volta, dando a volta inteira junto com a estrela. Depois da volta
   *    ela só se aproxima da estrela, sem girar, para a explosão final.
   * Preenche pos, alvo e cima; devolve o FOV.
   */
  camera(t, pos, alvo, cima) {
    const s = this.sEm(t);
    const estrela = this.pontoBase(s, (this._B ??= new THREE.Vector3()));
    const [, , sJupiter, sMercurio] = this.sPlanetas;

    // --- perseguição
    const T = (this._cT ??= new THREE.Vector3());
    const U = (this._cU ??= new THREE.Vector3());
    const R = (this._cR ??= new THREE.Vector3());
    this.quadro(s, T, U, R);
    const pPers = (this._pP ??= new THREE.Vector3()).copy(estrela).addScaledVector(T, -14).addScaledVector(U, 3.5);

    // --- de longe (galáxia, lupa e sistema solar)
    const andamento = smoothstep(this.sLupaFim - 40, sJupiter, s);
    const pLonge = (this._pL ??= new THREE.Vector3())
      .subVectors(this.cameraSistema, this.sol)
      .applyAxisAngle(this.cimaSistema, DERIVA_CAMERA * andamento)
      .multiplyScalar(lerp(1, 0.9, andamento))
      .add(this.sol);
    // olha para a estrela enquanto ela voa até o pontinho; depois entre o sol e a estrela
    const recuo = smoothstep(this.tRecuoIni, this.tRecuoFim, t);
    const aLonge = (this._aL ??= new THREE.Vector3()).copy(this.sol).lerp(estrela, lerp(1, 0.35, recuo));

    // --- espiral (de Júpiter a Mercúrio): atrás da estrela, girando em volta da direção dela
    const fi = this._interp1(this.anguloEspiral, s);
    const pEsp = (this._pE ??= new THREE.Vector3())
      .copy(estrela)
      .addScaledVector(T, -ESPIRAL_ATRAS)
      .addScaledVector(U, Math.cos(fi) * ESPIRAL_RAIO)
      .addScaledVector(R, Math.sin(fi) * ESPIRAL_RAIO);
    const aEsp = (this._aE ??= new THREE.Vector3()).copy(estrela).addScaledVector(T, 6);

    // --- Saturno: a câmera dá a volta inteira junto com a estrela
    const ang = this._interp1(this.anguloCamera, s);
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

    // mistura entre as câmeras, sempre em arco em volta da estrela
    // (andar em linha reta faria a câmera, quando está perto da estrela, girar de repente)
    const wEsp = smoothstep(this.tEspiralIni, this.tEspiralCheia, t);
    const wSat = smoothstep(sMercurio + 10, this.sOrbIni + 30, s);
    const p1 = this._emArco(estrela, pPers, pLonge, recuo, (this._p1 ??= new THREE.Vector3()));
    const p2 = this._emArco(estrela, p1, pEsp, wEsp, (this._p2 ??= new THREE.Vector3()));
    this._emArco(estrela, p2, perto, wSat, pos);
    alvo.copy(estrela).lerp(aLonge, recuo).lerp(aEsp, wEsp).lerp(aSat, wSat);
    cima.copy(U).lerp(this.cimaSistema, recuo).lerp(U, wEsp).lerp(this.cimaOrbita, wSat).normalize();
    return 60;
  }

  /** Mistura duas posições de câmera girando em volta da estrela (e afastando/aproximando aos poucos). */
  _emArco(estrela, pA, pB, w, out) {
    if (w <= 0) return out.copy(pA);
    if (w >= 1) return out.copy(pB);
    const dA = (this._ea ??= new THREE.Vector3()).subVectors(pA, estrela);
    const dB = (this._eb ??= new THREE.Vector3()).subVectors(pB, estrela);
    const raio = Math.pow(dA.length(), 1 - w) * Math.pow(dB.length(), w);
    const z = (this._ez ??= new THREE.Vector3(0, 0, 1));
    const qA = (this._qa ??= new THREE.Quaternion()).setFromUnitVectors(z, dA.normalize());
    const qB = (this._qb ??= new THREE.Quaternion()).setFromUnitVectors(z, dB.normalize());
    return out.set(0, 0, 1).applyQuaternion(qA.slerp(qB, w)).multiplyScalar(raio).add(estrela);
  }

  /**
   * Inclinação dos anéis de Saturno (no mundo): quase no plano da volta (15° fora dele). Como a
   * câmera dá a volta inteira um pouco acima desse plano, os anéis aparecem abertos o tempo todo.
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
