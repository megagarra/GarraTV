# Publicar o GarraTV na Microsoft Store

O build já gera o pacote da loja: `npm run package:windows` cria
`dist/windows/GarraTV-<versão>.appx` (precisa do Windows SDK, já instalado neste PC)
além do instalador `GarraTV-Setup-<versão>.exe`.

A loja assina o `.appx` na publicação — não é preciso comprar certificado.

## 1. Antes de tudo (bloqueios)

- **Licença AGPL**: o código veio de um projeto AGPL-3.0. Quem distribui o app
  precisa oferecer o código-fonte correspondente a quem baixa. Com o repositório
  privado isso não é cumprido — torne `megagarra/GarraTV` público (ou publique o
  código de cada versão lançada) e coloque o link na descrição da loja:
  https://github.com/megagarra/GarraTV
- **Política de privacidade**: a loja exige um link público. O texto está em
  `docs/privacy-policy.md`; com o repositório público, o link é
  https://github.com/megagarra/GarraTV/blob/main/docs/privacy-policy.md
  (já com data e contato preenchidos).
- **Política de conteúdo**: a Microsoft recusa apps que facilitem pirataria. O
  GarraTV é um reprodutor — a descrição e as capturas **não podem** mostrar nem
  prometer canais, filmes ou séries pagos. Use só canais grátis/abertos nas imagens.

## 2. Conta de desenvolvedor

1. Acesse **partner.microsoft.com/dashboard** → *Apps and games* e crie a conta
   de desenvolvedor **individual** (você entra com a sua conta Microsoft e
   preenche os dados — essa etapa é só sua).
2. Em *Apps and games → New product → MSIX or PWA app*, **reserve o nome
   "GarraTV"**.
3. Abra *Product management → Product identity* e anote:
   - `Package/Identity/Name` → `WINDOWS_STORE_IDENTITY`
   - `Package/Identity/Publisher` (começa com `CN=`) → `WINDOWS_STORE_PUBLISHER`
   - `Package/Properties/PublisherDisplayName` → `WINDOWS_STORE_PUBLISHER_DISPLAY`

## 3. Gerar o pacote com a identidade da loja

A identidade do nome reservado já está no `scripts/package-windows.mjs`:

| Campo | Valor |
|---|---|
| Package/Identity/Name | `megagarra.GarraTV` |
| Package/Identity/Publisher | `CN=107A335D-5708-4AE2-93AE-41059E96B243` |
| PublisherDisplayName | `megagarra` |
| ID da Store | `9P9FL2MKFGNJ` |

Basta rodar `npm run package:windows`. O arquivo para enviar é
`dist/windows/GarraTV-<versão>.appx`.

## 4. Envio (submission)

| Campo | O que colocar |
|---|---|
| Pricing | Grátis, todos os mercados (ou só Brasil) |
| Properties → Category | Photo & video (Foto e vídeo) |
| Privacy policy URL | o link público do passo 1 |
| Age ratings | questionário IARC: sem violência/conteúdo próprio; "usuários podem acessar conteúdo da internet" = sim |
| Packages | `GarraTV-<versão>.appx` |
| Store listing (pt-BR e en-US) | textos abaixo + capturas 1920×1080 + logos |

### Texto da loja (pt-BR)

**Descrição curta:** Reprodutor de IPTV para sua conta Xtream Codes e canais abertos.

**Descrição:**
GarraTV é um reprodutor de IPTV rápido e simples. Entre com os dados da sua
conta Xtream Codes, fornecidos pelo seu provedor, e assista TV ao vivo com guia
de programação, filmes e séries, com favoritos e "continuar assistindo".
Sem conta? Assista a canais públicos e abertos de vários países.

O GarraTV não fornece nenhum conteúdo: é preciso ter uma assinatura de um
provedor. Seus dados ficam só no seu computador.

Código-fonte (AGPL-3.0): https://github.com/megagarra/GarraTV

**Recursos:** TV ao vivo com guia · Filmes e séries · Favoritos e perfis ·
Continuar assistindo · Canais abertos grátis · Feito para teclado, mouse e controle

### Imagens

- **Capturas de tela**: pelo menos 1, até 10, em 1920×1080 (mínimo 1366×768) —
  tire do app com canais grátis na tela.
- **Logos da loja**: o pacote `.appx` já leva os ícones gerados de
  `desktop/icon.png`. Para a página da loja, use os artes do canvas de logos
  (ícone quadrado 300×300 e imagem de destaque 1920×1080).

## 5. Atualizações

A cada versão: suba a versão no `package.json`, rode `npm run package:windows`
com as mesmas variáveis e crie uma nova *submission* com o `.appx` novo. A loja
atualiza os usuários sozinha.
