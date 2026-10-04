# Gerar as fotos do site pela API da Higgsfield

Pasta fora do site: o GitHub Pages não publica pastas que começam com `_`.
Custo por uso, sem plano — cerca de US$ 0,06 para as 9 fotos com 2 versões de cada.

## A chave

Cole a chave (formato `id:segredo`, criada em https://open.higgsfield.ai) na
primeira linha de **`chave.local.txt`**, nesta pasta. Esse arquivo está no
`.gitignore`: fica só neste computador e nunca sobe para o GitHub.

Quem preferir pode usar a variável de ambiente `HF_KEY` com o mesmo valor —
os dois programas procuram nela primeiro.

## Gerar (Node, já instalado neste computador)

Abra um terminal **nesta pasta** (`_ferramentas`) e rode:

```
node gerar_imagens.js imagens-horizon.json --orcar     # mostra o que seria enviado, sem gastar
node gerar_imagens.js imagens-horizon.json --testar    # confere a chave, sem gastar
node gerar_imagens.js imagens-horizon.json             # gera todas as fotos
node gerar_imagens.js imagens-horizon.json hero        # gera só as citadas
```

## Gerar (Python, se preferir)

Mesmos comandos, trocando `node gerar_imagens.js` por `python gerar_imagens.py`.
Precisa do Python 3 instalado (python.org) e da variável de ambiente `HF_KEY` —
a versão em Python não lê o `chave.local.txt`.

## Depois de gerar

As candidatas saem em `_imagens-geradas/` (fora do Git), duas de cada e
numeradas: `hero-1.png`, `hero-2.png`... Escolhemos juntos, as escolhidas são
otimizadas para `img/` com os nomes que o `index.html` espera, e a pasta de
candidatas é descartada.

As descrições de cada foto estão em `imagens-horizon.json` — dá para ajustar o
texto e gerar de novo só a imagem que não ficou boa.
