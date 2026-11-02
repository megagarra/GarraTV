---
name: versionar
description: Versiona no git todo trabalho concluído no GarraTV — branch a partir da dev, commits por assunto, merge na dev e push. Use ao terminar qualquer mudança no código (sem esperar o usuário pedir), ou quando ele pedir para commitar, salvar no git, enviar, subir ou "deixar o git correto".
---

Nenhuma mudança termina só na pasta local: ao concluir uma tarefa que alterou arquivos, ela fica versionada e no GitHub. Fluxo completo em `docs/branching.md`.

## 1. Branch

- Nunca trabalhe nem commite direto na `main` ou na `dev`.
- Atualize a `dev` (`git switch dev && git pull`) e crie a branch dela **antes de editar**: `feature/<nome>` para algo novo, `fix/<nome>` para correção. Nome curto, em inglês, com hífens.
- Se já estiver numa branch de trabalho do mesmo assunto, continue nela.
- `hotfix/*` (sai da `main`) e `release/*` só quando o usuário pedir um lançamento ou correção urgente do que já está publicado.

## 2. Validar

- Rode `/build-check`. Erros de lint em arquivos que você **não** mexeu são antigos: cite-os, não bloqueiam. Erros nos seus arquivos bloqueiam.
- Mudou o app Android? `npm run package:android` precisa passar. Teste nos emuladores; **instalar na TV real só quando o usuário pedir**.

## 3. Commits

- Um commit por assunto. Se a mesma sessão fez coisas diferentes (ex.: desempenho e uma tela nova), separe em commits distintos, mesmo quando dividem arquivos. Confira que cada commit compila sozinho.
- Mensagem em **inglês**, imperativo, com prefixo: `feat:`, `fix:`, `perf:`, `chore:`, `docs:`, `refactor:`. Corpo explicando o porquê.
- Termine a mensagem com as linhas de atribuição que o ambiente indicar.
- Nunca inclua `data/`, `android/keystore/`, `dist/`, credenciais ou arquivos de teste temporários. Revise `git status` antes de cada commit.

## 4. Integrar e enviar

```bash
git switch dev && git pull
git merge --no-ff <branch> -m "Merge branch '<branch>' into dev"
git push origin dev <branch>
```

- Confirme que `dev` e `origin/dev` apontam para o mesmo commit e que `git status` está limpo.
- Se o usuário pedir PR em vez de merge direto, use `/open-pr` (PR para a `dev`, descrição em pt-BR).
- Se o usuário disser para **não** enviar ainda, faça os commits e o merge local e avise que o push está pendente.

## 5. Relatar

Diga em pt-BR: a branch, os commits (hash e título), o merge na `dev` e o push. Diga também o que ficou de fora, por exemplo "não instalei na TV" ou "lint antigo com X erros".
