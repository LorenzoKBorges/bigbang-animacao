import * as THREE from 'three';
import { sprite } from './materiais.js';
import { texturaPlaneta } from './texturas.js';
import { smoothstep } from './utils.js';

/**
 * Os quatro planetas onde a estrela faz estilingue gravitacional (na ordem da passagem).
 * giro = rotação no próprio eixo (rad/s); voltaSol = velocidade da órbita em volta do sol (rad/s).
 */
export const PLANETAS = [
  {
    nome: 'rochoso',
    raio: 5,
    paleta: ['#8a7aa0', '#a898c0', '#c4b6dc', '#9888b0', '#ddd2ee'],
    crateras: 45,
    atmosfera: '#c4b5fd',
    forcaAtmosfera: 0.35, // rochoso: quase sem atmosfera
    giro: 0.7,
    inclinacao: 0.35,
    voltaSol: 0.08,
  },
  {
    nome: 'gelo',
    raio: 8.5,
    paleta: ['#7c8cf0', '#9aa8ff', '#6f6fd8', '#b7c0ff', '#8a7cf0'],
    faixas: true,
    atmosfera: '#a5b4fc',
    giro: 0.9,
    inclinacao: -0.25,
    voltaSol: 0.16,
  },
  {
    nome: 'magenta',
    raio: 7,
    paleta: ['#b04ad0', '#e07ae8', '#8f2fb0', '#f0a6f0', '#c25ad8'],
    faixas: true,
    atmosfera: '#f0abfc',
    giro: 0.75,
    inclinacao: 0.15,
    voltaSol: 0.1,
  },
  {
    nome: 'oceano',
    raio: 6,
    paleta: ['#2f2f96', '#4a63c8', '#5f45b8', '#62b8d8', '#3a3aa8'],
    nuvens: true,
    atmosfera: '#7dd3fc',
    giro: 1.1,
    inclinacao: 0.4,
    voltaSol: 0.12,
    lua: true,
  },
];

/** Brilho na borda do planeta (efeito Fresnel). */
function atmosfera(raio, cor) {
  const u = { uCor: { value: new THREE.Color(cor) }, uInt: { value: 0.3 } };
  const malha = new THREE.Mesh(
    new THREE.SphereGeometry(raio * 1.07, 40, 28),
    new THREE.ShaderMaterial({
      uniforms: u,
      vertexShader: /* glsl */ `
        varying vec3 vN; varying vec3 vV;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vN = normalize(normalMatrix * normal);
          vV = normalize(-mv.xyz);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uCor; uniform float uInt;
        varying vec3 vN; varying vec3 vV;
        void main() {
          float f = pow(1.0 - max(dot(normalize(vN), normalize(vV)), 0.0), 2.4);
          gl_FragColor = vec4(uCor * f * uInt, 1.0);
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })
  );
  return { malha, u };
}

/**
 * Sistema solar: um sol roxo-branco que ilumina tudo e quatro planetas girando no próprio
 * eixo e em volta do sol. Cada planeta chega ao ponto do encontro exatamente na hora
 * em que a estrela passa por ele (ver `sincronizar`).
 */
export class SistemaSolar {
  constructor(cena, tex, rota) {
    this.sol = rota.sol.clone();
    this.cima = rota.cima.clone();
    this.grupo = new THREE.Group();
    cena.add(this.grupo);

    // --- sol
    const corSol = new THREE.Color('#f1e4ff').multiplyScalar(1.8);
    this.nucleoSol = new THREE.Mesh(new THREE.SphereGeometry(15, 48, 32), new THREE.MeshBasicMaterial({ color: corSol }));
    this.nucleoSol.position.copy(this.sol);
    this.coroa = sprite(tex.brilho, '#d8b4fe', 70, 0.5);
    this.coroa2 = sprite(tex.brilho, '#7c3aed', 190, 0.2);
    this.raiosSol = sprite(tex.flare, '#f3e8ff', 110, 0.3);
    for (const s of [this.coroa2, this.coroa, this.raiosSol]) s.position.copy(this.sol);
    this.grupo.add(this.nucleoSol, this.coroa2, this.coroa, this.raiosSol);
    this.luz = new THREE.PointLight('#ead9ff', 600, 0, 1.1);
    this.luz.position.copy(this.sol);
    this.grupo.add(this.luz);

    // --- planetas
    this.planetas = PLANETAS.map((tipo, k) => {
      const encontro = rota.planetas[k].clone();
      const corpo = new THREE.Mesh(
        new THREE.SphereGeometry(tipo.raio, 48, 32),
        (() => {
          // brilho próprio leve com a própria textura: o lado da noite continua aparecendo
          const mapa = texturaPlaneta({ semente: 900 + k * 17, ...tipo });
          return new THREE.MeshStandardMaterial({
            map: mapa,
            emissiveMap: mapa,
            emissive: new THREE.Color('#ffffff'),
            emissiveIntensity: 0.18,
            roughness: 0.9,
            metalness: 0,
          });
        })()
      );
      const eixo = new THREE.Group(); // inclinação do eixo de rotação
      eixo.rotation.z = tipo.inclinacao;
      eixo.add(corpo);
      const atm = atmosfera(tipo.raio, tipo.atmosfera);
      eixo.add(atm.malha);
      const g = new THREE.Group();
      g.add(eixo);
      let lua = null;
      if (tipo.lua) {
        lua = new THREE.Mesh(new THREE.IcosahedronGeometry(1.3, 2), new THREE.MeshStandardMaterial({ color: '#cbbfe0', roughness: 1 }));
        g.add(lua);
      }
      this.grupo.add(g);
      return { ...tipo, encontro, grupo: g, corpo, atm, lua, tEncontro: 0 };
    });

    // --- linhas das órbitas (dos quatro planetas e de Saturno), no plano do sistema
    const material = new THREE.LineBasicMaterial({
      color: new THREE.Color('#a78bfa'),
      transparent: true,
      opacity: 0.16,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const e1 = rota.planetas[0].clone().sub(this.sol);
    e1.addScaledVector(this.cima, -e1.dot(this.cima)).normalize();
    const e2 = new THREE.Vector3().crossVectors(this.cima, e1);
    this.orbitas = [...rota.planetas, rota.saturno].map((p) => {
      const d = p.clone().sub(this.sol);
      const r = Math.hypot(d.dot(e1), d.dot(e2));
      const pts = [];
      for (let i = 0; i < 160; i++) {
        const a = (i / 160) * Math.PI * 2;
        pts.push(this.sol.clone().addScaledVector(e1, Math.cos(a) * r).addScaledVector(e2, Math.sin(a) * r));
      }
      const linha = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts), material);
      this.grupo.add(linha);
      return linha;
    });
    this.material = material;
    this._v = new THREE.Vector3();
  }

  /** tempos[k] = instante (desde o clique) em que a estrela passa pelo planeta k. */
  sincronizar(tempos) {
    tempos.forEach((t, k) => (this.planetas[k].tEncontro = t));
  }

  /** Posição do planeta k no instante t (ele gira em volta do sol). */
  posicao(k, t, out = new THREE.Vector3()) {
    const p = this.planetas[k];
    return out.copy(p.encontro).sub(this.sol).applyAxisAngle(this.cima, p.voltaSol * (t - p.tEncontro)).add(this.sol);
  }

  atualizar(t, estrela, formacao) {
    this.grupo.visible = formacao > 0.001;
    if (!this.grupo.visible) return;
    this.raiosSol.material.rotation = t * 0.05;
    this.coroa.scale.setScalar(70 * (1 + 0.03 * Math.sin(t * 2.3)));
    this.material.opacity = 0.16 * formacao;
    this.planetas.forEach((p, k) => {
      this.posicao(k, t, p.grupo.position);
      p.corpo.rotation.y = t * p.giro;
      // a estrela passando perto acende a atmosfera
      const perto = smoothstep(60, 12, p.grupo.position.distanceTo(estrela));
      p.atm.u.uInt.value = (0.22 + perto * 0.55) * (p.forcaAtmosfera ?? 1) * formacao;
      if (p.lua) {
        const a = t * 1.4;
        p.lua.position.set(Math.cos(a) * 12, Math.sin(a * 0.6) * 2, Math.sin(a) * 12);
      }
    });
  }
}
