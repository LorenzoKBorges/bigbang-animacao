import * as THREE from 'three';
import { materialPontos, geometria, pontos, sprite, longeDaCamera, geometriaRocha } from './materiais.js';
import { criarRng, gauss, naEsfera, smoothstep } from './utils.js';

// Tudo o que a estrela visita na viagem depois do Big Bang.
// Cada "marco" tem: centro, raio (alcance do destaque), atualizar(t, destaque, posEstrela) e formacao (0..1).

/** Céu de fundo: estrelas distantes e nebulosidade bem fraca. Acompanha a câmera (sem paralaxe). */
export class Ceu {
  constructor(cena, tex, q) {
    this.grupo = new THREE.Group();
    cena.add(this.grupo);
    const rand = criarRng(101);
    const n = Math.round(8000 * q);
    const pos = new Float32Array(n * 3);
    const cor = new Float32Array(n * 3);
    const tam = new Float32Array(n);
    const sem = new Float32Array(n);
    const cs = ['#ffffff', '#ffffff', '#cdd9ff', '#a9c1ff', '#ffe2bd', '#ffc9ec', '#e2d1ff'].map((h) => new THREE.Color(h));
    const v = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      naEsfera(rand, v);
      // um pouco mais de estrelas perto de uma faixa (como a Via Láctea)
      if (rand() < 0.35) v.y *= 0.18;
      v.normalize().multiplyScalar(3000);
      pos.set([v.x, v.y, v.z], i * 3);
      const c = cs[Math.floor(rand() * cs.length)];
      const b = 0.4 + rand() * 0.9;
      cor.set([c.r * b, c.g * b, c.b * b], i * 3);
      tam[i] = 4.5 + Math.pow(rand(), 4) * 22;
      sem[i] = rand();
    }
    this.u = { uOpac: { value: 0 }, uT: { value: 0 } };
    this.estrelas = pontos(
      geometria({ position: [pos, 3], aCor: [cor, 3], aTam: [tam, 1], aSem: [sem, 1] }, n),
      materialPontos({
        uniforms: this.u,
        cabecalho: 'attribute vec3 aCor; attribute float aTam; attribute float aSem; uniform float uOpac; uniform float uT;',
        corpo: /* glsl */ `
          pos = position; cor = aCor * 1.15; tam = aTam;
          alfa = uOpac * (0.7 + 0.3 * sin(uT * (0.8 + aSem * 2.5) + aSem * 80.0));
        `,
      })
    );
    this.grupo.add(this.estrelas);

    this.brumas = [];
    const brumas = [
      ['#5b21b6', [-0.6, 0.15, -0.8], 2600, 0.16],
      ['#1d4ed8', [0.7, -0.1, -0.7], 2200, 0.12],
      ['#be185d', [0.1, 0.4, -0.9], 1800, 0.09],
      ['#0e7490', [-0.8, -0.3, 0.5], 2400, 0.1],
      ['#6d28d9', [0.6, 0.2, 0.75], 2400, 0.12],
    ];
    brumas.forEach(([c, d, s, op], i) => {
      const b = sprite(tex.nuvens[i % tex.nuvens.length], c, s, 0);
      b.position.set(...d).normalize().multiplyScalar(2700);
      b.userData.op = op;
      this.grupo.add(b);
      this.brumas.push(b);
    });
  }

  atualizar(t, camera, opac) {
    this.grupo.position.copy(camera.position);
    this.u.uOpac.value = opac;
    this.u.uT.value = t;
    this.grupo.visible = opac > 0.001;
    for (const b of this.brumas) b.material.opacity = b.userData.op * opac;
  }
}

/** Nebulosa colorida que a estrela atravessa, acendendo o gás por onde passa. */
export class Nebulosa {
  constructor(cena, tex, q, centro) {
    this.centro = centro.clone();
    this.raio = 95;
    this.grupo = new THREE.Group();
    this.grupo.position.copy(centro);
    cena.add(this.grupo);
    const rand = criarRng(202);
    const cores = ['#ff4fd8', '#a855f7', '#6366f1', '#22d3ee', '#f472b6', '#7c3aed', '#38bdf8'];
    this.puffs = [];
    for (let i = 0; i < 52; i++) {
      const s = sprite(tex.nuvens[i % tex.nuvens.length], cores[i % cores.length], 30 + rand() * 75, 0);
      s.position.set(gauss(rand) * 40, gauss(rand) * 22, gauss(rand) * 40);
      s.material.rotation = rand() * Math.PI * 2;
      s.userData = { op: 0.025 + rand() * 0.05, giro: (rand() - 0.5) * 0.06, rot0: s.material.rotation, mundo: s.position.clone().add(centro) };
      this.grupo.add(s);
      this.puffs.push(s);
    }
    // estrelinhas dentro do gás
    const n = Math.round(500 * q);
    const pos = new Float32Array(n * 3);
    const sem = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      pos.set([gauss(rand) * 45, gauss(rand) * 25, gauss(rand) * 45], i * 3);
      sem[i] = rand();
    }
    this.u = { uOpac: { value: 0 }, uT: { value: 0 }, uDestaque: { value: 0 } };
    this.estrelas = pontos(
      geometria({ position: [pos, 3], aSem: [sem, 1] }, n),
      materialPontos({
        uniforms: this.u,
        cabecalho: 'attribute float aSem; uniform float uOpac; uniform float uT; uniform float uDestaque;',
        corpo: /* glsl */ `
          pos = position;
          cor = mix(vec3(0.85, 0.8, 1.0), vec3(1.0, 0.75, 0.95), aSem) * (1.1 + uDestaque * 0.8);
          tam = 0.35 + aSem * 0.5;
          alfa = uOpac * (0.6 + 0.4 * sin(uT * 3.0 + aSem * 40.0));
        `,
      })
    );
    this.grupo.add(this.estrelas);
  }

  atualizar(t, destaque, estrela, formacao) {
    this.grupo.visible = formacao > 0.001;
    this.u.uOpac.value = formacao;
    this.u.uT.value = t;
    this.u.uDestaque.value = destaque;
    for (const s of this.puffs) {
      const d = s.userData;
      const perto = smoothstep(75, 0, d.mundo.distanceTo(estrela));
      s.material.opacity = d.op * formacao * (1 + destaque * 0.5 + perto * 1.6) * longeDaCamera(s);
      s.material.rotation = d.rot0 + t * d.giro;
    }
  }
}

/** Galáxia espiral com três braços, girando (mais rápido no centro). */
export class Galaxia {
  constructor(cena, tex, q, centro) {
    this.centro = centro.clone();
    this.raio = 130;
    this.grupo = new THREE.Group();
    this.grupo.position.copy(centro);
    this.grupo.rotation.set(0.32, 0.4, -0.2);
    cena.add(this.grupo);
    const R = 115;
    const rand = criarRng(303);
    const n = Math.round(32000 * q);
    const aR = new Float32Array(n);
    const aAng = new Float32Array(n);
    const aY = new Float32Array(n);
    const aCor = new Float32Array(n * 3);
    const aTam = new Float32Array(n);
    const aSem = new Float32Array(n);
    const cNucleo = new THREE.Color('#ffe2b0');
    const cDentro = new THREE.Color('#f3e8ff');
    const cFora = new THREE.Color('#7aa2ff');
    const cRosa = new THREE.Color('#ff6fd0');
    const c = new THREE.Color();
    for (let i = 0; i < n; i++) {
      let r;
      let a;
      let y;
      let tam = 0.3 + rand() * 0.45;
      if (rand() < 0.2) {
        r = Math.abs(gauss(rand)) * 13;
        a = rand() * Math.PI * 2;
        y = gauss(rand) * 6 * Math.exp(-r / 14);
        c.copy(cNucleo).lerp(cDentro, rand() * 0.4);
      } else {
        const braco = Math.floor(rand() * 3);
        r = R * (0.06 + 0.94 * Math.pow(rand(), 0.8));
        a = (braco * Math.PI * 2) / 3 + Math.log(r / 6) * 1.9 + gauss(rand) * 0.3 * (1 - (r / R) * 0.3);
        y = gauss(rand) * 1.6 * (1 - (r / R) * 0.5);
        c.copy(cDentro).lerp(cFora, Math.min(1, r / R + rand() * 0.2));
        if (rand() < 0.06) {
          c.copy(cRosa);
          tam *= 1.8;
        }
      }
      aR[i] = r;
      aAng[i] = a;
      aY[i] = y;
      const b = 0.55 + rand() * 0.7;
      aCor.set([c.r * b, c.g * b, c.b * b], i * 3);
      aTam[i] = tam;
      aSem[i] = rand();
    }
    this.u = { uOpac: { value: 0 }, uT: { value: 0 }, uDestaque: { value: 0 } };
    this.disco = pontos(
      geometria({ aR: [aR, 1], aAng: [aAng, 1], aY: [aY, 1], aCor: [aCor, 3], aTam: [aTam, 1], aSem: [aSem, 1] }, n),
      materialPontos({
        uniforms: this.u,
        perto: 22,
        cabecalho: /* glsl */ `
          attribute float aR; attribute float aAng; attribute float aY; attribute vec3 aCor; attribute float aTam; attribute float aSem;
          uniform float uOpac; uniform float uT; uniform float uDestaque;
        `,
        corpo: /* glsl */ `
          float w = 1.0 / (0.35 + aR / 22.0);
          float ang = aAng - uT * w * 0.1;
          pos = vec3(cos(ang) * aR, aY, sin(ang) * aR);
          cor = aCor * (0.8 + uDestaque * 0.45);
          tam = aTam * (1.0 + uDestaque * 0.25);
          alfa = uOpac * (0.85 + 0.15 * sin(uT * 2.0 + aSem * 50.0));
        `,
      })
    );
    this.grupo.add(this.disco);
    this.nucleo = sprite(tex.brilho, '#ffd7a1', 70, 0);
    this.halo = sprite(tex.brilho, '#6d5cff', 320, 0);
    this.grupo.add(this.halo, this.nucleo);
  }

  /** Converte um ponto do plano da galáxia (x, altura, z) para o mundo. */
  local(x, y, z) {
    this.grupo.updateMatrixWorld();
    return new THREE.Vector3(x, y, z).applyMatrix4(this.grupo.matrixWorld);
  }

  get normal() {
    return new THREE.Vector3(0, 1, 0).applyQuaternion(this.grupo.quaternion);
  }

  atualizar(t, destaque, estrela, formacao) {
    this.grupo.visible = formacao > 0.001;
    this.u.uOpac.value = formacao;
    this.u.uT.value = t;
    this.u.uDestaque.value = destaque;
    this.nucleo.material.opacity = (0.6 + destaque * 0.25) * formacao * longeDaCamera(this.nucleo);
    this.halo.material.opacity = (0.1 + destaque * 0.05) * formacao * longeDaCamera(this.halo);
  }
}

/** Gigante gasoso com anéis e duas luas. É iluminado pela luz da própria estrela. */
export class Planeta {
  constructor(cena, tex, q, centro) {
    this.centro = centro.clone();
    this.raio = 70;
    this.raioOrbita = 38;
    this.grupo = new THREE.Group();
    this.grupo.position.copy(centro);
    this.grupo.rotation.set(0.28, 0, 0.42);
    cena.add(this.grupo);

    this.corpo = new THREE.Mesh(
      new THREE.SphereGeometry(12, 64, 48),
      new THREE.MeshStandardMaterial({ map: tex.planeta, roughness: 0.95, metalness: 0 })
    );
    this.grupo.add(this.corpo);

    // atmosfera: brilho na borda (efeito Fresnel)
    this.uAtm = { uCor: { value: new THREE.Color('#c9a6ff') }, uInt: { value: 0.5 } };
    const atm = new THREE.Mesh(
      new THREE.SphereGeometry(12.8, 48, 32),
      new THREE.ShaderMaterial({
        uniforms: this.uAtm,
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
            float f = pow(1.0 - max(dot(normalize(vN), normalize(vV)), 0.0), 2.6);
            gl_FragColor = vec4(uCor * f * uInt, 1.0);
          }
        `,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      })
    );
    this.grupo.add(atm);

    // anéis
    const geoAnel = new THREE.RingGeometry(17, 28, 160, 1);
    const p = geoAnel.attributes.position;
    const uv = geoAnel.attributes.uv;
    for (let i = 0; i < p.count; i++) {
      const r = Math.hypot(p.getX(i), p.getY(i));
      uv.setXY(i, (r - 17) / 11, 0.5);
    }
    this.anel = new THREE.Mesh(
      geoAnel,
      new THREE.MeshStandardMaterial({
        map: tex.aneisPlaneta,
        transparent: true,
        side: THREE.DoubleSide,
        depthWrite: false,
        roughness: 1,
        metalness: 0,
      })
    );
    this.anel.rotation.x = -Math.PI / 2;
    this.grupo.add(this.anel);

    // luas
    this.luas = [];
    const rand = criarRng(404);
    for (const [raio, dist, vel, cor] of [
      [2.2, 50, 0.22, '#b9b1c9'],
      [1.4, 62, -0.16, '#d8c3b0'],
    ]) {
      const geo = new THREE.IcosahedronGeometry(raio, 3);
      const pp = geo.attributes.position;
      const v = new THREE.Vector3();
      for (let i = 0; i < pp.count; i++) {
        v.fromBufferAttribute(pp, i).multiplyScalar(0.92 + rand() * 0.12);
        pp.setXYZ(i, v.x, v.y, v.z);
      }
      geo.computeVertexNormals();
      const lua = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: cor, roughness: 1 }));
      lua.userData = { dist, vel, fase: rand() * Math.PI * 2 };
      this.grupo.add(lua);
      this.luas.push(lua);
    }
  }

  get normal() {
    return new THREE.Vector3(0, 1, 0).applyQuaternion(this.grupo.quaternion);
  }

  atualizar(t, destaque, estrela, formacao) {
    this.grupo.visible = formacao > 0.001;
    this.corpo.rotation.y = t * 0.05;
    this.uAtm.uInt.value = (0.22 + destaque * 0.45) * formacao;
    for (const l of this.luas) {
      const a = l.userData.fase + t * l.userData.vel;
      l.position.set(Math.cos(a) * l.userData.dist, Math.sin(a * 0.7) * 3, Math.sin(a) * l.userData.dist);
    }
  }
}

/** Campo de asteroides (rochas instanciadas), iluminadas pela estrela quando ela passa. */
export class Asteroides {
  constructor(cena, tex, q, centro) {
    this.centro = centro.clone();
    this.raio = 90;
    this.quantidade = Math.round(270 * Math.max(0.6, q));
    const rand = criarRng(505);
    const mat = new THREE.MeshStandardMaterial({ color: '#8f8580', roughness: 1, metalness: 0, flatShading: true });
    // três formatos diferentes de rocha, cada um com um terço das instâncias
    this.malhas = [0, 1, 2].map(() => {
      const m = new THREE.InstancedMesh(geometriaRocha(rand), mat, Math.ceil(this.quantidade / 3));
      m.frustumCulled = false;
      m.visible = false;
      cena.add(m);
      return m;
    });
    this.dados = [];
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._s = new THREE.Vector3();
  }

  /** Espalha as rochas evitando o caminho da estrela (precisa da viagem pronta). */
  posicionar(viagem) {
    const rand = criarRng(506);
    const tentativa = new THREE.Vector3();
    let guarda = 0;
    while (this.dados.length < this.quantidade && guarda++ < 20000) {
      tentativa.set(gauss(rand) * 55, gauss(rand) * 16, gauss(rand) * 48).add(this.centro);
      const tam = rand() < 0.06 ? 4 + rand() * 4 : 0.5 + Math.pow(rand(), 2) * 3;
      if (viagem.distanciaAoCaminho(tentativa) < tam * 1.6 + 7) continue;
      this.dados.push({
        pos: tentativa.clone(),
        tam,
        eixo: naEsfera(rand, new THREE.Vector3()),
        giro: (rand() - 0.5) * 0.8,
        fase: rand() * 10,
      });
    }
    for (const m of this.malhas) m.count = 0;
  }

  atualizar(t, destaque, estrela, formacao) {
    const vis = formacao > 0.001;
    for (const m of this.malhas) {
      m.visible = vis;
      m.count = 0;
    }
    if (!vis) return;
    this.dados.forEach((d, i) => {
      const m = this.malhas[i % 3];
      this._q.setFromAxisAngle(d.eixo, d.fase + t * d.giro);
      this._s.setScalar(d.tam);
      this._m.compose(d.pos, this._q, this._s);
      m.setMatrixAt(m.count++, this._m);
    });
    for (const m of this.malhas) m.instanceMatrix.needsUpdate = true;
  }
}

/** Buraco negro com disco de acreção. A estrela faz um estilingue gravitacional em volta dele. */
export class BuracoNegro {
  constructor(cena, tex, q, centro) {
    this.centro = centro.clone();
    this.raio = 85;
    this.raioOrbita = 21;
    this.grupo = new THREE.Group();
    this.grupo.position.copy(centro);
    this.grupo.rotation.set(0.42, 0, 0.28);
    cena.add(this.grupo);

    this.horizonte = new THREE.Mesh(new THREE.SphereGeometry(6.2, 48, 32), new THREE.MeshBasicMaterial({ color: '#000000' }));
    this.grupo.add(this.horizonte);

    const rand = criarRng(606);
    const n = Math.round(22000 * q);
    const aR = new Float32Array(n);
    const aAng = new Float32Array(n);
    const aY = new Float32Array(n);
    const aTam = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      aR[i] = 8.5 + 44 * Math.pow(rand(), 1.7);
      aAng[i] = rand() * Math.PI * 2;
      aY[i] = gauss(rand) * 0.25 * (aR[i] / 15);
      aTam[i] = 0.18 + rand() * 0.35;
    }
    this.u = { uOpac: { value: 0 }, uT: { value: 0 }, uDestaque: { value: 0 } };
    this.disco = pontos(
      geometria({ aR: [aR, 1], aAng: [aAng, 1], aY: [aY, 1], aTam: [aTam, 1] }, n),
      materialPontos({
        uniforms: this.u,
        perto: 12,
        cabecalho: /* glsl */ `
          attribute float aR; attribute float aAng; attribute float aY; attribute float aTam;
          uniform float uOpac; uniform float uT; uniform float uDestaque;
        `,
        corpo: /* glsl */ `
          float w = 22.0 / pow(aR, 1.5);
          float ang = aAng + uT * w * (1.0 + uDestaque * 0.6);
          pos = vec3(cos(ang) * aR, aY, sin(ang) * aR);
          float quente = 1.0 - smoothstep(8.5, 52.0, aR);
          cor = mix(vec3(0.75, 0.18, 0.55), vec3(1.0, 0.55, 0.2), smoothstep(0.15, 0.55, quente));
          cor = mix(cor, vec3(1.0, 0.95, 0.85), smoothstep(0.7, 1.0, quente));
          cor *= (0.5 + 1.1 * quente) * (1.0 + uDestaque * 0.4);
          tam = aTam;
          alfa = uOpac;
        `,
      })
    );
    this.grupo.add(this.disco);
    this.anelFoton = sprite(tex.anel, '#ffdcae', 17.5, 0);
    this.brilho = sprite(tex.brilho, '#ff6a3d', 150, 0);
    this.grupo.add(this.brilho, this.anelFoton);
  }

  get normal() {
    return new THREE.Vector3(0, 1, 0).applyQuaternion(this.grupo.quaternion);
  }

  atualizar(t, destaque, estrela, formacao) {
    this.grupo.visible = formacao > 0.001;
    this.u.uOpac.value = formacao;
    this.u.uT.value = t;
    this.u.uDestaque.value = destaque;
    this.anelFoton.material.opacity = (0.45 + destaque * 0.15) * formacao;
    this.brilho.material.opacity = (0.14 + destaque * 0.1) * formacao * longeDaCamera(this.brilho);
  }
}

/** Poeira cósmica espalhada ao longo do caminho: dá sensação de velocidade (paralaxe). */
export class PoeiraViagem {
  constructor(cena, q, viagem) {
    const rand = criarRng(707);
    const n = Math.round(9000 * q);
    const pos = new Float32Array(n * 3);
    const cor = new Float32Array(n * 3);
    const tam = new Float32Array(n);
    const v = new THREE.Vector3();
    const p = new THREE.Vector3();
    const cs = ['#b9a7ff', '#8fb3ff', '#e7d9ff', '#ff9fe0'].map((h) => new THREE.Color(h));
    for (let i = 0; i < n; i++) {
      viagem.pontoBase(rand() * viagem.L, p);
      naEsfera(rand, v);
      const r = 3 + Math.cbrt(rand()) * 65;
      p.addScaledVector(v, r);
      pos.set([p.x, p.y, p.z], i * 3);
      const c = cs[Math.floor(rand() * cs.length)];
      cor.set([c.r, c.g, c.b], i * 3);
      tam[i] = 0.1 + rand() * rand() * 0.45;
    }
    this.u = { uOpac: { value: 0 } };
    this.pontos = pontos(
      geometria({ position: [pos, 3], aCor: [cor, 3], aTam: [tam, 1] }, n),
      materialPontos({
        uniforms: this.u,
        perto: 2,
        cabecalho: 'attribute vec3 aCor; attribute float aTam; uniform float uOpac;',
        corpo: 'pos = position; cor = aCor; tam = aTam; alfa = uOpac * 0.8;',
      })
    );
    cena.add(this.pontos);
  }

  atualizar(opac) {
    this.pontos.visible = opac > 0.001;
    this.u.uOpac.value = opac;
  }
}
