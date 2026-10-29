# Fluxo de branches

Regra de ouro: **a `main` só recebe código já testado.** Todo trabalho novo nasce
da `dev` e volta para ela por PR; a `main` anda só em lançamentos e correções
urgentes.

```
main      ●───────────────●────────────●──────────   (estável: o que está nas TVs e no .exe)
           \             / \          /
release     \     release/1.22.0     /
             \         /     \      /
dev           ●──●──●─●───────●────●──●───────────   (integração: próxima versão)
                \  /    \    /         \
feature/…        ●●      ●──●           hotfix/… (sai da main, volta para main e dev)
```

## As branches

| Branch | Para quê | Sai de | Volta para |
|---|---|---|---|
| `main` | Versão estável, publicada. Cada lançamento vira uma tag `vX.Y.Z`. | — | — |
| `dev` | Integração do que vai na próxima versão. Sempre compilando. | `main` | — |
| `feature/<nome>` | Funcionalidade nova (`feature/epg-grade`). | `dev` | `dev` (PR) |
| `fix/<nome>` | Correção que pode esperar o próximo lançamento. | `dev` | `dev` (PR) |
| `release/<versão>` | Congela a próxima versão para testar na TV, Windows e celular. Só correções entram. | `dev` | `main` + tag, depois `dev` |
| `hotfix/<nome>` | Correção urgente do que já está publicado. | `main` | `main` + tag, depois `dev` |

## No dia a dia

```bash
git switch dev && git pull
git switch -c feature/minha-mudanca
# ...commits pequenos, mensagem em inglês no imperativo (feat:, fix:, chore:...)
git push -u origin feature/minha-mudanca
# abra o PR para a dev (descrição em pt-BR)
```

## Lançando uma versão

```bash
git switch dev && git pull
git switch -c release/1.22.0
npm version 1.22.0 --no-git-tag-version   # package.json/lock
# gere e teste: npm run package:android, npm run package:windows, TV real
git commit -am "chore: release v1.22.0"
git switch main && git merge --no-ff release/1.22.0
git tag v1.22.0
git switch dev && git merge --no-ff release/1.22.0
git push origin main dev --tags
git branch -d release/1.22.0
```

## Correção urgente

```bash
git switch main && git pull
git switch -c hotfix/descricao
# corrige, testa, bump de patch (1.22.1)
git switch main && git merge --no-ff hotfix/descricao && git tag v1.22.1
git switch dev && git merge --no-ff hotfix/descricao
git push origin main dev --tags
```

## Antes de qualquer PR

- `npm run build` passa (o CI roda o mesmo em todo PR para `dev` e `main`).
- Mudou algo de tela? Teste com controle remoto numa TV real (foco, OK, Voltar).
- Mudou o app Android? `npm run package:android` e instale na TV/celular.
- Nada de credenciais, `data/` ou `android/keystore/` no commit.

## Proteção no GitHub (recomendado)

Em **Settings → Branches**, crie regras para `main` e `dev`:
exigir PR antes do merge, exigir o check **CI / build** verde e bloquear force push.
