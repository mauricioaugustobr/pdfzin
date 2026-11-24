# PDFZIN

Leitor e editor de PDF **grátis e open source** que roda 100% no navegador. Seu arquivo nunca sai do seu computador: não tem servidor, não tem cadastro, não tem marca d'água.

**Use agora:** https://mauricioaugustobr.github.io/pdfzin/

## O que dá pra fazer

**Ler**
- Abrir qualquer PDF (botão, `Ctrl+O` ou arrastando o arquivo pra janela), inclusive protegido por senha
- Rolagem contínua, zoom (`Ctrl +`/`Ctrl -`, `Ctrl` + roda do mouse) e miniaturas das páginas
- Selecionar e copiar o texto do PDF
- Buscar texto (`Ctrl+F`), sem ligar pra acento ou maiúscula: "acao" acha "Ação"

**Editar**
- **Texto** em qualquer lugar da página (com acentos, várias linhas, cor e tamanho)
- **Desenho** à mão livre
- **Marca-texto**
- **Retângulo**
- **Corretivo** (cobre com branco)
- **Imagem** (PNG, JPG, WebP, GIF)
- **Assinatura** desenhada com mouse ou dedo
- Mover, redimensionar, mudar cor e apagar qualquer edição (ferramenta "Ajustar")
- Desfazer e refazer (`Ctrl+Z` / `Ctrl+Y`)

**Páginas**
- Girar, reordenar (arrastando ou com ↑ ↓), excluir
- Juntar outros PDFs no final (botão "+ PDF" ou arrastando mais arquivos)
- Inserir página em branco

No fim, **Baixar PDF** (`Ctrl+S`) gera um PDF novo com tudo gravado nas páginas.

### Atalhos

| Tecla | Ferramenta |
| --- | --- |
| `V` | Ler |
| `S` | Ajustar |
| `T` | Texto |
| `D` | Desenho |
| `H` | Marca-texto |
| `R` | Retângulo |
| `W` | Corretivo |
| `Delete` | Apaga a edição selecionada |

## Bom saber

- O **corretivo cobre visualmente**, mas o texto original continua dentro do arquivo (dá pra selecionar e copiar). Pra esconder dado sensível de verdade, use uma ferramenta de redação/tarja que remova o conteúdo.
- O texto inserido usa Helvetica: português funciona inteiro; emojis e alfabetos não latinos viram `?`.
- PDFs protegidos por senha abrem pra leitura, mas não dá pra salvar edições neles.
- O PDFZIN ainda não preenche formulários de PDF.

## Rodando no seu computador

Precisa de Node.js 22 ou mais novo.

```bash
git clone https://github.com/mauricioaugustobr/pdfzin.git
cd pdfzin
npm install
npm run dev      # abre em http://localhost:5173
npm run build    # gera o site estático em dist/
```

O `dist/` é só HTML, CSS e JS: dá pra publicar em qualquer hospedagem estática (GitHub Pages, Netlify, Vercel, Cloudflare Pages). Este repositório publica sozinho no GitHub Pages a cada push na `main` (`.github/workflows/deploy.yml`).

## Como funciona

- [PDF.js](https://github.com/mozilla/pdf.js) (Mozilla) desenha as páginas e a camada de texto.
- [pdf-lib](https://github.com/Hopding/pdf-lib) monta o PDF final: copia as páginas na ordem e giro escolhidos e grava as edições no conteúdo de cada página.
- As edições ficam guardadas em coordenadas do próprio PDF, então o que você vê na tela é o que sai no arquivo, em qualquer zoom ou giro.
- TypeScript sem framework, empacotado com Vite.

```
src/
  main.ts       interface, visualização, ferramentas, busca e páginas
  draw.ts       desenha as edições na tela
  geometry.ts   coordenadas, seleção e redimensionamento
  save.ts       gera o PDF final (pdf-lib) e o PDF de exemplo
  pdf.ts        abre PDFs com o PDF.js
  types.ts      tipos das páginas e edições
```

## Contribuindo

Issues e pull requests são bem-vindos. Ideias pra próximas versões: preencher formulários, notas adesivas, extrair páginas em outro PDF, tema claro, PWA pra usar offline.

## Licença

[MIT](LICENSE). Use, copie, modifique e distribua à vontade.

---

**English:** PDFZIN is a free, open source PDF reader and editor that runs entirely in your browser — add text, drawings, highlights, images and signatures, rotate/reorder/merge/delete pages, and download the result. Your file never leaves your device. MIT licensed.
