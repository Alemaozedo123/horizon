"""Gera imagens pela API da Higgsfield (cobrança por uso) a partir de um pedido em JSON.

Uso (de dentro desta pasta):
    python gerar_imagens.py imagens-horizon.json            gera todas as imagens do pedido
    python gerar_imagens.py imagens-horizon.json hero       gera só as imagens citadas
    python gerar_imagens.py imagens-horizon.json --testar   só confere a chave, sem gerar nada

Esta pasta começa com "_" de propósito: o GitHub Pages (Jekyll) não publica
pastas assim, então o script fica versionado no repositório sem aparecer no site.

A chave NÃO fica neste arquivo nem no repositório: o script lê a variável de
ambiente HF_KEY, no formato "id-da-chave:segredo" (o mesmo do SDK oficial), de
cada computador que for rodar. No Windows, criada pelo painel com o terminal já
aberto, a variável ainda não chega a ele — por isso, na falta dela no ambiente,
o script lê direto do registro do usuário (HKCU\\Environment), onde o painel a grava.

Cada imagem sai na pasta "saida" do pedido com um número de variação
(hero-1.png, hero-2.png...), para escolher antes de trocar no site; o
resultado.json ao lado guarda o request_id e o status de cada pedido. A pasta
de saída fica fora do Git (.gitignore): só a escolhida entra em img/.
Documentação da API: https://docs.higgsfield.ai
"""
import json
import os
import sys
import time
import urllib.error
import urllib.request
import uuid
from pathlib import Path

API = "https://api.higgsfield.ai"
ESPERA_ENTRE_CONSULTAS = 4       # segundos
ESPERA_MAXIMA = 6 * 60           # segundos por imagem
FINAIS = {"completed", "failed", "nsfw", "canceled"}
EXTENSOES = {"image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp"}


def ler_chave():
    chave = os.environ.get("HF_KEY", "").strip()
    if not chave and sys.platform == "win32":
        import winreg
        try:
            with winreg.OpenKey(winreg.HKEY_CURRENT_USER, "Environment") as reg:
                chave = str(winreg.QueryValueEx(reg, "HF_KEY")[0]).strip()
        except OSError:
            chave = ""
    if ":" not in chave:
        sys.exit("HF_KEY não encontrada. Crie a variável de ambiente HF_KEY com o valor "
                 "id-da-chave:segredo (painel do Windows > Variáveis de ambiente da sua conta).")
    return chave


def chamar(metodo, url, chave, corpo=None):
    """Faz a chamada e devolve (código HTTP, JSON). Erros HTTP voltam como resposta, não exceção."""
    dados = json.dumps(corpo).encode("utf-8") if corpo is not None else None
    req = urllib.request.Request(url, data=dados, method=metodo)
    req.add_header("Authorization", "Key " + chave)
    req.add_header("Accept", "application/json")
    if dados is not None:
        req.add_header("Content-Type", "application/json")
        # a documentação pede uma chave única por envio: é ela que impede cobrança
        # dobrada se um mesmo envio for repetido (este script não repete envios)
        req.add_header("Idempotency-Key", str(uuid.uuid4()))
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            return resp.status, json.loads(resp.read().decode("utf-8") or "{}")
    except urllib.error.HTTPError as erro:
        texto = erro.read().decode("utf-8", "replace")
        try:
            return erro.code, json.loads(texto)
        except ValueError:
            return erro.code, {"erro_bruto": texto[:500]}


def baixar(url, destino_sem_extensao):
    req = urllib.request.Request(url, headers={"User-Agent": "gerar_imagens/1.0"})
    with urllib.request.urlopen(req, timeout=120) as resp:
        tipo = resp.headers.get_content_type()
        dados = resp.read()
    ext = EXTENSOES.get(tipo) or Path(url.split("?")[0]).suffix or ".png"
    destino = destino_sem_extensao.with_suffix(ext)
    destino.write_bytes(dados)
    return destino, len(dados)


def testar(chave):
    # pedido inexistente: 404 prova que a chave foi aceita; 401/403 que não foi
    codigo, _ = chamar("GET", f"{API}/requests/{uuid.uuid4()}/status", chave)
    if codigo in (401, 403):
        sys.exit(f"Chave recusada pela API (HTTP {codigo}). Confira id e segredo em HF_KEY.")
    print(f"Chave aceita pela API (HTTP {codigo} para um pedido inexistente, como esperado).")


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    if not args:
        sys.exit(__doc__)
    pedido_arq = Path(args[0]).resolve()
    so_estas = set(args[1:])
    chave = ler_chave()
    if "--testar" in sys.argv:
        testar(chave)
        return

    pedido = json.loads(pedido_arq.read_text(encoding="utf-8"))
    saida = (pedido_arq.parent / pedido["saida"]).resolve()
    saida.mkdir(parents=True, exist_ok=True)
    modelo_padrao = pedido["modelo_padrao"]
    parametros_padrao = pedido.get("parametros_padrao", {})

    imagens = [i for i in pedido["imagens"] if not so_estas or i["nome"] in so_estas]
    if not imagens:
        sys.exit("Nenhuma imagem do pedido bate com os nomes informados.")

    # 1) envia tudo de uma vez; a API processa em paralelo
    pendentes, relatorio = [], []
    for img in imagens:
        modelo = img.get("modelo", modelo_padrao)
        corpo = {**parametros_padrao, **img.get("parametros", {}), "prompt": img["prompt"]}
        codigo, resp = chamar("POST", f"{API}/{modelo}", chave, corpo)
        item = {"nome": img["nome"], "modelo": modelo, "http": codigo}
        if codigo >= 400 or "status_url" not in resp:
            item["erro"] = resp
            print(f"[{img['nome']}] recusado (HTTP {codigo}): {json.dumps(resp, ensure_ascii=False)[:300]}")
        else:
            item["request_id"] = resp.get("request_id")
            item["status_url"] = resp["status_url"]
            item["inicio"] = time.time()
            pendentes.append(item)
            print(f"[{img['nome']}] enviado ({modelo})")
        relatorio.append(item)

    # 2) acompanha até cada pedido terminar
    while pendentes:
        time.sleep(ESPERA_ENTRE_CONSULTAS)
        for item in list(pendentes):
            codigo, resp = chamar("GET", item["status_url"], chave)
            status = resp.get("status")
            if status in FINAIS:
                item["status"] = status
                pendentes.remove(item)
                if status == "completed":
                    item["arquivos"] = []
                    for n, midia in enumerate(resp.get("images") or [], start=1):
                        destino, tamanho = baixar(midia["url"], saida / f"{item['nome']}-{n}")
                        item["arquivos"].append({"arquivo": destino.name, "bytes": tamanho, "url": midia["url"]})
                        print(f"[{item['nome']}] pronto: {destino.name} ({tamanho // 1024} KB)")
                else:
                    item["erro"] = resp.get("error")
                    print(f"[{item['nome']}] terminou como {status}: {resp.get('error')}")
            elif time.time() - item["inicio"] > ESPERA_MAXIMA:
                item["status"] = "sem resposta no prazo"
                pendentes.remove(item)
                print(f"[{item['nome']}] sem resposta em {ESPERA_MAXIMA // 60} min — request_id {item['request_id']}")

    (saida / "resultado.json").write_text(
        json.dumps(relatorio, ensure_ascii=False, indent=2), encoding="utf-8")
    prontas = sum(len(i.get("arquivos", [])) for i in relatorio)
    print(f"\n{prontas} arquivo(s) em {saida}")


if __name__ == "__main__":
    main()
