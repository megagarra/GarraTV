---
name: versionar
description: Versiona no git todo trabalho concluído no GarraTV — commits por assunto direto na dev e push. Use ao terminar qualquer mudança no código (sem esperar o usuário pedir), ou quando ele pedir para commitar, salvar no git, enviar, subir ou "deixar o git correto".
---

Nenhuma mudança termina só na pasta local: ao concluir uma tarefa que alterou arquivos, ela fica versionada e no GitHub. O repositório tem **só duas branches**: `dev` (dia a dia) e `main` (lançamentos). Não crie outras branches. Fluxo completo em `docs/branching.md`.

## 1. Branch

- Trabalhe direto na `dev`. Comece com `git switch dev && git pull`.
- Nunca commite na `main` no dia a dia: ela só anda em lançamentos e correções urgentes (passo 5).
- Não crie `feature/*`, `fix/*`, `release/*` nem `hotfix/*`.

## 2. Validar

- Rode `/build-check`. Erros de lint em arquivos que você **não** mexeu são antigos: cite-os, mas eles não bloqueiam. Erros nos seus arquivos bloqueiam.
- Mudou o app Android? `npm run package:android` precisa passar. Teste nos emuladores; **instale na TV real só quando o usuário pedir**.

## 3. Commits

- Um commit por assunto. Se a sessão fez coisas diferentes (ex.: desempenho e uma tela nova), separe em commits distintos, mesmo quando dividem arquivos. Confira que cada commit compila sozinho.
- Mensagem em **inglês**, no imperativo, com prefixo: `feat:`, `fix:`, `perf:`, `chore:`, `docs:` ou `refactor:`. No corpo, explique o porquê.
- Termine a mensagem com as linhas de atribuição que o ambiente indicar.
- Nunca inclua `data/`, `android/keystore/`, `dist/`, credenciais ou arquivos temporários de teste. Revise o `git status` antes de cada commit.

## 4. Enviar

```bash
git pull --rebase origin dev   # só se o remoto andou
git push origin dev
```

- Confirme que `dev` e `origin/dev` estão no mesmo commit e que o `git status` está limpo.
- Se o usuário disser para **não** enviar ainda, faça os commits e avise que o push ficou pendente.
- Nunca use force push.

## 5. Lançamento e correção urgente (só quando o usuário pedir)

**Lançamento:**

```bash
git switch dev && git pull
npm version X.Y.Z --no-git-tag-version     # package.json e lock
# também em desktop/package.json; depois gere e teste os pacotes
git commit -am "chore: release vX.Y.Z"
git push origin dev
git switch main && git pull && git merge --no-ff dev -m "Release vX.Y.Z"
git tag vX.Y.Z && git push origin main --tags
git switch dev
```

**Correção urgente** do que já está publicado:
1. Commite direto na `main`, com versão de patch.
2. Crie a tag e envie.
3. Depois rode `git switch dev && git merge --no-ff main` e envie a `dev`.

## 6. Relatar

Diga em pt-BR quais commits foram feitos (hash e título) e se o push foi feito. Diga também o que ficou de fora (ex.: "não instalei na TV", "lint antigo com X erros").
