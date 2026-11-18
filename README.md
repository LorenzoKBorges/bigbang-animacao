# Big Bang — animação

Um site que é só uma animação do Big Bang, em 3D (WebGL com [three.js](https://threejs.org/)).

## Como ver

Abra o `index.html` no navegador. Funciona até com dois cliques no arquivo, sem servidor.
Também funciona em qualquer hospedagem estática (GitHub Pages, Netlify, Vercel…).

## O que acontece

São **29 segundos** do clique até a tela branca, tudo em tons de roxo.

| Tempo (após o clique) | Cena |
| --- | --- |
| antes do clique | Um ponto branco-arroxeado pulsa no meio do espaço, puxando partículas de energia. |
| 0 – 2,25 s | A pessoa clica (ou toca, ou aperta Enter/Espaço): o ponto treme, pulsa cada vez mais rápido, solta raios e implode. |
| 2,25 s | **Big Bang**: clarão, ondas de choque, plasma roxo, nuvens de gás, protogaláxias, estrelas novas e rochas passando pela câmera. |
| 2,25 – 4,45 s | A câmera, parada, assiste à explosão enquanto uma estrela roxa se acende no meio dela. |
| 4,45 – 7,25 s | A câmera primeiro vira devagar para a estrela e depois vai, sem pressa, até ficar atrás dela. |
| 7,25 – 10,7 s | A estrela, com três bolinhas de luz girando em volta (os "malabares"), sai do repouso e desce até a galáxia de seis braços, que aparece inteira, vista de cima. |
| 10,7 – 13,3 s | Ela entra pela ponta de um braço e vai por dentro dele, no meio das estrelas, atravessando uma **nebulosa** colorida. |
| 13,3 – 14,9 s | Seguindo a espiral do braço ela chega ao núcleo e dá meia-volta em torno de um **buraco negro** com disco de acreção. |
| 14,9 – 15,7 s | Ela sai pela tangente, reto para um pontinho brilhante noutro braço (o sistema solar, 400 vezes menor que ela), com a câmera sempre atrás dela. |
| 15,7 – 17,5 s | **Lupa**: tudo é ampliado em volta do pontinho enquanto a câmera se afasta devagar. As estrelas do braço se espalham e passam pela câmera, e o pontinho vira o sistema solar inteiro. |
| 17,5 – 20,4 s | Visto de longe, com os oito planetas girando no próprio eixo e em volta do sol: a estrela começa em Netuno e vai para Vênus e Júpiter, sempre em curvas abertas (estilingue gravitacional em cada planeta). |
| 20,4 – 22,3 s | De Júpiter a Mercúrio a câmera desce até a estrela e a segue girando em volta da direção dela, em espiral. |
| 22,3 – 26,75 s | A estrela voa para Saturno e dá uma volta completa (360°) em volta dele, mais aberta do outro lado; a câmera dá a volta inteira junto. Depois a estrela para ao lado de Saturno. |
| 26,75 – 29 s | A estrela treme, solta raios, engole os malabares, contrai e explode. A tela fica **branca**. |

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
| `src/universo.js` | Céu, galáxia (6 braços, a nebulosa e o buraco negro do núcleo; `BRACOS` muda quantos braços) e Saturno. |
| `src/sistema.js` | O sistema solar: sol, os planetas (tamanho, órbita, cores, rotação) e as linhas das órbitas. |
| `src/estrela.js` | A estrela, os malabares e os rastros. |
| `src/viagem.js` | O caminho da estrela (braço da galáxia, nebulosa, buraco negro, lupa, Netuno → Vênus → Júpiter → Mercúrio, volta em Saturno), a velocidade em cada trecho e as câmeras. |
| `src/texturas.js` | Texturas desenhadas na hora (não há imagens). |

As durações ficam no topo de `src/main.js` (`CARGA`, `VIAGEM_DUR`, …) e as cores de cada parte no próprio arquivo dela.
