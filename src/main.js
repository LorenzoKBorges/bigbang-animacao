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
import { Ceu, Galaxia, Planeta, PoeiraViagem } from './universo.js';
import { Estrela } from './estrela.js';
import { Viagem, planejarRota } from './viagem.js';
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
// Total: 10 segundos do clique até a tela branca.
const CARGA = 1.3; // sobrecarga: treme, pulsa cada vez mais rápido
const BANG = CARGA + 0.25; // implosão rápida e... BUM (1,55 s)
const FOCO_INI = BANG + 0.9; // a câmera voa até a estrela
const FOCO_FIM = BANG + 1.85;
const VIAGEM_INI = FOCO_FIM; // atravessa um braço da galáxia e dá a volta em Saturno (3,4 s)
const VIAGEM_DUR = 4.75;
const FINAL_INI = VIAGEM_INI + VIAGEM_DUR; // a estrela para e começa a tremer (8,15 s)
const SUPERNOVA = FINAL_INI + 1.05; // ela explode
const BRANCO = SUPERNOVA + 0.8; // tela 100% branca (10 s)

// Batida do coração e fluxo de energia (a frequência sobe durante a carga)
const BATIDA_0 = 0.85;
const BATIDA_1 = 9;
const FLUXO_0 = 0.12;
const FLUXO_1 = 0.95;

// Onde a estrela protagonista "nasce" e onde ela cruza um braço da galáxia
// (a 72 unidades do núcleo). A galáxia é posicionada a partir disso.
const H0 = new THREE.Vector3(25, 5, -20);
const BRACO = { indice: 0, raio: 72, tempo: VIAGEM_INI + 0.7 };

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
  renderer.setClearColor('#07010f');
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

  cena.add(new THREE.AmbientLight('#9b7be0', 0.2));
  // luz vinda da câmera, só durante a explosão: mostra o relevo das rochas que voam na direção dela
  const luzFrontal = new THREE.DirectionalLight('#eadcff', 0);
  cena.add(luzFrontal);

  // ---------------- elementos ----------------
  const tex = criarTexturas();
  const singularidade = new Singularidade(cena, tex, q);
  const bigbang = new Explosao(cena, tex, { qualidade: q, semente: 7 });
  const ceu = new Ceu(cena, tex, q);
  const galaxia = new Galaxia(cena, tex, q, new THREE.Vector3());
  // a rota posiciona a galáxia e diz onde Saturno fica (flutuando acima dela)
  const rota = planejarRota(galaxia, H0, BRACO);
  const planeta = new Planeta(cena, tex, q, rota.saturno);

  const viagem = new Viagem({ inicio: H0, galaxia, planeta, rota }, VIAGEM_DUR);
  planeta.inclinarAneis(viagem.normalDosAneis());
  const poeira = new PoeiraViagem(cena, q, viagem);
  const estrela = new Estrela(cena, tex);
  const marcos = { galaxia, planeta };

  // Depois da viagem a estrela ainda desliza um pouco antes de parar
  const fimViagem = viagem.pontoBase(viagem.L, new THREE.Vector3());
  const tangFinal = viagem.tangenteFinal(new THREE.Vector3());
  const velFinal = (viagem.L - viagem.sEm(VIAGEM_DUR - 0.05)) / 0.05;

  function posEstrela(t, out) {
    if (t < VIAGEM_INI) {
      const te = Math.max(0, t - BANG);
      return out.copy(H0).multiplyScalar(1 - Math.exp(-4 * te));
    }
    if (t < FINAL_INI) return viagem.estrelaEm(t - VIAGEM_INI, out);
    const tf = t - FINAL_INI;
    return out.copy(fimViagem).addScaledVector(tangFinal, (velFinal * (1 - Math.exp(-3 * tf))) / 3);
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
    paleta: ['#ffffff', '#e9d5ff', '#c4b5fd', '#f0abfc', '#a78bfa'],
  });

  // raios elétricos em volta da estrela quando ela fica instável
  const grupoRaiosEstrela = new THREE.Group();
  cena.add(grupoRaiosEstrela);
  const raiosEstrela = new Raios(grupoRaiosEstrela, { quantidade: 9, cor: '#e3d0ff' });

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
  const CAM_EXPLOSAO = new THREE.Vector3(-12, 20, 125);

  // pose da câmera no começo e no fim da viagem (para as transições)
  const camViagem0 = { pos: new THREE.Vector3(), alvo: new THREE.Vector3(), cima: new THREE.Vector3() };
  camViagem0.fov = viagem.camera(0, camViagem0.pos, camViagem0.alvo, camViagem0.cima);
  const camViagem1 = { pos: new THREE.Vector3(), alvo: new THREE.Vector3(), cima: new THREE.Vector3() };
  camViagem1.fov = viagem.camera(VIAGEM_DUR, camViagem1.pos, camViagem1.alvo, camViagem1.cima);
  // no final a câmera só se aproxima da estrela, vindo do lado em que a viagem terminou
  const ladoFinal = camViagem1.pos.clone().sub(fimViagem).normalize();

  function posCameraExplosao(te, out) {
    const k = easeOutCubic(clamp(te / (FOCO_INI - BANG)));
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
      tremorAmp = 1.6 * Math.exp(-te * 2.5);
      camCima.set(Math.sin(te * 1.5) * 0.08, 1, 0).normalize();
    } else if (t < FOCO_FIM) {
      // voo curvo até ficar atrás da estrela
      const f = easeInOutCubic(progresso(FOCO_INI, FOCO_FIM, t));
      const p0 = posCameraExplosao(FOCO_INI - BANG, vTmp);
      const p1 = camViagem0.pos;
      const ctrl = vTmp2.lerpVectors(p0, p1, 0.5).add(vTmp3.set(35, 12, 5));
      camPos
        .copy(p0)
        .multiplyScalar((1 - f) * (1 - f))
        .addScaledVector(ctrl, 2 * f * (1 - f))
        .addScaledVector(p1, f * f);
      posEstrela(t, estrelaPos);
      const fa = smoothstep(0, 0.45, progresso(FOCO_INI, FOCO_FIM, t));
      camAlvo.set(0, 0, 0).lerp(estrelaPos, fa).lerp(camViagem0.alvo, f);
      camCima.set(Math.sin((FOCO_INI - BANG) * 1.5) * 0.08, 1, 0).lerp(camViagem0.cima, f).normalize();
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
      const dist = lerp(camViagem1.pos.distanceTo(fimViagem), 9, easeInOutCubic(progresso(0, SUPERNOVA - FINAL_INI, tf)));
      const b = easeInOutCubic(progresso(0, 0.65, tf));
      camPos.lerpVectors(seguir, lado.multiplyScalar(dist).add(estrelaPos), b);
      camAlvo.copy(camViagem1.alvo).sub(fimViagem).add(estrelaPos).lerp(estrelaPos, b);
      camCima.copy(camViagem1.cima).lerp(vTmp.set(0, 1, 0), b).normalize();
      fov = lerp(camViagem1.fov, 55, b);
      const k = progresso(FINAL_INI + 0.1, SUPERNOVA, t);
      tremorAmp = 0.2 * k * k + (t > SUPERNOVA ? 1.2 * Math.exp(-(t - SUPERNOVA) * 3) : 0);
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
  const zero = { galaxia: 0, planeta: 0 };
  let ultimo = performance.now();

  function quadro(agora) {
    // limite alto: mesmo num aparelho lento a animação dura 10 s (só pula quando a aba volta do segundo plano)
    const dt = Math.min((agora - ultimo) / 1000, 0.1);
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
    const formacao = estado === 'ocioso' ? 0 : smoothstep(BANG + 0.3, BANG + 2.0, t);
    const dest = t > VIAGEM_INI - 0.5 && t < SUPERNOVA ? viagem.destaques(posEstrela(t, estrelaPos)) : zero;
    // (o relógio da galáxia é o tempo desde o clique: assim o braço está onde a rota espera)
    for (const [nome, obj] of Object.entries(marcos)) obj.atualizar(t, dest[nome] ?? 0, estrelaPos, formacao);
    poeira.atualizar(estado === 'ocioso' ? 0 : smoothstep(BANG + 0.8, BANG + 2.4, t) * (1 - smoothstep(SUPERNOVA, SUPERNOVA + 0.4, t)));

    // --- estrela protagonista
    const viva = estado !== 'ocioso' && t >= BANG && t < SUPERNOVA;
    const te = t - BANG;
    const kFinal = progresso(FINAL_INI + 0.1, SUPERNOVA - 0.25, t);
    const contrai = easeInCubic(progresso(SUPERNOVA - 0.25, SUPERNOVA, t));
    const acende = janela(te, 0.55, 0.85, 1.3, 2.0);
    const piscada = kFinal > 0.3 ? 1 + (Math.random() - 0.5) * 0.7 * kFinal : 1;
    estrela.atualizar(t, posEstrela, {
      visivel: viva,
      brilho: (lerp(0.55, 1.2, smoothstep(0.5, 1.2, te)) + 1.4 * acende + 0.6 * kFinal) * piscada * lerp(1, 0.4, contrai),
      escala: lerp(0.55, 1, smoothstep(0.5, 1.3, te)) * (1 + 0.7 * kFinal * kFinal) * lerp(1, 0.12, contrai),
      tremor: 0.55 * kFinal * kFinal,
      limite: kFinal,
      luz: 70 * smoothstep(0.6, 1.4, te) * (1 + 2 * kFinal),
      rastro: smoothstep(0.05, 0.3, te) * (1 - smoothstep(FINAL_INI + 0.1, FINAL_INI + 0.7, t)),
      raioMalabares: (x) =>
        smoothstep(FOCO_INI - 0.6, FOCO_FIM - 0.3, x) * (1 - easeInQuad(progresso(FINAL_INI + 0.05, FINAL_INI + 0.75, x))),
    });
    if (viva && kFinal > 0.05 && contrai < 0.5) {
      grupoRaiosEstrela.position.copy(estrela.grupo.position);
      raiosEstrela.atualizar(dt, Math.pow(kFinal, 1.2), 1.2, 4 + 7 * kFinal, 0.9);
    } else raiosEstrela.esconder();

    // --- supernova final
    supernova.atualizar(t - SUPERNOVA);

    // --- céu
    ceu.atualizar(relogio, camera, estado === 'ocioso' ? 0 : smoothstep(BANG + 0.2, BANG + 1.8, t));

    dirigirCamera(t, carga);
    luzFrontal.position.copy(camera.position);
    luzFrontal.intensity = estado === 'ocioso' ? 0 : 3 * janela(t - BANG, 0, 0.15, 0.8, 2.6);

    // --- camadas HTML: clarão branco e vinheta
    let branco = 0;
    if (estado !== 'ocioso') {
      if (t >= BANG) branco = 0.85 * Math.exp(-(t - BANG) * 4.5);
      if (t >= SUPERNOVA) {
        const r = progresso(SUPERNOVA, BRANCO, t);
        const pop = 0.22 * Math.exp(-(t - SUPERNOVA) * 8);
        branco = clamp(Math.pow(r, 1.8) + pop * (1 - r));
      }
    }
    el.clarao.style.opacity = branco.toFixed(3);
    const vin =
      estado === 'ocioso' || t < BANG
        ? 0.75
        : lerp(0.5, 0.95, janela(t, FOCO_INI, FOCO_INI + 0.6, FOCO_FIM - 0.3, FOCO_FIM + 0.8)) +
          0.25 * smoothstep(FINAL_INI, SUPERNOVA, t) -
          smoothstep(SUPERNOVA, SUPERNOVA + 0.4, t);
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
