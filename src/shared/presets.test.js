import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { HEADLINES, LEGENDAS } from './presets.js';

const aqui = path.dirname(fileURLToPath(import.meta.url));
const FONTES = path.join(aqui, '..', '..', 'public', 'fontes');

const MODOS_VALIDOS = ['frase', 'palavra', 'nenhum', 'acumula'];
const ENTRADAS_VALIDAS = ['nenhuma', 'pop', 'sobe', 'desfoque', 'fade'];
const ATIVAS_VALIDAS = ['nenhuma', 'pop', 'bounce', 'preenche', 'brilho', 'tremor', 'onda', 'caixa'];

/** "É a família principal" de um valor de font-family CSS: o primeiro nome,
 *  sem aspas — os demais são fallback e não precisam de arquivo (sans-serif,
 *  serif, -apple-system, Impact...). */
const familiaPrincipal = (fontFamily) => fontFamily.split(',')[0].trim().replace(/^["']|["']$/g, '');

/** Família → arquivo(s) em public/fontes/. Pelo menos um precisa existir. */
const FAMILIA_ARQUIVO = {
  Montserrat: ['Montserrat.ttf'],
  Poppins: ['Poppins-Bold.ttf', 'Poppins-ExtraBold.ttf'],
  Anton: ['Anton.ttf'],
  'Bebas Neue': ['BebasNeue.ttf'],
  'Archivo Black': ['ArchivoBlack.ttf'],
  'Luckiest Guy': ['LuckiestGuy.ttf'],
  Inter: ['Inter.ttf'],
  'Playfair Display': ['PlayfairDisplay-Italic.ttf', 'PlayfairDisplay.ttf'],
  Fredoka: ['Fredoka.ttf'],
};

test('há 34 legendas (9 originais + 5 genéricos que ficaram + 20 da referência de mercado), todas com id único', () => {
  assert.equal(LEGENDAS.length, 34);
  const ids = LEGENDAS.map((l) => l.id);
  assert.equal(new Set(ids).size, ids.length, `ids repetidos: ${ids.join(', ')}`);
});

test('toda legenda tem nome, modo válido (quando existe), base() e ativo(cor) retornando objeto', () => {
  for (const l of LEGENDAS) {
    assert.equal(typeof l.nome, 'string', `${l.id}: sem nome`);
    assert.ok(l.nome.length > 0, `${l.id}: nome vazio`);
    if (l.modo !== undefined) assert.ok(MODOS_VALIDOS.includes(l.modo), `${l.id}: modo inválido "${l.modo}"`);

    const base = l.base('#EE7533');
    assert.equal(typeof base, 'object', `${l.id}: base() não retornou objeto`);
    assert.ok(base !== null, `${l.id}: base() retornou null`);

    const ativo = l.ativo('#EE7533');
    assert.equal(typeof ativo, 'object', `${l.id}: ativo(cor) não retornou objeto`);
    assert.ok(ativo !== null, `${l.id}: ativo(cor) retornou null`);
  }
});

test('os campos opcionais do contrato antigo, quando existem, retornam objeto ou string', () => {
  for (const l of LEGENDAS) {
    if (l.passado) assert.equal(typeof l.passado('#EE7533'), 'object', `${l.id}: passado(cor)`);
    if (l.futuro) assert.equal(typeof l.futuro('#EE7533'), 'object', `${l.id}: futuro(cor)`);
    if (l.fundoLinha) assert.equal(typeof l.fundoLinha('#EE7533'), 'object', `${l.id}: fundoLinha(cor)`);
    if (l.transformAtivo !== undefined) {
      assert.equal(typeof l.transformAtivo, 'string', `${l.id}: transformAtivo não é string`);
    }
    if (l.maiusculas !== undefined) {
      assert.equal(typeof l.maiusculas, 'boolean', `${l.id}: maiusculas não é boolean`);
    }
    if (l.posicao !== undefined) {
      assert.ok(['baixo', 'meio', 'alto'].includes(l.posicao), `${l.id}: posicao inválida "${l.posicao}"`);
    }
  }
});

test('toda legenda tem entrada e ativa válidos ou ausentes (o motor cai em "nenhuma")', () => {
  for (const l of LEGENDAS) {
    if (l.entrada !== undefined) assert.ok(ENTRADAS_VALIDAS.includes(l.entrada), `${l.id}: entrada inválida "${l.entrada}"`);
    if (l.ativa !== undefined) assert.ok(ATIVAS_VALIDAS.includes(l.ativa), `${l.id}: ativa inválida "${l.ativa}"`);
    if (l.destaque) assert.equal(typeof l.destaque('#EE7533'), 'object', `${l.id}: destaque(cor)`);
    if (l.agrupamento) {
      if (l.agrupamento.maxPalavras !== undefined) {
        assert.equal(typeof l.agrupamento.maxPalavras, 'number', `${l.id}: agrupamento.maxPalavras`);
      }
      if (l.agrupamento.maxChars !== undefined) {
        assert.equal(typeof l.agrupamento.maxChars, 'number', `${l.id}: agrupamento.maxChars`);
      }
    }
    if (l.emoji !== undefined) {
      assert.equal(typeof l.emoji, 'boolean', `${l.id}: emoji não é boolean`);
      assert.ok(l.emoji === false || l.id === 'emoji', `só o preset "emoji" deveria marcar emoji: true (achado em "${l.id}")`);
    }
  }
});

test('os 9 presets originais e os 5 genéricos mantidos não têm entrada nem ativa (comportamento igual ao de antes)', () => {
  const semMotor = [
    'karaoke', 'karaoke-caixa', 'contorno', 'palavra-unica', 'condensada', 'cartoon', 'barra', 'simples', 'sem-legenda',
    'gradiente', 'bolha', 'fita', 'glitch', 'esmaecida',
  ];
  for (const id of semMotor) {
    const l = LEGENDAS.find((x) => x.id === id);
    assert.ok(l, `preset "${id}" não existe`);
    assert.equal(l.entrada, undefined, `${id}: não deveria ter "entrada"`);
    assert.equal(l.ativa, undefined, `${id}: não deveria ter "ativa"`);
  }
});

test('os 20 estilos novos da referência de mercado (02/09) existem, cada um com id esperado', () => {
  const esperados = [
    'hormozi', 'beast', 'karaoke-preenche', 'caixa-viaja', 'pop-palavra',
    'premium', 'peso', 'brilho', 'sombra-pop', 'empilhada', 'moldura-ouro',
    'primo', 'podcast', 'dark-venda', 'emoji', 'onda', 'desfoque', 'tremor',
    'contorno-vivo', 'marcal',
  ];
  const ids = new Set(LEGENDAS.map((l) => l.id));
  for (const id of esperados) assert.ok(ids.has(id), `preset "${id}" não existe`);
  for (const id of esperados) {
    const l = LEGENDAS.find((x) => x.id === id);
    assert.ok(l.entrada !== undefined, `${id}: deveria ter "entrada"`);
    assert.ok(l.ativa !== undefined, `${id}: deveria ter "ativa"`);
  }
});

test('toda fonte citada em fontFamily das legendas existe em public/fontes/', () => {
  for (const l of LEGENDAS) {
    const { fontFamily } = l.base('#EE7533');
    if (!fontFamily) continue;
    const familia = familiaPrincipal(fontFamily);
    const arquivos = FAMILIA_ARQUIVO[familia];
    assert.ok(arquivos, `${l.id}: família "${familia}" não está mapeada em FAMILIA_ARQUIVO`);
    const existe = arquivos.some((f) => fs.existsSync(path.join(FONTES, f)));
    assert.ok(existe, `${l.id}: nenhum arquivo de "${familia}" encontrado em public/fontes/ (${arquivos.join(', ')})`);
  }
});

test('toda fonte citada em fontFamily das headlines existe em public/fontes/', () => {
  for (const h of HEADLINES) {
    const { fontFamily } = h.estilo('#EE7533');
    if (!fontFamily) continue;
    const familia = familiaPrincipal(fontFamily);
    const arquivos = FAMILIA_ARQUIVO[familia];
    assert.ok(arquivos, `${h.id}: família "${familia}" não está mapeada em FAMILIA_ARQUIVO`);
    const existe = arquivos.some((f) => fs.existsSync(path.join(FONTES, f)));
    assert.ok(existe, `${h.id}: nenhum arquivo de "${familia}" encontrado em public/fontes/ (${arquivos.join(', ')})`);
  }
});
