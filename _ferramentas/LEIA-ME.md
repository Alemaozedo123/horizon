# Gerar as fotos do site pela API da Higgsfield

Pasta fora do site: o GitHub Pages não publica pastas que começam com `_`.
Custo por uso, sem plano — cerca de US$ 0,06 para as 9 fotos com 2 versões de cada.

1. **Python 3** instalado (python.org). Confira no terminal: `python --version`
2. **Chave**: variável de ambiente `HF_KEY` com `id:segredo`, criada em
   https://open.higgsfield.ai. Nunca coloque a chave em arquivo do repositório.
3. Abra um terminal **nesta pasta** (`_ferramentas`) e teste a chave, sem custo:

   ```
   python gerar_imagens.py imagens-horizon.json --testar
   ```

4. Gere as fotos (ou só algumas, citando os nomes: `... hero escritorio`):

   ```
   python gerar_imagens.py imagens-horizon.json
   ```

5. As candidatas saem em `_imagens-geradas/` (fora do Git). Para trazer ao site
   sem precisar de Git neste computador: no GitHub, **Add file → Upload files**,
   arraste a pasta `_imagens-geradas` inteira e confirme. O Claude escolhe com
   você, otimiza as escolhidas para `img/` com os mesmos nomes e depois apaga a
   pasta de candidatas do repositório.

As descrições de cada foto estão em `imagens-horizon.json` — dá para ajustar o
texto e gerar de novo só a imagem que não ficou boa.
