/**
 * Gera as fotos do site pela API da Higgsfield (cobrança por uso), a partir do
 * pedido em imagens-horizon.json. Mesmo comportamento do gerar_imagens.py, em
 * Node — que já vem instalado neste computador, sem precisar de Python.
 *
 * Uso (de dentro desta pasta):
 *   node gerar_imagens.js imagens-horizon.json            gera todas as imagens
 *   node gerar_imagens.js imagens-horizon.json hero        gera só as citadas
 *   node gerar_imagens.js imagens-horizon.json --testar    só confere a chave, sem gastar
 *   node gerar_imagens.js imagens-horizon.json --orcar     mostra o que seria enviado, sem enviar
 *
 * A chave NUNCA fica neste arquivo nem no repositório. O programa procura, nesta ordem:
 *   1) a variável de ambiente HF_KEY
 *   2) o arquivo chave.local.txt desta pasta (está no .gitignore)
 *   3) no Windows, a variável HF_KEY gravada no registro do usuário, caso tenha
 *      sido criada pelo painel com o terminal já aberto
 * O formato é "id-da-chave:segredo", o mesmo do SDK oficial.
 *
 * Cada imagem sai em ../_imagens-geradas com um número de variação (hero-1.png,
 * hero-2.png...), para escolher antes de levar ao site. O resultado.json ao lado
 * guarda o request_id e o status de cada pedido. Essa pasta fica fora do Git.
 * Documentação da API: https://docs.higgsfield.ai
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const API = 'https://api.higgsfield.ai';
const ESPERA_ENTRE_CONSULTAS = 4000;   // ms
const ESPERA_MAXIMA = 6 * 60 * 1000;   // ms por imagem
const FINAIS = new Set(['completed', 'failed', 'nsfw', 'canceled']);
const EXTENSOES = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp' };

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------- chave ---------- */

function doArquivoLocal() {
  const arq = path.join(__dirname, 'chave.local.txt');
  if (!fs.existsSync(arq)) return '';
  for (const linha of fs.readFileSync(arq, 'utf8').split(/\r?\n/)) {
    const v = linha.trim();
    /* a primeira linha com o formato id:segredo — o texto de instrução é ignorado */
    if (v && !v.startsWith('#') && v.includes(':') && !/\s/.test(v)) return v;
  }
  return '';
}

function doRegistroWindows() {
  if (process.platform !== 'win32') return '';
  try {
    const saida = execFileSync('reg', ['query', 'HKCU\\Environment', '/v', 'HF_KEY'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const m = saida.match(/HF_KEY\s+REG_[A-Z_]+\s+(.+)/);
    return m ? m[1].trim() : '';
  } catch { return ''; }
}

function lerChave() {
  const chave = (process.env.HF_KEY || '').trim() || doArquivoLocal() || doRegistroWindows();
  if (!chave.includes(':')) {
    console.error(
      'Chave da Higgsfield não encontrada.\n' +
      'Cole a chave (formato id:segredo) na primeira linha de:\n  ' +
      path.join(__dirname, 'chave.local.txt') + '\n' +
      'ou crie a variável de ambiente HF_KEY com esse valor.');
    process.exit(1);
  }
  return chave;
}

/* ---------- chamadas ---------- */

async function chamar(metodo, url, chave, corpo) {
  const cabecalhos = { Authorization: 'Key ' + chave, Accept: 'application/json' };
  const opcoes = { method: metodo, headers: cabecalhos };
  if (corpo !== undefined) {
    cabecalhos['Content-Type'] = 'application/json';
    /* a documentação pede uma chave única por envio: é ela que impede cobrança
       dobrada se um mesmo envio for repetido (este programa não repete envios) */
    cabecalhos['Idempotency-Key'] = require('crypto').randomUUID();
    opcoes.body = JSON.stringify(corpo);
  }
  const resp = await fetch(url, opcoes);
  const texto = await resp.text();
  try {
    return { codigo: resp.status, corpo: texto ? JSON.parse(texto) : {} };
  } catch {
    return { codigo: resp.status, corpo: { erro_bruto: texto.slice(0, 500) } };
  }
}

async function baixar(url, destinoSemExtensao) {
  const resp = await fetch(url, { headers: { 'User-Agent': 'gerar_imagens/1.0' } });
  if (!resp.ok) throw new Error('HTTP ' + resp.status + ' ao baixar a imagem');
  const tipo = (resp.headers.get('content-type') || '').split(';')[0].trim();
  const dados = Buffer.from(await resp.arrayBuffer());
  const ext = EXTENSOES[tipo] || path.extname(new URL(url).pathname) || '.png';
  const destino = destinoSemExtensao + ext;
  fs.writeFileSync(destino, dados);
  return { destino, bytes: dados.length };
}

async function testar(chave) {
  /* pedido inexistente: 404 prova que a chave foi aceita; 401/403 que não foi */
  const id = require('crypto').randomUUID();
  const { codigo } = await chamar('GET', `${API}/requests/${id}/status`, chave);
  if (codigo === 401 || codigo === 403) {
    console.error(`Chave recusada pela API (HTTP ${codigo}). Confira o id e o segredo.`);
    process.exit(1);
  }
  console.log(`Chave aceita pela API (HTTP ${codigo} para um pedido inexistente, como esperado).`);
}

/* ---------- principal ---------- */

async function main() {
  const args = process.argv.slice(2);
  const sinalizadores = new Set(args.filter((a) => a.startsWith('--')));
  const livres = args.filter((a) => !a.startsWith('--'));
  if (!livres.length) {
    console.error(fs.readFileSync(__filename, 'utf8').split('*/')[0]);
    process.exit(1);
  }

  const pedidoArq = path.resolve(livres[0]);
  const soEstas = new Set(livres.slice(1));
  const chave = lerChave();

  if (sinalizadores.has('--testar')) return testar(chave);

  const pedido = JSON.parse(fs.readFileSync(pedidoArq, 'utf8'));
  const saida = path.resolve(path.dirname(pedidoArq), pedido.saida);
  const modeloPadrao = pedido.modelo_padrao;
  const parametrosPadrao = pedido.parametros_padrao || {};

  const imagens = pedido.imagens.filter((i) => !soEstas.size || soEstas.has(i.nome));
  if (!imagens.length) {
    console.error('Nenhuma imagem do pedido bate com os nomes informados.');
    process.exit(1);
  }

  if (sinalizadores.has('--orcar')) {
    let variacoes = 0;
    console.log(`Seriam enviados ${imagens.length} pedido(s), sem gastar nada agora:\n`);
    for (const img of imagens) {
      const p = { ...parametrosPadrao, ...(img.parametros || {}) };
      variacoes += p.batch_size || 1;
      console.log(`  ${img.nome.padEnd(24)} ${img.modelo || modeloPadrao}  ${p.aspect_ratio}  ${p.resolution}  x${p.batch_size || 1}`);
    }
    console.log(`\nTotal: ${variacoes} imagem(ns) geradas. Saída: ${saida}`);
    return;
  }

  fs.mkdirSync(saida, { recursive: true });

  /* 1) envia tudo de uma vez; a API processa em paralelo */
  const pendentes = [];
  const relatorio = [];
  for (const img of imagens) {
    const modelo = img.modelo || modeloPadrao;
    const corpo = { ...parametrosPadrao, ...(img.parametros || {}), prompt: img.prompt };
    const { codigo, corpo: resp } = await chamar('POST', `${API}/${modelo}`, chave, corpo);
    const item = { nome: img.nome, modelo, http: codigo };
    if (codigo >= 400 || !resp.status_url) {
      item.erro = resp;
      console.log(`[${img.nome}] recusado (HTTP ${codigo}): ${JSON.stringify(resp).slice(0, 300)}`);
    } else {
      item.request_id = resp.request_id;
      item.status_url = resp.status_url;
      item.inicio = Date.now();
      pendentes.push(item);
      console.log(`[${img.nome}] enviado (${modelo})`);
    }
    relatorio.push(item);
  }

  /* 2) acompanha até cada pedido terminar */
  while (pendentes.length) {
    await dormir(ESPERA_ENTRE_CONSULTAS);
    for (const item of [...pendentes]) {
      const { corpo: resp } = await chamar('GET', item.status_url, chave);
      const status = resp.status;
      if (FINAIS.has(status)) {
        item.status = status;
        pendentes.splice(pendentes.indexOf(item), 1);
        if (status === 'completed') {
          item.arquivos = [];
          const midias = resp.images || [];
          for (let n = 0; n < midias.length; n++) {
            const { destino, bytes } = await baixar(midias[n].url, path.join(saida, `${item.nome}-${n + 1}`));
            item.arquivos.push({ arquivo: path.basename(destino), bytes, url: midias[n].url });
            console.log(`[${item.nome}] pronto: ${path.basename(destino)} (${Math.round(bytes / 1024)} KB)`);
          }
        } else {
          item.erro = resp.error;
          console.log(`[${item.nome}] terminou como ${status}: ${JSON.stringify(resp.error || '')}`);
        }
      } else if (Date.now() - item.inicio > ESPERA_MAXIMA) {
        item.status = 'sem resposta no prazo';
        pendentes.splice(pendentes.indexOf(item), 1);
        console.log(`[${item.nome}] sem resposta em ${ESPERA_MAXIMA / 60000} min — request_id ${item.request_id}`);
      }
    }
  }

  fs.writeFileSync(path.join(saida, 'resultado.json'),
    JSON.stringify(relatorio, null, 2), 'utf8');
  const prontas = relatorio.reduce((s, i) => s + (i.arquivos ? i.arquivos.length : 0), 0);
  console.log(`\n${prontas} arquivo(s) em ${saida}`);
}

main().catch((e) => { console.error(e.message || e); process.exit(1); });
