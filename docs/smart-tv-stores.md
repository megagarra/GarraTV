# GarraTV em todas as smart TVs — pesquisa e plano

Pesquisa feita em 03/11/2026 para levar o GarraTV às lojas de apps das smart TVs. Ela cobre
as plataformas, o que cada loja exige, o que o código já entrega e o que falta.
Fontes no fim.

## Resumo

| Plataforma | TVs | Loja | Tecnologia | Situação no GarraTV | Prioridade |
|---|---|---|---|---|---|
| **Android TV / Google TV** | TCL, Sony, Xiaomi, Philips (até 2025), Chromecast, TV boxes | Google Play | APK/AAB (já existe) | **Pronto** ([google-play.md](./google-play.md)) | 1 |
| **Fire TV (Fire OS)** | Fire TV Stick 4K/Max, Cube | Amazon Appstore | O mesmo APK | Quase pronto: falta conferir se o APK roda sem os serviços do Google | 2 |
| **Samsung (Tizen)** | Samsung | Samsung Seller Office | Web app empacotado (`.wgt`) | Só o client "lite" em ES5 de `tv/bootstrap/` | 3 |
| **LG (webOS)** | LG | LG Content Store (Seller Lounge) | Web app empacotado (`.ipk`) | Só o client "lite" | 3 |
| **Fire TV (Vega OS)** | Fire TV Stick 4K Select, novos sticks | Amazon Appstore | Vega WebView / React Native | Nada | 4 |
| **Titan OS** | Philips 2026, JVC, Sharp (Europa e LATAM) | Titan OS (parceria) | Web app **hospedado** (URL HTTPS) | Nada | Depois |
| **VIDAA** | Hisense, Toshiba | VIDAA (parceria, sem portal aberto) | Web app hospedado | Nada | Depois |
| **Roku** | Roku TV (AOC, Semp e outras no Brasil) | Roku Channel Store | BrightScript nativo | Exigiria reescrever tudo | Fora |
| **Apple TV** | Apple TV | App Store | Swift nativo | Exigiria reescrever tudo | Fora |

Com os itens 1 e 2, o mesmo APK já cobre a maior parte das TVs vendidas no Brasil (TCL,
Philips antigas, Xiaomi, TV boxes, Fire TV Stick). Samsung e LG são o próximo bloco grande e
exigem trabalho de engenharia.

## Por plataforma

### 1. Google Play — Android TV e Google TV

- O pacote cumpre as exigências técnicas (target API 36, AAB, leanback, banner). O passo a
  passo da submissão está em [google-play.md](./google-play.md).
- Cabe ao dono da conta: taxa de US$ 25, verificação de identidade e, em conta pessoal nova,
  **teste fechado com 12 testadores por 14 dias** antes da produção.
- **A partir de 30/09/2026** o Google bloqueia, aos poucos e por país, apps instalados fora do
  Play por desenvolvedores não verificados em aparelhos certificados. Instalar por `adb` ou
  pendrive deixa de ser um caminho seguro de distribuição. Ou seja, o Play deixa de ser
  opcional.

### 2. Amazon Appstore — Fire TV com Fire OS

- O Fire OS é Android: o mesmo APK serve, mas precisa rodar sem o Google Play Services
  (conferir) e o manifesto deve declarar recursos de TV (`android.software.leanback`,
  touchscreen não obrigatório). O GarraTV já faz isso.
- Conta de desenvolvedor Amazon gratuita. A Amazon testa o app contra casos de teste
  publicados antes de liberar.
- **Os Fire TV novos rodam Vega OS** (anunciado em 30/09/2025, começando pelo Fire TV Stick 4K
  Select): eles **não rodam APK** e só instalam da Appstore. O caminho ali é o **Vega
  WebView**, que carrega um web app existente. É um projeto separado (item 4).
- A Amazon bloqueia, na instalação e na abertura, apps que identifica como acesso a conteúdo
  não licenciado.

### 3. Samsung (Tizen)

- Publicação pelo **Samsung Seller Office**. **Fora dos EUA é obrigatório ser "Partner
  Seller"**, que exige um grupo vendedor com **dados de empresa** e aprovação de um Content
  Manager da Samsung. Na prática: CNPJ (MEI serve como ponto de partida) e um contato na
  Samsung.
- A certificação testa o app e devolve os defeitos encontrados. Navegação por controle,
  política de privacidade e player de vídeo da plataforma (AVPlay ou `<video>`) são
  exigências citadas. Prazo relatado: de 2–4 semanas a meses.
- Existe teste beta de até 90 dias com códigos de ativação (TVs 2021+), útil enquanto a loja
  não aprova.

### 4. LG (webOS)

- Publicação pelo **LG Seller Lounge**, que **aceita vendedor pessoa física**
  ("Individual Seller"). O país da conta LG não pode ser trocado depois, então crie no Brasil.
- Na submissão vão o `.ipk`, imagens, um **documento de cenário de UX** e um **checklist de
  autoavaliação**. Depois a QA da LG testa o app.
- O Developer Mode (como é hoje) continua servindo para testes, mas expira a cada 1000 h e
  não é distribuição.

### Titan OS e VIDAA

- Os dois exigem um **web app hospedado** (uma URL HTTPS) e parceria comercial (VIDAA não tem
  portal aberto; Titan atende por apponboarding@titanos.tv).
- Para o GarraTV isso é difícil: uma página HTTPS não pode chamar provedores Xtream em HTTP
  (conteúdo misto) nem sem CORS. Seria preciso um **proxy público** por onde passam as
  credenciais e os streams dos usuários. Isso traz custo e um risco jurídico que o projeto
  hoje evita. Fica para depois.

### Roku e Apple TV

Só aceitam apps nativos (BrightScript/SceneGraph e Swift). Seria um segundo produto inteiro.
Fora do escopo.

## Risco que vale para todas as lojas: política de IPTV

- As lojas proíbem apps que "facilitam" streaming não autorizado (Google Play: *Encouraging
  Infringement of Copyright*). Players de IPTV caem nisso por **denúncia de detentor de
  direitos**. Exemplos de 2026: a JioStar derrubou 36 apps de IPTV do Play e da App Store
  durante o T20 World Cup (XCIPTV, IPTV Smarters Pro, Televizo…), e o TiviMate saiu do Play de
  novo. A Amazon bloqueia apps assim mesmo no Fire OS.
- O que reduz o risco (o GarraTV já segue quase tudo, ver [google-play.md](./google-play.md)):
  - não fornecer nem vender nenhum conteúdo e dizer isso na ficha;
  - capturas e vídeo da ficha **só com canais abertos e legais**;
  - nunca citar canais, filmes, ligas ou marcas na ficha;
  - dar ao revisor um caminho que funcione **sem conta**: a tela de canais grátis
    (`/garratv/free`) é esse caminho e precisa continuar acessível na primeira tela;
  - nada de listas, URLs de provedores ou "planos" dentro do app.

## O que falta no código

### A. Fire OS (pouco)

1. Rodar o APK atual num emulador ou num Fire TV com Fire OS e confirmar que nada depende do
   Google Play Services.
2. Gerar as imagens da ficha da Amazon a partir das de `docs/play/`.

### B. Samsung e LG com o app completo (grande — é o trabalho de verdade)

Hoje `tv/bootstrap/` é um player "lite" de ~600 linhas em ES5. Ele fala direto com o
provedor, mas não tem a interface do GarraTV (home, detalhes, temporadas, favoritos,
continuar assistindo). O Android já resolve isso com o app completo e sem servidor: export
estático do Next + as rotas de API rodando na página (`android/web/`) + o Kotlin fazendo as
chamadas de rede e o relay. Levar isso para Tizen/webOS significa:

1. **Mesmo export do Android, com outra camada de rede.** Em app empacotado, o Tizen libera
   chamadas cross-origin com `<access origin="*">` (já no `config.xml`) e o webOS libera para
   apps empacotados. Então `nativeFetch.ts` vira um `fetch`/XHR direto, sem a ponte Kotlin.
   *Validar nos emuladores antes de tudo.*
2. **Roteamento fora de `file://`.** O motivo registrado em
   [tv-client-spec.md](./tv-client-spec.md) para não empacotar o Next é que caminhos absolutos
   `/_next/*` e `history.pushState` quebram em `file://`. Saídas possíveis: `assetPrefix`
   relativo + navegação do App Router presa a uma única página com roteamento em hash, ou
   servir o pacote pela origem `app://`/`widget://` da plataforma. **É o principal risco
   técnico.** Vale uma prova de conceito curta antes de prometer prazo.
3. **Vídeo.** O Android usa `LiveRelay`/`VodProxy` em Kotlin. Na TV: tocar `.m3u8`/`.ts`
   direto no `<video>` (a mídia nativa de Tizen/webOS aceita os dois) e, no Tizen, AVPlay como
   alternativa. O `.ts` ao vivo não passa pelo hls.js.
4. **Piso de browser.** O piso do app moderno já é Chromium 53 (webOS 4), então o bundle
   serve. Tizen 6+ (TVs 2021+) é Chromium 76+.
5. **Atualizar [tv-client.md](./tv-client.md)**, que ainda descreve o pareamento com servidor.

### C. Vega OS (médio, depois de B)

Com o export web de B funcionando, o Vega WebView carrega o mesmo bundle.

## Ordem sugerida

1. **Agora, sem código:** criar as contas (Google Play, Amazon Developer, LG Seller Lounge) e
   começar o teste fechado de 14 dias do Play com o AAB atual.
2. **Fire OS:** validar o APK e submeter na Amazon.
3. **Prova de conceito Tizen/webOS** (item B.1–B.2) nos emuladores. Decidir se o app completo
   empacotado é viável ou se o "lite" é melhorado para a primeira versão da loja.
4. **LG** primeiro (aceita pessoa física), depois **Samsung** (exige empresa + parceria).
5. Vega OS, e só então Titan/VIDAA, se houver demanda.

## Fontes

- Google Play — [Encouraging Infringement of Copyright](https://support.google.com/googleplay/android-developer/answer/9888072)
- Remoção de 36 apps de IPTV em 2026 — [Indian Television](https://indiantelevision.com/iworld/jiostar-removes-36-iptv-apps-from-google-play-and-app-store/), [Storyboard18](https://www.storyboard18.com/ott-news/google-play-ios-purge-36-iptv-apps-with-26-million-downloads-taken-down-amid-t20-world-cup-91220.htm)
- Bloqueio de sideload no Android a partir de 30/09/2026 — [Tuneline](https://tuneline.app/blog/android-sideloading-2026-what-it-means)
- Samsung — [Distribuição no Seller Office](https://developer.samsung.com/smarttv/develop/distribute/seller-office.html), [Partner Seller](https://developer.samsung.com/tv-seller-office/guides/membership/becoming-partner.html)
- LG — [App Ecosystem (tipos de vendedor)](https://webostv.developer.lge.com/distribute/app-ecosystem), [App Approval Process](https://webostv.developer.lge.com/distribute/app-approval-process), [fórum: país da conta](https://forum.webostv.developer.lge.com/t/how-to-take-membership-to-publish-the-webostv-in-lg-seller-lounge/4165)
- Amazon — [Anúncio do Vega OS](https://developer.amazon.com/apps-and-games/blogs/2025/09/announcing-vega-os), [It's FOSS](https://itsfoss.com/news/amazon-vega-os/)
- Titan OS — [Developer Portal](https://docs.titanos.tv/introduction)
- VIDAA — [Muvi: publicar app VIDAA](https://help.muvi.com/help/how-to-create-and-publish-your-vidaa-app)
- Roku — [Certification overview](https://developer.roku.com/docs/developer-program/certification/overview.md)
- Mercado — [Dataintelo: Smart TV platforms](https://dataintelo.com/report/global-smart-tv-platforms-market) (estimativas pagas, só como ordem de grandeza)
