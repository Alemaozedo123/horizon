/**
 * Gera um vídeo curto a partir de uma imagem já criada, pela API da Higgsfield.
 *
 * Uso (de dentro desta pasta):
 *   node gerar_video.js videos-horizon.json              gera todos os vídeos do pedido
 *   node gerar_video.js videos-horizon.json hero-globo   gera só os citados
 *   node gerar_video.js videos-horizon.json --orcar      mostra o custo estimado, sem enviar
 *
 * A imagem de entrada não precisa estar hospedada em lugar nenhum: o pedido usa
 * a URL que a própria Higgsfield devolveu ao gerar a imagem, guardada no
 * _imagens-geradas/resultado.json. Basta citar o nome da imagem em "origem".
 *
 * A chave sai do mesmo lugar do gerar_imagens.js: a variável de ambiente HF_KEY
 * ou a primeira linha de chave.local.txt (que está no .gitignore).
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const API = 'https://api.higgsfield.ai';
const ESPERA_ENTRE_CONSULTAS = 6000;    // ms
const ESPERA_MAXIMA = 15 * 60 * 1000;   // ms por vídeo — 4K demora mais que imagem
const FINAIS = new Set(['completed', 'failed', 'nsfw', 'canceled']);
const EXTENSOES = { 'video/mp4': '.mp4', 'video/webm': '.webm', 'video/quicktime': '.mov' };

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
const MODELO_NAO_PREENCHIDO = /COLARCHAVE/i;

function doArquivoLocal() {
  const arq = path.join(__dirname, 'chave.local.txt');
  if (!fs.existsSync(arq)) return '';
  for (const linha of fs.readFileSync(arq, 'utf8').split(/\r?\n/)) {
    const v = linha.trim();
    if (!v || v.startsWith('#') || MODELO_NAO_PREENCHIDO.test(v)) continue;
    const limpa = v.replace(/^["']|["']$/g, '').replace(/^Key\s+/i, '').trim();
    if (limpa.includes(':') && !/\s/.test(limpa)) return limpa;
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
    console.error('Chave da Higgsfield não encontrada. Veja o LEIA-ME desta pasta.');
    process.exit(1);
  }
  return chave;
}

async function chamar(metodo, url, chave, corpo) {
  const cabecalhos = { Authorization: 'Key ' + chave, Accept: 'application/json' };
  const opcoes = { method: metodo, headers: cabecalhos };
  if (corpo !== undefined) {
    cabecalhos['Content-Type'] = 'application/json';
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
  const resp = await fetch(url, { headers: { 'User-Agent': 'gerar_video/1.0' } });
  if (!resp.ok) throw new Error('HTTP ' + resp.status + ' ao baixar o vídeo');
  const tipo = (resp.headers.get('content-type') || '').split(';')[0].trim();
  const dados = Buffer.from(await resp.arrayBuffer());
  const ext = EXTENSOES[tipo] || path.extname(new URL(url).pathname) || '.mp4';
  const destino = destinoSemExtensao + ext;
  fs.writeFileSync(destino, dados);
  return { destino, bytes: dados.length };
}

/* a URL que a Higgsfield devolveu para cada imagem já gerada */
function urlDaImagem(pastaImagens, nomeImagem) {
  const arq = path.join(pastaImagens, 'resultado.json');
  if (!fs.existsSync(arq)) {
    throw new Error('Não achei ' + arq + ' — gere a imagem de origem antes do vídeo.');
  }
  const relatorio = JSON.parse(fs.readFileSync(arq, 'utf8'));
  const item = relatorio.find((i) => i.nome === nomeImagem);
  if (!item || !item.arquivos || !item.arquivos.length) {
    throw new Error('A imagem "' + nomeImagem + '" não consta como gerada em ' + arq);
  }
  return item.arquivos[0].url;
}

async function main() {
  const args = process.argv.slice(2);
  const sinalizadores = new Set(args.filter((a) => a.startsWith('--')));
  const livres = args.filter((a) => !a.startsWith('--'));
  if (!livres.length) {
    console.error(fs.readFileSync(__filename, 'utf8').split('*/')[0]);
    process.exit(1);
  }

  const pedidoArq = path.resolve(livres[0]);
  const soEstes = new Set(livres.slice(1));
  const pedido = JSON.parse(fs.readFileSync(pedidoArq, 'utf8'));
  const base = path.dirname(pedidoArq);
  const saida = path.resolve(base, pedido.saida);
  const pastaImagens = path.resolve(base, pedido.pasta_imagens);
  const modeloPadrao = pedido.modelo_padrao;
  const parametrosPadrao = pedido.parametros_padrao || {};

  const videos = pedido.videos.filter((v) => !soEstes.size || soEstes.has(v.nome));
  if (!videos.length) {
    console.error('Nenhum vídeo do pedido bate com os nomes informados.');
    process.exit(1);
  }

  if (sinalizadores.has('--orcar')) {
    let total = 0;
    console.log('Seriam enviados ' + videos.length + ' pedido(s), sem gastar nada agora:\n');
    for (const v of videos) {
      const p = { ...parametrosPadrao, ...(v.parametros || {}) };
      const seg = p.duration || 5;
      const custo = seg * (pedido.custo_por_segundo || 0);
      total += custo;
      console.log('  ' + v.nome.padEnd(20) + (v.modelo || modeloPadrao).padEnd(38) +
        seg + 's  ~US$ ' + custo.toFixed(2) + '  (a partir de "' + v.origem + '")');
    }
    console.log('\nTotal estimado: ~US$ ' + total.toFixed(2) + '. Saída: ' + saida);
    return;
  }

  const chave = lerChave();
  fs.mkdirSync(saida, { recursive: true });

  const pendentes = [];
  const relatorio = [];
  for (const v of videos) {
    const modelo = v.modelo || modeloPadrao;
    let imagem;
    try {
      imagem = v.image_url || urlDaImagem(pastaImagens, v.origem);
    } catch (e) {
      console.log('[' + v.nome + '] ' + e.message);
      relatorio.push({ nome: v.nome, erro: e.message });
      continue;
    }
    const corpo = { ...parametrosPadrao, ...(v.parametros || {}), prompt: v.prompt, image_url: imagem };
    const { codigo, corpo: resp } = await chamar('POST', `${API}/${modelo}`, chave, corpo);
    const item = { nome: v.nome, modelo, http: codigo };
    if (codigo >= 400 || !resp.status_url) {
      item.erro = resp;
      console.log(`[${v.nome}] recusado (HTTP ${codigo}): ${JSON.stringify(resp).slice(0, 300)}`);
    } else {
      item.request_id = resp.request_id;
      item.status_url = resp.status_url;
      item.inicio = Date.now();
      pendentes.push(item);
      console.log(`[${v.nome}] enviado (${modelo}) — 4K demora alguns minutos`);
    }
    relatorio.push(item);
  }

  while (pendentes.length) {
    await dormir(ESPERA_ENTRE_CONSULTAS);
    for (const item of [...pendentes]) {
      const { corpo: resp } = await chamar('GET', item.status_url, chave);
      const status = resp.status;
      if (FINAIS.has(status)) {
        item.status = status;
        pendentes.splice(pendentes.indexOf(item), 1);
        if (status === 'completed') {
          /* o vídeo vem num campo próprio (objeto), não na lista de imagens */
          const midia = resp.video || (resp.videos && resp.videos[0]);
          if (!midia || !midia.url) {
            item.erro = 'terminou sem URL de vídeo';
            console.log(`[${item.nome}] terminou sem vídeo: ${JSON.stringify(resp).slice(0, 300)}`);
          } else {
            const { destino, bytes } = await baixar(midia.url, path.join(saida, item.nome));
            item.arquivo = { arquivo: path.basename(destino), bytes, url: midia.url };
            console.log(`[${item.nome}] pronto: ${path.basename(destino)} (${Math.round(bytes / 1024 / 1024 * 10) / 10} MB)`);
          }
        } else {
          item.erro = resp.error;
          console.log(`[${item.nome}] terminou como ${status}: ${JSON.stringify(resp.error || '')}`);
        }
      } else if (Date.now() - item.inicio > ESPERA_MAXIMA) {
        item.status = 'sem resposta no prazo';
        pendentes.splice(pendentes.indexOf(item), 1);
        console.log(`[${item.nome}] sem resposta em ${ESPERA_MAXIMA / 60000} min — request_id ${item.request_id}`);
      } else {
        process.stdout.write('.');
      }
    }
  }

  fs.writeFileSync(path.join(saida, 'resultado-videos.json'),
    JSON.stringify(relatorio, null, 2), 'utf8');
  const prontos = relatorio.filter((i) => i.arquivo).length;
  console.log(`\n${prontos} vídeo(s) em ${saida}`);
}

main().catch((e) => { console.error(e.message || e); process.exitCode = 1; });
