import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { HEADLINES, LEGENDAS } from './presets.js';

const aqui = path.dirname(fileURLToPath(import.meta.url));
const FONTES = path.join(aqui, '..', '..', 'public', 'fontes');

const MODOS_VALIDOS = ['frase', 'palavra', 'nenhum', 'acumula'];

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

test('há 25 legendas, todas com id único', () => {
  assert.equal(LEGENDAS.length, 25);
  const ids = LEGENDAS.map((l) => l.id);
  assert.equal(new Set(ids).size, ids.length, `ids repetidos: ${ids.join(', ')}`);
});

test('toda legenda tem nome, modo válido, base() e ativo(cor) retornando objeto', () => {
  for (const l of LEGENDAS) {
    assert.equal(typeof l.nome, 'string', `${l.id}: sem nome`);
    assert.ok(l.nome.length > 0, `${l.id}: nome vazio`);
    assert.ok(MODOS_VALIDOS.includes(l.modo), `${l.id}: modo inválido "${l.modo}"`);

    const base = l.base('#EE7533');
    assert.equal(typeof base, 'object', `${l.id}: base() não retornou objeto`);
    assert.ok(base !== null, `${l.id}: base() retornou null`);

    const ativo = l.ativo('#EE7533');
    assert.equal(typeof ativo, 'object', `${l.id}: ativo(cor) não retornou objeto`);
    assert.ok(ativo !== null, `${l.id}: ativo(cor) retornou null`);
  }
});

test('os campos opcionais do contrato, quando existem, retornam objeto ou string', () => {
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

test('as fontes novas do D1 (Inter, Playfair Display, Fredoka) existem depois deste trabalho', () => {
  for (const familia of ['Inter', 'Playfair Display', 'Fredoka']) {
    const arquivos = FAMILIA_ARQUIVO[familia];
    const existe = arquivos.some((f) => fs.existsSync(path.join(FONTES, f)));
    assert.ok(existe, `"${familia}" ainda não tem arquivo em public/fontes/`);
  }
});

test('os 16 estilos novos de legenda existem, cada um com id esperado', () => {
  const esperados = [
    'neon', 'maquina', 'pop', 'caixa-preta', 'gradiente', 'sublinhada',
    'sombra-dura', 'hormozi', 'discreta', 'serif', 'bolha', 'fita',
    'glitch', 'duas-cores', 'esmaecida', 'contorno-cor',
  ];
  const ids = new Set(LEGENDAS.map((l) => l.id));
  for (const id of esperados) assert.ok(ids.has(id), `preset "${id}" não existe`);
});
