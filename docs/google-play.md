# Publicar o GarraTV no Google Play (celular, tablet e Android TV)

Um único pacote serve para **todo Android 5.0 ou mais novo** — celulares, tablets,
TV boxes, Android TV e Google TV (TCL, Sony, Philips, Xiaomi, Chromecast…) — e
para **todas as arquiteturas** (arm64, armv7, x86 e x86_64).

`npm run package:android` gera:

- `dist/android/GarraTV-<versão>.aab` → **é este que vai para o Play**
- `dist/android/GarraTV-<versão>.apk` → para instalar direto (pendrive, adb)

## O que o pacote já cumpre

| Exigência do Play | Situação |
|---|---|
| Formato App Bundle (.aab) | ✔ |
| Target API 36 (Android 16) — obrigatório desde 31/08/2026 | ✔ `targetSdk = 36` |
| Páginas de memória de 16 KB (Android 15+) | ✔ bibliotecas nativas alinhadas |
| Voltar preditivo do Android 16 | ✔ `OnBackInvokedCallback` |
| Android TV: launcher Leanback, banner, sem touchscreen obrigatório | ✔ |
| Política de privacidade pública | ✔ https://github.com/megagarra/GarraTV/blob/main/docs/privacy-policy.md |

## 1. Conta de desenvolvedor (só você pode fazer)

1. Acesse **play.google.com/console/signup**, escolha conta **pessoal**, pague a
   taxa única (US$ 25) e faça a verificação de identidade.
2. **Atenção — contas pessoais novas:** antes de publicar em produção, o Google
   exige um **teste fechado com pelo menos 12 testadores** ativos por **14 dias
   seguidos**. Junte 12 e-mails de pessoas com Android (amigos, família) — eles
   entram pelo link de teste e mantêm o app instalado nesses 14 dias.

## 2. Criar o app

*Criar app* → nome **GarraTV** · idioma padrão **Português (Brasil)** · **App** ·
**Gratuito** → aceite as declarações.

## 3. Conteúdo do app (Política)

| Formulário | Resposta |
|---|---|
| Política de privacidade | https://github.com/megagarra/GarraTV/blob/main/docs/privacy-policy.md |
| Acesso ao app | "Todas ou algumas funcionalidades são restritas" → instrução: *Sem login, toque em "Assistir canais grátis" na primeira tela para testar a reprodução de canais públicos. O login exige uma conta Xtream Codes do próprio usuário (o app não vende nem fornece contas).* |
| Anúncios | Não, o app não contém anúncios |
| Classificação de conteúdo (IARC) | Categoria "Todos os outros tipos de app"; responder **Não** a violência, sexo, linguagem, drogas, apostas, interação entre usuários e compras |
| Público-alvo | **18 anos ou mais** (evita as regras de apps para crianças) |
| Apps de notícias | Não |
| Segurança dos dados | ver tabela abaixo |
| Apps governamentais / financeiros / saúde | Não |

### Segurança dos dados

- O app **coleta ou compartilha** dados? **Não** — nada sai do aparelho para o
  desenvolvedor. Os dados de login do provedor ficam **só no aparelho** e só
  são enviados ao servidor que o próprio usuário digitou.
- Os dados são criptografados em trânsito? Depende do provedor do usuário
  (muitos usam HTTP) → responda **Não** para não declarar o que não garantimos.
- O usuário pode pedir exclusão? **Sim** — sair da conta ou desinstalar apaga tudo.

## 4. Ficha da loja (pt-BR)

**Nome:** GarraTV

**Descrição curta (até 80):**
Reprodutor de IPTV para sua conta Xtream Codes e canais abertos grátis.

**Descrição completa:**
GarraTV é um reprodutor de IPTV rápido e simples, feito para celular, tablet e
Android TV. Entre com os dados da sua conta Xtream Codes, fornecidos pelo seu
provedor, e assista TV ao vivo com guia de programação, filmes e séries, com
favoritos e "continuar assistindo".

Sem conta? Assista a canais públicos e abertos de vários países, organizados
por categoria.

• TV ao vivo com guia de programação
• Filmes e séries com "continuar assistindo"
• Favoritos com um toque — na TV, segure OK no controle
• Feito para controle remoto, toque e teclado
• Seus dados ficam somente no seu aparelho

O GarraTV não fornece nenhum conteúdo: é preciso ter uma assinatura de um
provedor. Código-fonte (AGPL-3.0): https://github.com/megagarra/GarraTV

**Categoria:** Vídeo e editores de vídeo (Video Players & Editors) · **E-mail:** thegarra@gmail.com

### Imagens (prontas em `docs/play/`)

| Campo | Arquivo |
|---|---|
| Ícone 512×512 | `icon-512.png` |
| Gráfico de recursos 1024×500 | `feature-1024x500.png` |
| Capturas de celular (2:1) | `phone-1-canais-gratis.png`, `phone-2-login.png` |
| Capturas de tablet (7"/10") | as mesmas da TV (16:9) |
| Banner do Android TV 1280×720 | `tv-banner-1280x720.png` |
| Capturas do Android TV (1920×1080) | `tv-1-canais-gratis.png`, `tv-2-login.png`, `tv-3-escolher-pais.png` |

## 5. Android TV

Em *Configuração → Configurações avançadas → Formatos* adicione **Android TV**.
O Google revisa à parte a qualidade para TV (navegação por controle, banner,
sem exigir toque) — o GarraTV já foi feito para isso.

## 6. Envio

1. **Teste fechado** (obrigatório para conta pessoal nova): crie a faixa, envie o
   `.aab`, adicione a lista com os 12 testadores e mande o link para eles.
2. Depois dos 14 dias, *Painel → Solicitar acesso à produção*, responda o
   questionário e publique a mesma versão em **Produção**.
3. Em **Integridade do app**, deixe o Google gerenciar a chave de assinatura
   (**Assinatura de apps do Google Play**); a chave em `android/keystore/` vira a
   chave de upload. **Guarde o `android/keystore/` com backup** — sem ela não há
   como enviar atualizações.

## Atualizações

Suba a versão no `package.json` (o `versionCode` sai dela), rode
`npm run package:android` e envie o novo `.aab`.

**Atenção à política de conteúdo:** apps de IPTV são removidos quando a ficha,
as imagens ou o próprio app sugerem acesso a canais pagos. Use sempre só os
canais grátis nas capturas e nunca cite canais, filmes ou marcas na ficha.
