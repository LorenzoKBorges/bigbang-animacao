# Big Bang — animação

Um site que é só uma animação do Big Bang, em 3D (WebGL com [three.js](https://threejs.org/)).

## Como ver

Abra o `index.html` no navegador. Funciona até com dois cliques no arquivo, sem servidor.
Também funciona em qualquer hospedagem estática (GitHub Pages, Netlify, Vercel…).

## O que acontece

São **15 segundos** do clique até a tela branca, tudo em tons de roxo.

| Tempo (após o clique) | Cena |
| --- | --- |
| antes do clique | Um ponto branco-arroxeado pulsa no meio do espaço, puxando partículas de energia. |
| 0 – 1,55 s | A pessoa clica (ou toca, ou aperta Enter/Espaço): o ponto treme, pulsa cada vez mais rápido, solta raios e implode. |
| 1,55 s | **Big Bang**: clarão, ondas de choque, plasma roxo, nuvens de gás, protogaláxias, estrelas novas e rochas passando pela câmera. |
| 2,45 – 3,4 s | A câmera voa até uma estrela roxa que se acende no meio da explosão. |
| 3,4 – 4,6 s | A estrela, com três bolinhas de luz girando em volta (os "malabares"), atravessa um braço da galáxia por dentro, no meio das estrelas. |
| 4,6 – 5,3 s | Ela sobe para fora do disco e "carrega" o salto; a câmera vira para o lado e volta para trás dela. |
| 5,3 – 6,3 s | **Salto**: as estrelas viram riscos, o campo de visão abre e um clarão marca a chegada num sistema solar. |
| 6,3 – 9,9 s | Um sol roxo-branco e quatro planetas girando no próprio eixo e em volta do sol (rochoso, gelo, magenta e oceano). A estrela faz estilingue gravitacional em cada um, vista de cima. |
| 9,9 – 13,15 s | A estrela chega em Saturno (o planeta de fora desse sistema) e dá uma volta completa (360°) em volta dele, e a câmera dá a volta inteira junto com ela. Depois a estrela para ao lado de Saturno. |
| 13,15 – 15 s | A estrela treme, solta raios, engole os malabares, contrai e explode. A tela fica **branca**. |

## Colocando conteúdo depois da animação

A animação termina numa tela branca e mostra o `<main id="final">` do `index.html`.
É só colocar o que quiser dentro dele (ele já tem fundo branco e pode rolar):

```html
<main id="final" hidden>
  <h1>Meu conteúdo</h1>
</main>
```

Se precisar de JavaScript nesse momento, escute o evento `bigbang:fim`:

```js
window.addEventListener('bigbang:fim', () => {
  // a animação acabou e a tela está branca
});
```

O CSS do final fica em `css/estilo.css` (`body.fim` e `#final`).

## Atalhos para desenvolver

Coloque no fim do endereço:

| Parâmetro | O que faz |
| --- | --- |
| `?fim` | Pula direto para a tela branca final (útil para montar o conteúdo de depois). |
| `?t=5` | Começa a animação no segundo 5. |
| `?t=5&pausa` | Congela no segundo 5. |
| `?qualidade=0.5` | Menos partículas (o padrão já é mais leve no celular). |

## Mexendo na animação

O código fica em `src/`. O arquivo que o site carrega (`js/bigbang.js`) é gerado a partir dele:

```bash
npm install
```

```bash
npm run build
```

Para ir regerando sozinho enquanto edita:

```bash
npm run dev
```

| Arquivo | O quê |
| --- | --- |
| `src/main.js` | Linha do tempo (durações), posições dos objetos, câmera e clarões. |
| `src/singularidade.js` | O ponto pulsante e a sobrecarga. |
| `src/explosao.js` | A explosão (usada no Big Bang e na explosão final da estrela). |
| `src/universo.js` | Céu, galáxia e Saturno. |
| `src/sistema.js` | O sistema solar: sol, os quatro planetas e as linhas das órbitas. |
| `src/salto.js` | O efeito do salto (riscos de hiperespaço). |
| `src/estrela.js` | A estrela, os malabares e os rastros. |
| `src/viagem.js` | O caminho da estrela (braço, salto, estilingues, volta em Saturno), a velocidade em cada trecho e as câmeras. |
| `src/texturas.js` | Texturas desenhadas na hora (não há imagens). |

As durações ficam no topo de `src/main.js` (`CARGA`, `VIAGEM_DUR`, …) e as cores de cada parte no próprio arquivo dela.
