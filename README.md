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

## Funciona offline e instala como app

Depois da primeira visita, o PDFZIN abre sem internet: pode fechar a aba, desligar o Wi-Fi e abrir de novo pelo mesmo endereço que ele carrega do cache do navegador e edita PDFs normalmente.

- **Instalar:** no Chrome/Edge, o ícone de instalar na barra de endereço (ou menu › "Instalar PDFZIN"). No celular, "Adicionar à tela inicial". Aí ele abre em janela própria, sem a barra do navegador.
- **Atualizações:** o service worker guarda a versão completa do build. Quando sai uma versão nova, aparece o aviso "Nova versão do PDFZIN disponível" com o botão **Recarregar** — nada muda no meio do seu trabalho sem você mandar.
- **Limites:** a primeira visita precisa de internet (é ela que enche o cache, ~5 MB). Se você limpar os dados do site, volta a precisar de rede uma vez. No Firefox dá pra usar offline, mas não tem botão de instalar.
- O modo offline é o mesmo app: nenhum arquivo seu vai pra servidor nenhum, com ou sem rede.

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
npm run build    # gera o site estático em dist/ (inclui o sw.js do modo offline)
```

O `dist/sw.js` não é escrito à mão: `scripts/build-sw.mjs` roda depois do Vite, lê os arquivos gerados e monta a lista de precache com um id de versão por build (hash do conteúdo). Se você publicar por outro caminho que não a raiz do domínio, ele continua funcionando: as URLs do cache são relativas ao escopo.

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
  offline.ts    registra o service worker e mostra o aviso de versão nova
  types.ts      tipos das páginas e edições
scripts/
  build-sw.mjs        gera dist/sw.js com a lista de arquivos do build
  copy-pdfjs-assets.mjs  copia fontes/cmaps do PDF.js pra public/
```

## Contribuindo

Issues e pull requests são bem-vindos. Ideias pra próximas versões: preencher formulários, notas adesivas, extrair páginas em outro PDF, tema claro.

## Licença

[MIT](LICENSE). Use, copie, modifique e distribua à vontade.

---

**English:** PDFZIN is a free, open source PDF reader and editor that runs entirely in your browser — add text, drawings, highlights, images and signatures, rotate/reorder/merge/delete pages, and download the result. It works offline and installs as an app after the first visit. Your file never leaves your device. MIT licensed.
