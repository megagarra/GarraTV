# Handoff: StreamFlix — UI do app IPTV (6 telas)

## Visão geral
UI estática de um player IPTV (layout inspirado em players Xtream Codes, identidade visual "streaming escuro + vermelho"). Telas: Login, Dashboard, TV ao vivo, Filmes, Séries e Detalhe (filme/série). Foco em TV/desktop 16:9 com navegação por controle remoto e adaptação para mobile.

## Sobre os arquivos de design
`StreamFlix.dc.html` é uma **referência de design em HTML**, um protótipo que mostra o visual e o comportamento esperados. **Não é código de produção.** A tarefa é **recriar o design no codebase `xstream-player`** (Next.js App Router + Tailwind) usando os padrões já existentes:
- Rotas: `app/streamflix/{home,live,movies,series,title/[kind],favorites}`
- Componentes: `components/streamflix/{Shell,Header,CategorySidebar,LivePreview,PosterTile,CatalogScreen}.tsx`
- Classes de foco/botões: `components/streamflix/styles.ts` (`focusCard`, `focusPoster`, `fieldClass`, `primaryButton`, `ghostButton`). Elas já batem com os tokens abaixo. Reaproveite e estenda essas classes, sem duplicar.
- Navegação por controle: `app/hooks/useTvNavigation.ts` / `components/TvNavigationProvider.tsx` (o protótipo tem uma navegação espacial simples por setas só para demonstração; use a do projeto).
- Dados reais: `useCatalogData.ts`, `epg.ts`, contexts (`Favorites`, `Auth`, `Data`). O protótipo usa dados mockados.

Abra o HTML direto no navegador. O prop `startScreen` (no topo da lógica) escolhe a tela inicial: `login | dash | live | movies | series | detail-movie | detail-series`.

## Fidelidade
**Alta fidelidade (hi-fi).** Cores, tipografia, espaçamentos e estados finais. Imagens são placeholders (gradientes listrados com legenda monoespaçada). Substituir por backdrops/pôsteres/logos reais do TMDb/Xtream.

## Design tokens
**Cores**
| Token | Valor |
|---|---|
| bg-black | `#000000` (login, header, sidebar) |
| bg | `#141414` (fundo das telas, card do login) |
| surface-1 | `#1F1F1F` (cards, inputs da busca, botões redondos) |
| surface-2 | `#2A2A2A` (item ativo, hover) |
| input | `#333333` (inputs do login, trilho das barras de progresso) |
| border | `#333333` (bordas sutis); divisores `#222222` / `#1C1C1C` |
| primary | `#E50914`; hover/foco `#B20710` |
| text | `#FFFFFF`; secundário `#B3B3B3`; terciário/contagens `#8C8C8C` |
| rating star | `#F5C451` |
| ghost button | `rgba(109,109,110,.45)` → hover `.7` |
| foco anel | `0 0 0 3px #E50914` (ou `#FFFFFF` sobre botão vermelho) |

**Tipografia** (Google Fonts)
- Títulos/logo/caps: **Montserrat** 700/800/900
- Corpo/UI: **Manrope** 400–800
- Legendas de placeholder: JetBrains Mono 11px (só no protótipo)
- Escala usada: 11 (badges, caps com `letter-spacing .12–.2em`), 12, 13, 14, 15, 16, 20, 22, 26, 28, 34, 56, 60px

**Raios:** 4px (badges, itens de lista), 6px (inputs, botões, pôsteres), 8px (cards, player, card do login), 10px (atalhos), 12px (cards do dashboard), 50% (botões de ícone).

**Sombras:** card hover `0 24px 60px rgba(0,0,0,.7)`; pôster hover `0 18px 40px rgba(0,0,0,.75)`; card login `0 30px 80px rgba(0,0,0,.7)`.

**Motion:** 200ms (cores, bg, bordas), 250ms (escala de cards/pôsteres). Easing padrão (`ease`).

**Ícones:** lineares estilo Lucide (stroke 2, round caps). Use `lucide-react`: `Search, RefreshCw, User, Settings, Tv, Film, Clapperboard, CalendarDays, LayoutGrid, History, Heart, Star, Eye, EyeOff, ArrowLeft, Play, List, ChevronDown, Volume2, Maximize, Clock, Video, Link`.

## Shell (todas as telas internas)
**Header** — altura 72px, `#000`, borda inferior `1px #222`, sticky, padding horizontal 40px (16px mobile).
- Esquerda: botão voltar (40×40 redondo, `#1F1F1F`, borda `#333`, hover borda vermelha) → Dashboard (do Detalhe volta para Filmes/Séries); logo "STREAMFLIX" Montserrat 900 24px `#E50914` uppercase (clicável → Dashboard); divisor 1×24 `#333` + título da seção (Montserrat 700 14px, caps, `letter-spacing .12em`). Sem voltar/título no Dashboard.
- Direita: hora (Manrope 800 16px, tabular) + data por extenso (12px `#B3B3B3`, `pt-BR`); pílula "Vence em: **15/03/2027**" (32px altura, borda `#333`, radius 16); 3 botões de ícone redondos 40px: Atualizar, Conta, Configurações. Relógio + vencimento escondidos abaixo de 1100px.

**Sidebar** (TV, Filmes, Séries) — coluna ~20% (`minmax(240px,20fr)`), `#000`, borda direita `#222`, padding 20px 12px, scroll vertical próprio (altura `100vh - 72px`, `overflow-x:hidden`).
- Busca: 44px, `#1F1F1F`, borda `#333`, ícone lupa à esquerda (padding-left 42), foco borda vermelha.
- Itens de categoria: 44px, radius 4, padding `0 14px 0 18px`, 14px. Contagem à direita 12px `#8C8C8C` tabular. Inativo: texto `#B3B3B3` peso 500. **Ativo:** fundo `#2A2A2A`, texto branco 700, barra vermelha 4px à esquerda (inset vertical 8px). Hover: fundo `#2A2A2A`. Foco: + `inset 0 0 0 2px #E50914`.
- Itens especiais com ícone 16px: "Favoritos" (estrela/coração), "Adicionados recentemente" (relógio). Divisor 1px `#222` antes das categorias de gênero.
- Categorias TV: Todos 248, Favoritos 12, Esportes 34, Notícias 22, Filmes 41, Infantil 19, Documentários 16, Música 14, Variedades 30.
- Categorias Filmes: Todos, Adicionados recentemente, Favoritos, Ação, Comédia, Drama, Terror, Ficção científica, Animação, Documentário, Nacional. Séries: Todos, Adicionados recentemente, Favoritos, Policial, Drama, Comédia, Suspense, Ficção científica, Animação, Reality, Nacional.

## Telas

### 01 Login
- Fundo `#000` com mosaico de pôsteres (grade 8 colunas, gap 12, `blur(5px)`, `rotate(-4deg) scale(1.15)`) + overlay `rgba(0,0,0,.8)` + vinheta radial (transparente 25% → `rgba(0,0,0,.9)`).
- Topo: logo STREAMFLIX 34px Montserrat 900 vermelho, alinhado à esquerda num container de 1240px.
- Card central: max-width 450, `#141414`, radius 8, padding `44px 44px 36px`, borda `1px #262626`, gap 22, margin-top 7vh.
- Título "Entrar com Xtream Codes" Montserrat 800 28px; sub 14px `#B3B3B3` "Use os dados de acesso enviados pelo seu provedor."
- Campos (label 13px 600 `#B3B3B3`, gap 8; input 50px, `#333`, radius 6, 15px branco): "Nome da lista (opcional)", "URL do servidor" (placeholder `http://servidor.com:8080`), "Usuário", "Senha" (botão olho/olho-cortado 40×40 dentro do input à direita). Foco: borda `#E50914` + `0 0 0 3px rgba(229,9,20,.25)`.
- Botão "ENTRAR": largura total, 52px, `#E50914`, Montserrat 800 15px, `letter-spacing .14em`, hover `#B20710`, foco + anel branco 3px.
- Link "Entrar com lista M3U" (ícone link, 14px 600 `#B3B3B3` → branco). Alterna o formulário para modo M3U: Nome da lista + "URL da lista M3U" (`http://servidor.com/lista.m3u`), título "Entrar com lista M3U", link volta para "Entrar com Xtream Codes".

### 02 Dashboard
- `main` com padding `28px 40px 32px`, altura `100vh - 72px`, coluna com gap 20.
- Grade: `grid-template-columns: 1.25fr 1fr; grid-template-rows: minmax(220px,1fr) minmax(220px,1fr); gap 20`.
  - **TV AO VIVO** ocupa as 2 linhas à esquerda. Badge "● AO VIVO" (vermelho, 26px, 11px 800 caps) no topo-esquerdo. Conteúdo ancorado embaixo-esquerda (left/right 36, bottom 34): ícone Tv 88px, título Montserrat 900 56px, sub "248 canais · 12 favoritos" 15px `#B3B3B3`.
  - **FILMES** e **SÉRIES** empilhados à direita: ícone 52px, título 34px, sub "1.240 títulos" / "386 séries".
  - Fundo dos cards: imagem de backdrop + gradiente `linear-gradient(135deg, <tinta>, #1F1F1F 55%, #0a0a0a)` + escurecimento de baixo (`rgba(0,0,0,.85)` → transparente 60–70%). Tintas: TV `#4A0A0E`, Filmes `oklch(0.30 0.03 260)`, Séries `oklch(0.30 0.03 160)`.
  - Radius 12, borda 3px transparente. **Hover/foco:** borda `#E50914`, `scale(1.05)`, `brightness(1.18)`, sombra grande, z-index 2. 250ms.
- Atalhos: grade 4 colunas gap 16, cada um 84px, `#1F1F1F`, borda 2px `#333`, radius 10, ícone 26 + label 16px 700: "Guia (EPG)", "Multi-tela", "Catch Up", "Favoritos". Hover/foco: `scale(1.04)`, borda vermelha, fundo `#2A2A2A`.

### 03 TV ao vivo (3 colunas: 20 / 35 / 45)
- **Lista de canais** (`35fr`, borda direita `#222`, scroll próprio):
  - Cabeçalho sticky (`#141414`, padding 18/20): nome da categoria Montserrat 800 20px + "N canais" 12px; à direita o alternador **lista/grade** (segmentado: container `#1F1F1F` borda `#333` padding 3; botões 36×30, ativo `#333` branco, inativo `#8C8C8C`).
  - Linha (modo lista): padding `12px 12px 12px 20px`, borda inferior `#1C1C1C`. Número do canal (32px de largura, 13px 700 `#8C8C8C`), logo 52×52 radius 6, nome 15px 700, programa atual 13px `#B3B3B3`, barra de progresso 3px (`#333` → `#E50914`) + horário de término 11px; estrela 36×36 à direita (favorito: preenchida `#E50914`; não: contorno `#777`). Selecionado: fundo `#2A2A2A` + barra vermelha 4px à esquerda. Foco: anel inset 2px vermelho.
  - Modo grade: `repeat(auto-fill,minmax(140px,1fr))` gap 12; tile `#1F1F1F` borda 2px (`#E50914` se selecionado), logo 16:9, nome + número, barra de progresso.
  - Vazio: "Nenhum canal encontrado."
- **Prévia** (`45fr`, padding `24px 28px 40px`, gap 24):
  - Player 16:9 radius 8: badge AO VIVO + "101 · Nome do canal" no topo-esquerdo; botão play central 72px (`rgba(0,0,0,.5)`, borda branca 2px, hover vermelho + `scale(1.08)`); barra de controles inferior em gradiente (play, volume, progresso, "14:00 – 16:00", tela cheia).
  - "GUIA DE PROGRAMAÇÃO" (12px 700 caps `.16em` `#B3B3B3`) + link "Guia completo".
  - Card **Agora** (`#1F1F1F`, borda `#2A2A2A`, radius 8, padding 20): "AGORA" 11px 800 vermelho + horário; título Montserrat 800 22px; barra 4px; descrição 14px/1.6 `#B3B3B3`.
  - **A seguir:** lista com borda `#2A2A2A` radius 8; linhas `#181818` padding 14/18: horário 14px 700, título 14px `#B3B3B3`, duração 12px.
  - Botões: "Tela cheia" (vermelho, 46px) e "Catch Up" (ghost).
  - Clicar numa linha seleciona o canal e atualiza a prévia.

### 04 Filmes / 05 Séries (2 colunas: 20 / 80)
- Área de conteúdo: padding `28px 36px 48px`, scroll próprio.
- Barra superior: nome da categoria Montserrat 800 28px + "N títulos" 14px; à direita "Ordenar por" + segmentado **A-Z | Mais recentes | Avaliação** (botões 32px, ativo `#2A2A2A` branco).
- Grade: `repeat(auto-fill, minmax(160px,1fr))`, gap `28px 20px` (≈5–6 por linha em 1920).
- Pôster 2:3 radius 6 borda 2px transparente; nota no canto superior direito (pílula `rgba(0,0,0,.72)` 22px, estrela `#F5C451` + "7.8" 12px 800); em Séries, badge vermelho "3 temp." no canto superior esquerdo. **Hover/foco:** `scale(1.08)`, borda `#E50914`, sombra `0 18px 40px rgba(0,0,0,.75)`, 250ms.
- Abaixo: título 14px 700 (ellipsis) + "2024 · Gênero" 12px `#B3B3B3`.
- Clicar → Detalhe. Vazio: "Nenhum título nesta categoria."

### 06 Detalhe
- Hero: min-height 600px, backdrop largura total; gradiente `90deg: #000 0%, rgba(0,0,0,.92) 30%, rgba(0,0,0,.55) 62%, rgba(0,0,0,.1) 100%` + fade inferior para `#141414`. Padding `120px 56px 56px`, conteúdo alinhado embaixo, gap 40.
- Pôster 250px (2:3, radius 8, sombra `0 30px 60px rgba(0,0,0,.7)`).
- Bloco de info (max 720, gap 18): "FILME"/"SÉRIE" 12px 800 `.2em` vermelho; título Montserrat 900 60px/1; meta 15px `#B3B3B3`: ★ nota (branco 800), ano, duração (filme "2h 17min" / série "3 temporadas"), classificação (pílula com borda `#555`), gênero; sinopse 16px/1.6 branca; "Elenco:" e "Direção:" 14px.
- Botões 52px radius 6: **▶ ASSISTIR** (vermelho, Montserrat 800 `.08em`), **Trailer** e **♡ Favoritar** (ghost `rgba(109,109,110,.45)`). Hover `scale(1.03)`. Favoritar alterna para coração preenchido vermelho + "Favoritado".
- **Séries:** seção "Episódios" (Montserrat 800 26px, padding `8px 56px 64px`, max-width 1280) + dropdown "Temporada N" (44px, `#2A2A2A`, borda `#333`, chevron). Linha de episódio: número Montserrat 700 26px `#8C8C8C`, miniatura 210px 16:9 com botão play 40px e barra de progresso de "continuar assistindo", título 16px 700 + duração 13px à direita, sinopse 14px/1.5 `#B3B3B3` limitada a 2 linhas. Hover `#1F1F1F`, foco anel inset vermelho.

## Interações e comportamento
- Fluxo: Login → ENTRAR → Dashboard → (TV / Filmes / Séries) → pôster → Detalhe. O voltar do header volta ao Dashboard (do Detalhe volta para a listagem de origem). Atalho "Favoritos" abre a TV na categoria Favoritos.
- Busca filtra a lista/grade atual por nome (e programa atual, na TV).
- Estrela/coração alternam favorito na hora (usar `FavoritesContext`).
- Ordenação: A-Z (`localeCompare` pt), Mais recentes (ano desc), Avaliação (nota desc). Persistir com `useSortPreference`.
- **Foco por controle remoto:** todo elemento interativo precisa de foco visível (borda/anel vermelho, escala nos cards). Não depender de `:focus-visible` (TVs antigas), como já faz `styles.ts`. Setas movem o foco espacialmente; Enter ativa.
- Transições: 200ms para cor/fundo/borda, 250ms para escala.

## Responsivo (< 820px)
- Header: padding 16px; sem título de seção, relógio e vencimento.
- Dashboard: 1 coluna (linhas 240 / 200 / 200px), TV AO VIVO com ícone 56 e título 36px; atalhos em 2×2.
- Sidebar vira barra sticky abaixo do header: busca + **chips horizontais roláveis** (36px, radius 18; ativo `#E50914`, inativo `#1F1F1F` borda `#333`), com contagem.
- TV: prévia (player + EPG) em cima, lista de canais embaixo.
- Grade de pôsteres `minmax(120px,1fr)`; Detalhe: pôster 140px, título 36px, hero com altura automática; miniaturas de episódio 120px.

## Estado (protótipo → app)
`screen`, `loginMode ('xtream'|'m3u')`, `showPw`, categoria ativa por seção, canal selecionado, `liveView ('list'|'grid')`, `sort`, `q` (busca), item em detalhe `{type,id}`, `season`, favoritos. No app, rotas substituem `screen`, e os dados vêm de `DataContext`/`useCatalogData`/`epg.ts`.

## Assets
Nenhum asset real incluso. Placeholders a substituir: mosaico do login, backdrops dos 3 cards do dashboard, logos de canal (no mock são iniciais sobre gradiente), frame do player, pôsteres, backdrop do hero, miniaturas de episódio. Ícones: `lucide-react`. Nome "StreamFlix" e o wordmark são fictícios, em texto (sem logo de terceiros).

## Arquivos
- `StreamFlix.dc.html`: protótipo navegável com as 6 telas (abra no navegador; precisa de `support.js` na mesma pasta).
