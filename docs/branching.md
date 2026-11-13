# Fluxo de branches

O repositório tem **só duas branches**:

| Branch | Para quê |
|---|---|
| `main` | Versão estável e publicada (TVs, Windows, lojas). Cada lançamento vira uma tag `vX.Y.Z`. |
| `dev` | O dia a dia. Todo trabalho é commitado direto aqui e precisa estar sempre compilando. |

Não criamos branches de trabalho (`feature/*`, `fix/*`, `release/*`, `hotfix/*`).

```
main   ●──────────────●──────────────●────   (lançamentos, com tag)
        \            /              /
dev      ●──●──●──●─●──●──●──●──●──●──●────   (commits do dia a dia)
```

## No dia a dia

```bash
git switch dev && git pull
# ...trabalhe, teste
git commit -m "feat: ..."      # um commit por assunto, em inglês, no imperativo
git push origin dev
```

## Lançando uma versão

```bash
git switch dev && git pull
npm version 1.22.0 --no-git-tag-version   # package.json e lock
# atualize também desktop/package.json
# gere e teste: npm run package:android, npm run package:windows, TV real
git commit -am "chore: release v1.22.0"
git push origin dev
git switch main && git pull
git merge --no-ff dev -m "Release v1.22.0"
git tag v1.22.0
git push origin main --tags
git switch dev
```

## Correção urgente

Para corrigir o que já está publicado, quando a `dev` tem coisas que ainda não podem sair:

```bash
git switch main && git pull
# corrige, testa, faz bump de patch (1.22.1)
git commit -am "fix: ..."
git tag v1.22.1
git push origin main --tags
git switch dev && git merge --no-ff main && git push origin dev
```

## Antes de enviar

- `npm run build` passa. O CI roda o mesmo build a cada push na `dev` e na `main`.
- Mudou algo de tela? Teste com controle remoto (foco, OK, Voltar).
- Mudou o app Android? Rode `npm run package:android` e teste nos emuladores.
- Nada de credenciais, `data/` ou `android/keystore/` no commit.

## Proteção no GitHub (recomendado)

Em **Settings → Branches**, crie regras para `main` e `dev`: bloquear force push e exigir o check **CI / build** verde.
