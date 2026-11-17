import * as THREE from 'three';
import { smoothstep, janela, clamp, lerp } from './utils.js';

const CIMA = new THREE.Vector3(0, 1, 0);
const M = 3000; // amostras ao longo do caminho

/**
 * Pontos de uma volta (ou parte de uma volta) em torno de `centro`, entrando na direção
 * `dirEntrada` e saindo apontando para `alvo`. Dá pelo menos `minVoltas` voltas.
 */
function orbita({ centro, normal, raio, raioEm = null, anterior, alvo, minVoltas, passo = 0.3 }) {
  const n = normal.clone().normalize();
  const e1 = new THREE.Vector3().crossVectors(Math.abs(n.y) < 0.9 ? CIMA : new THREE.Vector3(1, 0, 0), n).normalize();
  const e2 = new THREE.Vector3().crossVectors(n, e1);
  const noPlano = (d) => d.clone().addScaledVector(n, -d.dot(n)).normalize();
  const dEnt = noPlano(centro.clone().sub(anterior));
  const dSai = noPlano(alvo.clone().sub(centro));
  const pos = (a, r) => centro.clone().addScaledVector(e1, Math.cos(a) * r).addScaledVector(e2, Math.sin(a) * r);

  // sentido +1: tangente(a) = -e1 sen a + e2 cos a
  const angulo = (d, s) => (s > 0 ? Math.atan2(-d.dot(e1), d.dot(e2)) : Math.atan2(d.dot(e1), -d.dot(e2)));
  // escolhe o sentido cuja entrada fica mais perto de quem vem chegando
  const r0 = raioEm ? raioEm(0) : raio;
  const sentido = pos(angulo(dEnt, 1), r0).distanceTo(anterior) <= pos(angulo(dEnt, -1), r0).distanceTo(anterior) ? 1 : -1;
  const a0 = angulo(dEnt, sentido);
  const a1 = angulo(dSai, sentido);
  let varredura = (((sentido * (a1 - a0)) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  while (varredura < minVoltas * Math.PI * 2) varredura += Math.PI * 2;
  const passos = Math.max(3, Math.ceil(varredura / passo));
  const pts = [];
  for (let k = 0; k <= passos; k++) {
    const f = k / passos;
    pts.push(pos(a0 + sentido * varredura * f, raioEm ? raioEm(f) : raio));
  }
  return pts;
}

/** Um looping vertical, como de avião, começando em `inicio` e indo na direção `dir`. */
function looping(inicio, dir, raio, desvioLateral) {
  const d = dir.clone().setY(0).normalize();
  const lado = new THREE.Vector3().crossVectors(d, CIMA).normalize();
  const pts = [];
  const n = 12;
  for (let k = 0; k <= n; k++) {
    const a = (k / n) * Math.PI * 2;
    pts.push(
      inicio
        .clone()
        .addScaledVector(d, raio * Math.sin(a))
        .addScaledVector(CIMA, raio * (1 - Math.cos(a)))
        .addScaledVector(lado, desvioLateral * (k / n))
    );
  }
  return { pts, fim: pts[pts.length - 1].clone(), d };
}

/**
 * A viagem da estrela pelo universo recém-nascido: o caminho, a velocidade em cada trecho,
 * as acrobacias e onde a câmera fica a cada instante.
 */
export class Viagem {
  constructor(m, duracao) {
    this.duracao = duracao;
    const { inicio, nebulosa, galaxia, planeta, asteroides, buraco, fim } = m;
    const pts = [inicio.clone()];

    // 1) atravessa a nebulosa
    const nc = nebulosa.centro;
    pts.push(new THREE.Vector3().lerpVectors(inicio, nc, 0.45).add(new THREE.Vector3(-8, 4, 0)));
    pts.push(nc.clone().add(new THREE.Vector3(-22, -4, 42)));
    pts.push(nc.clone().add(new THREE.Vector3(6, 5, 0)));
    pts.push(nc.clone().add(new THREE.Vector3(-6, -4, -44)));

    // 2) looping no espaço vazio
    const inicioLoop = m.looping;
    const dirLoop = galaxia.centro.clone().sub(inicioLoop).setY(0).normalize();
    pts.push(inicioLoop.clone().addScaledVector(dirLoop, -26));
    const loop = looping(inicioLoop, dirLoop, 22, 14);
    pts.push(...loop.pts);
    pts.push(loop.fim.clone().addScaledVector(loop.d, 30).add(new THREE.Vector3(0, -8, 0)));
    this.centroLoop = inicioLoop.clone().add(new THREE.Vector3(0, 22, 0));

    // 3) mergulho e volta em torno do núcleo da galáxia (por cima do disco)
    const centroGal = galaxia.centro.clone().addScaledVector(galaxia.normal, 34);
    const orbGal = orbita({
      centro: centroGal,
      normal: galaxia.normal,
      raio: 58,
      anterior: pts[pts.length - 1],
      alvo: planeta.centro,
      minVoltas: 0.6,
    });
    pts.push(...orbGal);

    // 4) volta inclinada em torno do planeta (cruza o plano dos anéis por fora)
    const nPla = planeta.normal.clone().applyAxisAngle(new THREE.Vector3(1, 0, 0), 0.45).normalize();
    const saidaGal = orbGal[orbGal.length - 1];
    pts.push(new THREE.Vector3().lerpVectors(saidaGal, planeta.centro, 0.5).add(new THREE.Vector3(0, 10, 0)));
    const orbPla = orbita({
      centro: planeta.centro,
      normal: nPla,
      raio: planeta.raioOrbita,
      anterior: pts[pts.length - 1],
      alvo: asteroides.centro,
      minVoltas: 0.85,
    });
    pts.push(...orbPla);

    // 5) zigue-zague pelo campo de asteroides
    const ac = asteroides.centro;
    const dirAst = buraco.centro.clone().sub(orbPla[orbPla.length - 1]).normalize();
    const ladoAst = new THREE.Vector3().crossVectors(dirAst, CIMA).normalize();
    const entradaAst = ac.clone().addScaledVector(dirAst, -62);
    pts.push(new THREE.Vector3().lerpVectors(orbPla[orbPla.length - 1], entradaAst, 0.5));
    for (let k = 0; k <= 4; k++) {
      const f = k / 4;
      pts.push(
        ac
          .clone()
          .addScaledVector(dirAst, lerp(-62, 62, f))
          .addScaledVector(ladoAst, (k % 2 ? 1 : -1) * 13 * Math.sin(Math.PI * (0.15 + f * 0.7)))
          .addScaledVector(CIMA, (k % 2 ? -1 : 1) * 5)
      );
    }

    // 6) estilingue em volta do buraco negro e saída até o ponto final
    const saidaAst = pts[pts.length - 1];
    pts.push(new THREE.Vector3().lerpVectors(saidaAst, buraco.centro, 0.5).add(new THREE.Vector3(0, 6, 0)));
    const nBn = buraco.normal.clone().applyAxisAngle(new THREE.Vector3(0, 0, 1), 0.35).normalize();
    const orbBn = orbita({
      centro: buraco.centro,
      normal: nBn,
      raio: 30,
      raioEm: (f) => 38 - 12 * Math.sin(Math.PI * f),
      anterior: pts[pts.length - 1],
      alvo: fim,
      minVoltas: 0.55,
      passo: 0.25,
    });
    pts.push(...orbBn);
    const saidaBn = orbBn[orbBn.length - 1];
    pts.push(new THREE.Vector3().lerpVectors(saidaBn, fim, 0.5));
    pts.push(fim.clone());

    this.curva = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
    this.curva.arcLengthDivisions = 6000;
    this.curva.updateArcLengths();
    this.L = this.curva.getLength();

    // Marcos: o que pode ser destacado, quanto a estrela desacelera e quanto a câmera olha para ele
    this.marcos = [
      { nome: 'nebulosa', obj: nebulosa, centro: nc, raio: nebulosa.raio, vel: 0.65, olhar: 0.12 },
      { nome: 'looping', obj: null, centro: this.centroLoop, raio: 40, vel: 0.75, olhar: 0 },
      { nome: 'galaxia', obj: galaxia, centro: galaxia.centro, raio: galaxia.raio, vel: 0.6, olhar: 0.16 },
      { nome: 'planeta', obj: planeta, centro: planeta.centro, raio: planeta.raio, vel: 0.5, olhar: 0.4 },
      { nome: 'asteroides', obj: asteroides, centro: ac, raio: asteroides.raio, vel: 0.62, olhar: 0 },
      { nome: 'buraco', obj: buraco, centro: buraco.centro, raio: buraco.raio, vel: 1.2, olhar: 0.38 },
    ];

    this.amostrar();
    this.tabelaDeTempo();
    this.trechos();
  }

  /** Proximidade (0..1) de um ponto a um marco. */
  peso(mc, p) {
    return smoothstep(mc.raio * 1.5, mc.raio * 0.55, p.distanceTo(mc.centro));
  }

  amostrar() {
    this.P = new Float32Array((M + 1) * 3);
    this.T = new Float32Array((M + 1) * 3);
    this.U = new Float32Array((M + 1) * 3);
    const p = new THREE.Vector3();
    const t = new THREE.Vector3();
    const tAnt = new THREE.Vector3();
    const u = new THREE.Vector3();
    const eixo = new THREE.Vector3();
    const nivel = new THREE.Vector3();
    for (let i = 0; i <= M; i++) {
      const f = i / M;
      this.curva.getPointAt(f, p);
      this.curva.getTangentAt(f, t).normalize();
      if (i === 0) {
        u.copy(CIMA).addScaledVector(t, -CIMA.dot(t)).normalize();
      } else {
        // transporte paralelo do "cima" (acompanha loopings como numa montanha-russa)
        eixo.crossVectors(tAnt, t);
        const s = eixo.length();
        if (s > 1e-7) u.applyAxisAngle(eixo.divideScalar(s), Math.asin(Math.min(1, s)));
        // ...e aos poucos volta a nivelar o horizonte quando o caminho não está inclinado
        nivel.copy(CIMA).addScaledVector(t, -CIMA.dot(t));
        const inclinacao = Math.abs(t.y);
        if (nivel.lengthSq() > 0.04) u.lerp(nivel.normalize(), 0.012 * (1 - inclinacao) ** 3);
        u.addScaledVector(t, -u.dot(t)).normalize();
      }
      tAnt.copy(t);
      this.P.set([p.x, p.y, p.z], i * 3);
      this.T.set([t.x, t.y, t.z], i * 3);
      this.U.set([u.x, u.y, u.z], i * 3);
    }
  }

  /** Velocidade relativa em cada ponto: mais devagar perto do que vale a pena ver. */
  fatorVelocidade(s, p) {
    let f = 1;
    for (const mc of this.marcos) f += (mc.vel - 1) * this.peso(mc, p);
    f = Math.max(0.3, f);
    f *= lerp(0.035, 1, smoothstep(0, this.L * 0.05, s));
    f *= lerp(0.05, 1, 1 - smoothstep(this.L * 0.93, this.L, s));
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

  /** Em que trecho (s) cada marco começa e termina; usado pelas manobras de câmera. */
  trechos() {
    const p = new THREE.Vector3();
    this.trecho = {};
    for (const mc of this.marcos) {
      let ini = null;
      let fim = null;
      for (let i = 0; i <= M; i++) {
        this.pontoBase((i / M) * this.L, p);
        if (this.peso(mc, p) > 0.4) {
          if (ini === null) ini = (i / M) * this.L;
          fim = (i / M) * this.L;
        }
      }
      this.trecho[mc.nome] = { ini: ini ?? 0, fim: fim ?? 0 };
    }
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

  quadro(s, T, U, R) {
    this._interp(this.T, s, T, true);
    this._interp(this.U, s, U, true);
    U.addScaledVector(T, -U.dot(T)).normalize();
    R.crossVectors(T, U);
  }

  /** Distância (aproximada) de um ponto até o caminho. */
  distanciaAoCaminho(p) {
    let min = Infinity;
    for (let i = 0; i <= M; i += 3) {
      const dx = this.P[i * 3] - p.x;
      const dy = this.P[i * 3 + 1] - p.y;
      const dz = this.P[i * 3 + 2] - p.z;
      const d = dx * dx + dy * dy + dz * dz;
      if (d < min) min = d;
    }
    return Math.sqrt(min);
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

  /** Amplitude das acrobacias em espiral (só no espaço livre, longe dos marcos). */
  amplitudeEspiral(s, base) {
    let ocupado = 0;
    for (const mc of this.marcos) ocupado = Math.max(ocupado, smoothstep(mc.raio * 2.1, mc.raio * 1.1, base.distanceTo(mc.centro)));
    return 2.6 * (1 - ocupado) * smoothstep(20, 90, s) * (1 - smoothstep(this.L - 160, this.L - 60, s));
  }

  /** Posição da estrela: caminho + espiral de "malabarismo". */
  estrelaEm(t, out) {
    const s = this.sEm(t);
    this.pontoBase(s, out);
    const A = this.amplitudeEspiral(s, out);
    if (A > 0.001) {
      const T = (this._T ??= new THREE.Vector3());
      const U = (this._U ??= new THREE.Vector3());
      const R = (this._R ??= new THREE.Vector3());
      this.quadro(s, T, U, R);
      const th = (s / 34) * Math.PI * 2;
      out.addScaledVector(R, Math.cos(th) * A).addScaledVector(U, Math.sin(th) * A);
    }
    return out;
  }

  /** Câmera de perseguição com manobras. Preenche pos, alvo e cima; devolve o FOV. */
  camera(t, pos, alvo, cima) {
    const s = this.sEm(t);
    const base = this.pontoBase(s, (this._B ??= new THREE.Vector3()));
    const T = (this._cT ??= new THREE.Vector3());
    const U = (this._cU ??= new THREE.Vector3());
    const R = (this._cR ??= new THREE.Vector3());
    this.quadro(s, T, U, R);

    let wMax = 0;
    alvo.copy(base);
    const pesos = {};
    const finalzinho = 1 - smoothstep(this.L - 220, this.L - 60, s); // no fim, só a estrela importa
    for (const mc of this.marcos) {
      const w = this.peso(mc, base) * finalzinho;
      pesos[mc.nome] = w;
      wMax = Math.max(wMax, w);
      if (mc.olhar > 0) alvo.addScaledVector(this._d(mc.centro, base), mc.olhar * w);
    }

    const atras = 13 + 5 * wMax;
    const altura = 3 + 2 * wMax;

    // giro em volta da estrela (eixo "cima"): uma volta completa na galáxia,
    // e meia guinada para o lado de fora no planeta e no buraco negro
    const tg = this.trecho.galaxia;
    let giro = Math.PI * 2 * smoothstep(tg.ini, tg.fim, s);
    for (const nome of ['planeta', 'buraco']) {
      const mc = this.marcos.find((x) => x.nome === nome);
      const lado = clamp(R.dot(this._d(mc.centro, base)) / (mc.centro.distanceTo(base) * 0.3 + 1e-3), -1, 1);
      giro += -lado * (nome === 'planeta' ? 0.75 : 0.9) * pesos[nome];
    }
    // parafuso (barrel roll) atravessando os asteroides
    const ta = this.trecho.asteroides;
    const parafuso = Math.PI * 2 * smoothstep(ta.ini + 10, ta.fim - 10, s);

    const off = (this._off ??= new THREE.Vector3());
    off.copy(T).multiplyScalar(-atras * Math.cos(giro)).addScaledVector(R, atras * Math.sin(giro)).addScaledVector(U, altura);
    off.applyAxisAngle(T, parafuso);
    cima.copy(U).applyAxisAngle(T, parafuso);
    pos.copy(base).add(off);

    const v = this.velocidade(t);
    return 58 + 16 * smoothstep(0.55, 1, v);
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

  /** Tangente no fim da viagem (para a estrela continuar deslizando no final). */
  tangenteFinal(out) {
    return this._interp(this.T, this.L, out, true);
  }
}
