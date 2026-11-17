import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';

import { criarTexturas } from './texturas.js';
import { globais } from './materiais.js';
import { Singularidade } from './singularidade.js';
import { Explosao } from './explosao.js';
import { Ceu, Nebulosa, Galaxia, Planeta, Asteroides, BuracoNegro, PoeiraViagem } from './universo.js';
import { Estrela } from './estrela.js';
import { Viagem } from './viagem.js';
import { Raios } from './raios.js';
import {
  clamp,
  lerp,
  progresso,
  smoothstep,
  janela,
  easeInQuad,
  easeInCubic,
  easeOutCubic,
  easeInOutCubic,
  tremor,
} from './utils.js';

// ------------------------------------------------------------------
// Linha do tempo (segundos contados a partir do clique)
// ------------------------------------------------------------------
const CARGA = 4.6; // sobrecarga: treme, pulsa cada vez mais rápido
const BANG = CARGA + 0.45; // implosão rápida e... BUM
const FOCO_INI = BANG + 4.2; // a câmera procura a estrela
const FOCO_FIM = BANG + 8.4;
const VIAGEM_INI = FOCO_FIM; // a estrela passeia pelo universo
const VIAGEM_DUR = 27;
const FINAL_INI = VIAGEM_INI + VIAGEM_DUR; // a estrela para e começa a tremer
const SUPERNOVA = FINAL_INI + 4.8; // ela explode
const BRANCO = SUPERNOVA + 1.8; // tela 100% branca

// Batida do coração e fluxo de energia (a frequência sobe durante a carga)
const BATIDA_0 = 0.85;
const BATIDA_1 = 7.5;
const FLUXO_0 = 0.12;
const FLUXO_1 = 0.95;

// Posições dos marcos do universo
const H0 = new THREE.Vector3(30, 6, -25); // onde a estrela protagonista "nasce"
const POS = {
  nebulosa: new THREE.Vector3(75, 18, -160),
  looping: new THREE.Vector3(62, 10, -262),
  galaxia: new THREE.Vector3(10, -45, -430),
  planeta: new THREE.Vector3(-115, 5, -610),
  asteroides: new THREE.Vector3(-215, 0, -760),
  buraco: new THREE.Vector3(-125, -20, -925),
  fim: new THREE.Vector3(-45, -8, -985),
};

const parametros = new URLSearchParams(location.search);
const reduzirMovimento = matchMedia('(prefers-reduced-motion: reduce)').matches;

const el = {
  palco: document.getElementById('palco'),
  clarao: document.getElementById('clarao'),
  vinheta: document.getElementById('vinheta'),
  dica: document.getElementById('dica'),
  final: document.getElementById('final'),
};

/** Termina na tela branca e avisa quem quiser continuar a partir dali. */
function mostrarFinal() {
  document.body.classList.add('fim');
  document.body.classList.remove('rodando');
  el.clarao.style.opacity = '1';
  el.final.hidden = false;
  el.palco.style.display = 'none';
  el.dica.remove();
  window.dispatchEvent(new CustomEvent('bigbang:fim'));
}

function suportaWebGL() {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}

if (parametros.has('fim') || !suportaWebGL()) {
  mostrarFinal();
} else {
  iniciar();
}

function iniciar() {
  const pedido = parseFloat(parametros.get('qualidade'));
  const fraco = matchMedia('(pointer: coarse)').matches || Math.min(innerWidth, innerHeight) < 600;
  const q = clamp(Number.isFinite(pedido) ? pedido : fraco ? 0.45 : 1, 0.15, 1.5);

  const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, fraco ? 1.5 : 2));
  renderer.setSize(innerWidth, innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.setClearColor('#000000');
  el.palco.appendChild(renderer.domElement);

  const cena = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 9000);
  camera.position.set(0, 0, 30);

  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(cena, camera));
  // Limita o brilho antes do bloom: pontos muito estourados viram "quadrados" no desfoque.
  composer.addPass(
    new ShaderPass({
      uniforms: { tDiffuse: { value: null }, uMax: { value: 2.4 } },
      vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `
        uniform sampler2D tDiffuse; uniform float uMax; varying vec2 vUv;
        void main() {
          vec3 c = texture2D(tDiffuse, vUv).rgb;
          float m = max(max(c.r, c.g), c.b);
          if (m > uMax) c *= uMax / m;
          gl_FragColor = vec4(c, 1.0);
        }`,
    })
  );
  const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.75, 0.45, 0.18);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  cena.add(new THREE.AmbientLight('#8d7fd6', 0.18));

  // ---------------- elementos ----------------
  const tex = criarTexturas();
  const singularidade = new Singularidade(cena, tex, q);
  const bigbang = new Explosao(cena, tex, { qualidade: q, semente: 7 });
  const ceu = new Ceu(cena, tex, q);
  const nebulosa = new Nebulosa(cena, tex, q, POS.nebulosa);
  const galaxia = new Galaxia(cena, tex, q, POS.galaxia);
  const planeta = new Planeta(cena, tex, q, POS.planeta);
  const asteroides = new Asteroides(cena, tex, q, POS.asteroides);
  const buraco = new BuracoNegro(cena, tex, q, POS.buraco);

  const viagem = new Viagem(
    { inicio: H0, nebulosa, looping: POS.looping, galaxia, planeta, asteroides, buraco, fim: POS.fim },
    VIAGEM_DUR
  );
  asteroides.posicionar(viagem);
  const poeira = new PoeiraViagem(cena, q, viagem);
  const estrela = new Estrela(cena, tex);
  const marcos = { nebulosa, galaxia, planeta, asteroides, buraco };

  // Depois da viagem a estrela ainda desliza um pouco antes de parar
  const fimViagem = viagem.pontoBase(viagem.L, new THREE.Vector3());
  const tangFinal = viagem.tangenteFinal(new THREE.Vector3());
  const velFinal = (viagem.L - viagem.sEm(VIAGEM_DUR - 0.05)) / 0.05;
  // lado de onde a câmera assiste à estrela explodir (um pouco atrás, à direita e acima dela)
  const ladoFinal = (() => {
    const T = new THREE.Vector3();
    const U = new THREE.Vector3();
    const R = new THREE.Vector3();
    viagem.quadro(viagem.L, T, U, R);
    return R.multiplyScalar(0.9).addScaledVector(T, -0.35).addScaledVector(U, 0.25).normalize();
  })();

  function posEstrela(t, out) {
    if (t < VIAGEM_INI) {
      const te = Math.max(0, t - BANG);
      return out.copy(H0).multiplyScalar(1 - Math.exp(-1.5 * te));
    }
    if (t < FINAL_INI) return viagem.estrelaEm(t - VIAGEM_INI, out);
    const tf = t - FINAL_INI;
    return out.copy(fimViagem).addScaledVector(tangFinal, (velFinal * (1 - Math.exp(-1.4 * tf))) / 1.4);
  }

  const posSupernova = posEstrela(SUPERNOVA, new THREE.Vector3());
  const supernova = new Explosao(cena, tex, {
    centro: posSupernova,
    qualidade: q,
    semente: 99,
    vMax: 140,
    arrasto: 1.3,
    poeira: 16000,
    raios: 500,
    nuvens: 18,
    galaxias: 0,
    estrelas: 0,
    fragmentos: 0,
    flash: 90,
    decaiFlash: 0.5,
    onda: 160,
    tamanho: 0.6,
    paleta: ['#ffffff', '#cfe8ff', '#ffe3b3', '#ffc2f0', '#a5b4fc'],
  });

  // raios elétricos em volta da estrela quando ela fica instável
  const grupoRaiosEstrela = new THREE.Group();
  cena.add(grupoRaiosEstrela);
  const raiosEstrela = new Raios(grupoRaiosEstrela, { quantidade: 9, cor: '#cfe6ff' });

  // ---------------- tamanho da tela ----------------
  function ajustarEscalaPixel() {
    const h = renderer.getDrawingBufferSize(new THREE.Vector2()).y;
    globais.uEscalaPixel.value = h / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
  }
  function redimensionar() {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
    composer.setSize(innerWidth, innerHeight);
    bloom.resolution.set(innerWidth, innerHeight);
    ajustarEscalaPixel();
  }
  addEventListener('resize', redimensionar);
  ajustarEscalaPixel();

  // Pré-compila shaders e envia texturas para a GPU agora, para não engasgar na explosão
  cena.traverse((o) => (o.visible = true));
  Object.values(tex)
    .flat()
    .forEach((t) => renderer.initTexture(t));
  renderer.compile(cena, camera);

  // ---------------- estado ----------------
  let estado = 'ocioso'; // ocioso -> rodando -> fim
  let tOcioso = 0;
  let t = 0; // tempo desde o clique
  let faseClique = 0;
  let fluxoClique = 0;

  // Ajuda para desenvolver: ?t=30 começa no segundo 30; ?t=30&pausa congela ali.
  const pausado = parametros.has('pausa');
  const inicioDebug = parseFloat(parametros.get('t'));
  if (Number.isFinite(inicioDebug)) {
    estado = 'rodando';
    t = Math.max(0, inicioDebug);
    document.body.classList.add('rodando');
  } else {
    setTimeout(() => estado === 'ocioso' && el.dica.classList.add('visivel'), 1400);
  }

  function comecar() {
    if (estado !== 'ocioso') return;
    estado = 'rodando';
    faseClique = BATIDA_0 * tOcioso;
    fluxoClique = FLUXO_0 * tOcioso;
    el.dica.classList.remove('visivel');
    document.body.classList.add('rodando');
  }
  addEventListener('pointerdown', comecar);
  addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') comecar();
  });

  // ---------------- direção de câmera ----------------
  const camPos = new THREE.Vector3();
  const camAlvo = new THREE.Vector3();
  const camCima = new THREE.Vector3(0, 1, 0);
  const vTmp = new THREE.Vector3();
  const vTmp2 = new THREE.Vector3();
  const vTmp3 = new THREE.Vector3();
  const vTremor = new THREE.Vector3();
  const estrelaPos = new THREE.Vector3();
  const CAM_OCIOSA = new THREE.Vector3(0, 0, 30);
  const CAM_CARGA = new THREE.Vector3(0, 0, 23);
  const CAM_EXPLOSAO = new THREE.Vector3(-18, 26, 175);

  // pose da câmera no começo e no fim da viagem (para as transições)
  const camViagem0 = { pos: new THREE.Vector3(), alvo: new THREE.Vector3(), cima: new THREE.Vector3() };
  camViagem0.fov = viagem.camera(0, camViagem0.pos, camViagem0.alvo, camViagem0.cima);
  const camViagem1 = { pos: new THREE.Vector3(), alvo: new THREE.Vector3(), cima: new THREE.Vector3() };
  camViagem1.fov = viagem.camera(VIAGEM_DUR, camViagem1.pos, camViagem1.alvo, camViagem1.cima);

  function posCameraExplosao(te, out) {
    const k = easeOutCubic(clamp(te / 4.2));
    return out.lerpVectors(CAM_CARGA, CAM_EXPLOSAO, k);
  }

  function dirigirCamera(t, carga) {
    let fov = 60;
    let tremorAmp = 0;
    camCima.set(0, 1, 0);

    if (estado === 'ocioso') {
      camPos.set(Math.sin(tOcioso * 0.1) * 1.2, Math.cos(tOcioso * 0.13) * 0.8, 30);
      camAlvo.set(0, 0, 0);
    } else if (t < BANG) {
      camPos.lerpVectors(CAM_OCIOSA, CAM_CARGA, easeInOutCubic(clamp(t / CARGA)));
      camAlvo.set(0, 0, 0);
      tremorAmp = 0.32 * carga * carga;
    } else if (t < FOCO_INI) {
      const te = t - BANG;
      posCameraExplosao(te, camPos);
      camAlvo.set(0, 0, 0);
      tremorAmp = 1.6 * Math.exp(-te * 1.6);
      camCima.set(Math.sin(te * 0.5) * 0.08 * Math.exp(-te * 0.3), 1, 0).normalize();
    } else if (t < FOCO_FIM) {
      // voo curvo até ficar atrás da estrela
      const f = easeInOutCubic(progresso(FOCO_INI, FOCO_FIM, t));
      const p0 = posCameraExplosao(FOCO_INI - BANG, vTmp);
      const p1 = camViagem0.pos;
      const ctrl = vTmp2.lerpVectors(p0, p1, 0.5).add(vTmp3.set(55, 18, 10));
      camPos
        .copy(p0)
        .multiplyScalar((1 - f) * (1 - f))
        .addScaledVector(ctrl, 2 * f * (1 - f))
        .addScaledVector(p1, f * f);
      posEstrela(t, estrelaPos);
      const fa = smoothstep(0, 0.45, progresso(FOCO_INI, FOCO_FIM, t));
      camAlvo.set(0, 0, 0).lerp(estrelaPos, fa).lerp(camViagem0.alvo, f);
      camCima.set(0, 1, 0).lerp(camViagem0.cima, f).normalize();
      fov = lerp(60, camViagem0.fov, f);
    } else if (t < FINAL_INI) {
      fov = viagem.camera(t - VIAGEM_INI, camPos, camAlvo, camCima);
    } else {
      // final: a câmera sai de trás e vai para o lado da estrela, chegando perto
      const tf = t - FINAL_INI;
      posEstrela(t, estrelaPos);
      const desloc = vTmp.subVectors(camViagem1.pos, fimViagem);
      const seguir = vTmp2.copy(estrelaPos).add(desloc);
      const lado = vTmp3.copy(ladoFinal);
      const dist = lerp(12, 8.5, easeInOutCubic(progresso(0.5, 4.6, tf)));
      const b = easeInOutCubic(progresso(0, 2.4, tf));
      camPos.lerpVectors(seguir, lado.multiplyScalar(dist).add(estrelaPos), b);
      camAlvo.copy(camViagem1.alvo).sub(fimViagem).add(estrelaPos).lerp(estrelaPos, b);
      camCima.copy(camViagem1.cima).lerp(vTmp.set(0, 1, 0), b).normalize();
      fov = lerp(camViagem1.fov, 55, b);
      const k = progresso(FINAL_INI + 0.8, SUPERNOVA, t);
      tremorAmp = 0.18 * k * k + (t > SUPERNOVA ? 1.2 * Math.exp(-(t - SUPERNOVA) * 2) : 0);
    }

    // tela em pé (celular): abre o campo de visão para caber o mesmo tanto na horizontal
    fov *= lerp(1, 1.5, clamp((1 - camera.aspect) / 0.55));

    if (reduzirMovimento) tremorAmp *= 0.3;
    camera.position.copy(camPos).add(tremor(t + tOcioso, tremorAmp, vTremor, 11));
    camera.up.copy(camCima);
    camera.lookAt(camAlvo);
    if (Math.abs(camera.fov - fov) > 0.01) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
      ajustarEscalaPixel();
    }
  }

  // ---------------- quadro a quadro ----------------
  const zero = { nebulosa: 0, galaxia: 0, planeta: 0, asteroides: 0, buraco: 0 };
  let ultimo = performance.now();

  function quadro(agora) {
    const dt = Math.min((agora - ultimo) / 1000, 1 / 20);
    ultimo = agora;
    if (estado === 'ocioso') tOcioso += dt;
    else if (estado === 'rodando' && !pausado) t += dt;
    const relogio = tOcioso + t;
    globais.camPos.copy(camera.position);

    // --- singularidade (antes do Big Bang)
    let carga = 0;
    if (estado === 'ocioso') {
      singularidade.visivel = true;
      singularidade.atualizar(dt, relogio, BATIDA_0 * tOcioso, FLUXO_0 * tOcioso, 0, 0);
    } else if (t < BANG) {
      const tc = Math.min(t, CARGA);
      carga = easeInQuad(tc / CARGA);
      // fase integrada: a frequência cresce com t², então a fase cresce com t³
      const integral = (tc * tc * tc) / (3 * CARGA * CARGA) + Math.max(0, t - CARGA);
      const fase = faseClique + BATIDA_0 * t + (BATIDA_1 - BATIDA_0) * integral;
      const fluxo = fluxoClique + FLUXO_0 * t + (FLUXO_1 - FLUXO_0) * integral;
      const colapso = easeInCubic(progresso(CARGA, BANG, t));
      singularidade.visivel = true;
      singularidade.atualizar(dt, relogio, fase, fluxo, carga, colapso);
    } else {
      singularidade.visivel = false;
    }

    // --- Big Bang
    bigbang.atualizar(estado === 'ocioso' ? -1 : t - BANG);
    bigbang.opacidade = lerp(1, 0.6, smoothstep(FOCO_INI, FOCO_FIM, t));

    // --- universo
    const formacao = estado === 'ocioso' ? 0 : smoothstep(BANG + 1.5, BANG + 7, t);
    const dest = t > VIAGEM_INI - 1 && t < SUPERNOVA ? viagem.destaques(posEstrela(t, estrelaPos)) : zero;
    for (const [nome, obj] of Object.entries(marcos)) obj.atualizar(relogio, dest[nome] ?? 0, estrelaPos, formacao);
    poeira.atualizar(estado === 'ocioso' ? 0 : smoothstep(BANG + 3, BANG + 8, t) * (1 - smoothstep(SUPERNOVA, SUPERNOVA + 0.5, t)));

    // --- estrela protagonista
    const viva = estado !== 'ocioso' && t >= BANG && t < SUPERNOVA;
    const te = t - BANG;
    const kFinal = progresso(FINAL_INI + 0.8, SUPERNOVA - 0.4, t);
    const contrai = easeInCubic(progresso(SUPERNOVA - 0.4, SUPERNOVA, t));
    const acende = janela(te, 3.2, 4.0, 4.6, 6.5);
    const piscada = kFinal > 0.3 ? 1 + (Math.random() - 0.5) * 0.7 * kFinal : 1;
    estrela.atualizar(t, posEstrela, {
      visivel: viva,
      brilho: (lerp(0.55, 1.2, smoothstep(2.5, 4.2, te)) + 1.4 * acende + 0.6 * kFinal) * piscada * lerp(1, 0.4, contrai),
      escala: lerp(0.55, 1, smoothstep(2.5, 4.4, te)) * (1 + 0.7 * kFinal * kFinal) * lerp(1, 0.12, contrai),
      tremor: 0.55 * kFinal * kFinal,
      limite: kFinal,
      luz: 80 * smoothstep(2.8, 4.5, te) * (1 + 2 * kFinal),
      rastro: smoothstep(0.1, 0.6, te) * (1 - smoothstep(FINAL_INI + 0.5, FINAL_INI + 2.5, t)),
      raioMalabares: (x) =>
        smoothstep(FOCO_INI - 1, FOCO_FIM - 1, x) * (1 - easeInQuad(progresso(FINAL_INI + 1.2, FINAL_INI + 3.6, x))),
    });
    if (viva && kFinal > 0.05 && contrai < 0.5) {
      grupoRaiosEstrela.position.copy(estrela.grupo.position);
      raiosEstrela.atualizar(dt, Math.pow(kFinal, 1.2), 1.2, 4 + 7 * kFinal, 0.9);
    } else raiosEstrela.esconder();

    // --- supernova final
    supernova.atualizar(t - SUPERNOVA);

    // --- céu
    ceu.atualizar(relogio, camera, estado === 'ocioso' ? 0 : smoothstep(BANG + 0.8, BANG + 5.5, t));

    dirigirCamera(t, carga);

    // --- camadas HTML: clarão branco e vinheta
    let branco = 0;
    if (estado !== 'ocioso') {
      if (t >= BANG) branco = 0.85 * Math.exp(-(t - BANG) * 3.2);
      if (t >= SUPERNOVA) {
        const r = progresso(SUPERNOVA, BRANCO, t);
        const pop = 0.22 * Math.exp(-(t - SUPERNOVA) * 6);
        branco = clamp(Math.pow(r, 2.2) + pop * (1 - r));
      }
    }
    el.clarao.style.opacity = branco.toFixed(3);
    const vin =
      estado === 'ocioso' || t < BANG
        ? 0.75
        : lerp(0.45, 0.95, janela(t, FOCO_INI, FOCO_INI + 2, FOCO_FIM - 1, FOCO_FIM + 3)) +
          0.25 * smoothstep(FINAL_INI, SUPERNOVA, t) -
          smoothstep(SUPERNOVA, SUPERNOVA + 0.8, t);
    el.vinheta.style.opacity = clamp(vin).toFixed(3);

    composer.render();

    if (estado === 'rodando' && t >= BRANCO) {
      estado = 'fim';
      renderer.setAnimationLoop(null);
      mostrarFinal();
      renderer.dispose();
      renderer.forceContextLoss();
    }
  }

  renderer.setAnimationLoop(quadro);
}
