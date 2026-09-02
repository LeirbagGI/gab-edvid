# LUTs da Fase 1 (F1)

12 `.cube` (formato Adobe/Resolve, `LUT_3D_SIZE 17`, `DOMAIN 0..1`), gerados pelo
próprio projeto — `node luts/gerar.js` reescreve os 12 arquivos a partir das
fórmulas em `gerar.js`. Sem download, sem licença de terceiro: cada LUT é uma
transformação matemática pura sobre `(r,g,b)`, documentada no `TITLE` e nos
comentários `#` do cabeçalho do arquivo.

Consumidas por `src/shared/cor.js` (lista `LUTS`, com `id`, `nome`, `descricao`,
`arquivo`) e aplicadas no render pelo filtro `lut3d` do ffmpeg.

| id | nome | o que faz |
|---|---|---|
| `neutro` | Neutro | identidade — grade de referência, sem alteração nenhuma |
| `quente` | Quente | ganho no vermelho, corte leve no azul |
| `frio` | Frio | o inverso da Quente: corte no vermelho, ganho no azul |
| `teal-orange` | Teal & Orange | sombras puxam para ciano, luzes puxam para laranja, por curva de luminância |
| `contraste-suave` | Contraste suave | curva S leve: escurece sombra, clareia luz, sem exagero |
| `contraste-forte` | Contraste forte | curva S forte, mais separação entre sombra e luz |
| `desbotado` | Desbotado | preto elevado, branco reduzido, saturação −20% (efeito filme escaneado) |
| `vintage` | Vintage | desbotado + quente + leve verde nas sombras |
| `pb` | Preto e branco | dessatura total (luminância nos três canais) |
| `pb-contraste` | P&B contrastado | dessatura + curva S forte |
| `vivido` | Vívido | saturação +25%, curva S leve |
| `noite` | Noite | azul nas sombras, luzes neutras, exposição −10% |

Cada arquivo carrega no cabeçalho `TITLE "<id>"` e um comentário `# formula: ...`
com a fórmula exata usada para gerá-lo — abra qualquer `.cube` para conferir.
