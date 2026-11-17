import * as THREE from 'three';
import { materialLinhas } from './materiais.js';
import { criarRng } from './utils.js';

/**
 * Efeito do salto (hiperespaço): riscos de luz que passam pela câmera, esticando
 * conforme a intensidade. Fica preso à câmera, então funciona em qualquer direção.
 */
export class Salto {
  constructor(cena, qualidade) {
    const n = Math.round(700 * Math.max(0.5, qualidade));
    const rand = criarRng(808);
    const base = new Float32Array(n * 2 * 3);
    const fase = new Float32Array(n * 2);
    const ponta = new Float32Array(n * 2);
    const cor = new Float32Array(n * 2 * 3);
    const cores = ['#ffffff', '#e9d5ff', '#c4b5fd', '#f0abfc', '#a5b4fc'].map((h) => new THREE.Color(h));
    for (let i = 0; i < n; i++) {
      // posição num cilindro em volta do eixo de visão
      const a = rand() * Math.PI * 2;
      const r = 2.5 + Math.pow(rand(), 0.7) * 30;
      const f = rand();
      const c = cores[Math.floor(rand() * cores.length)];
      for (let k = 0; k < 2; k++) {
        base.set([Math.cos(a) * r, Math.sin(a) * r, 0], (i * 2 + k) * 3);
        fase[i * 2 + k] = f;
        ponta[i * 2 + k] = k;
        cor.set([c.r, c.g, c.b], (i * 2 + k) * 3);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(base, 3));
    geo.setAttribute('aFase', new THREE.BufferAttribute(fase, 1));
    geo.setAttribute('aPonta', new THREE.BufferAttribute(ponta, 1));
    geo.setAttribute('aCor', new THREE.BufferAttribute(cor, 3));
    this.u = { uT: { value: 0 }, uIntens: { value: 0 } };
    this.linhas = new THREE.LineSegments(
      geo,
      materialLinhas({
        uniforms: this.u,
        cabecalho: 'attribute float aFase; attribute float aPonta; attribute vec3 aCor; uniform float uT; uniform float uIntens;',
        corpo: /* glsl */ `
          // cada risco vem de longe (z = -260) até passar pela câmera (z = 0), em ciclo
          float z = -260.0 + fract(aFase + uT * 1.6) * 262.0;
          float comp = 4.0 + uIntens * 90.0;
          float zp = aPonta > 0.5 ? z : z - comp;
          pos = vec3(position.xy, zp);
          cor = aCor * 2.2;
          alfa = uIntens * aPonta * smoothstep(-260.0, -200.0, z) * (1.0 - smoothstep(-8.0, 0.0, z));
        `,
      })
    );
    this.linhas.frustumCulled = false;
    this.linhas.visible = false;
    cena.add(this.linhas);
  }

  atualizar(t, camera, intensidade) {
    this.linhas.visible = intensidade > 0.001;
    if (!this.linhas.visible) return;
    this.linhas.position.copy(camera.position);
    this.linhas.quaternion.copy(camera.quaternion);
    this.u.uT.value = t;
    this.u.uIntens.value = intensidade;
  }
}
