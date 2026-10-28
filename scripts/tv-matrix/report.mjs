#!/usr/bin/env node
/**
 * Builds test-results/tv/report.md from every results-*.json written by run.mjs
 * (Chromium engines) and simulators.mjs (official TV simulators/emulators).
 *
 *   node scripts/tv-matrix/report.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ENGINES } from './engines.mjs';

export const OUT = path.join(process.cwd(), 'test-results', 'tv');
const ICON = { pass: 'PASS', fail: 'FAIL', warn: 'WARN' };

export function loadResults(file) {
    try {
        return JSON.parse(fs.readFileSync(path.join(OUT, file), 'utf-8'));
    } catch {
        return { engines: {} };
    }
}

export function saveResults(file, all) {
    fs.mkdirSync(OUT, { recursive: true });
    fs.writeFileSync(path.join(OUT, file), JSON.stringify(all, null, 2));
}

function collect() {
    const runs = [];
    const files = fs.existsSync(OUT) ? fs.readdirSync(OUT).filter((f) => /^results.*\.json$/.test(f)) : [];
    for (const file of files) {
        for (const [id, run] of Object.entries(loadResults(file).engines)) {
            const engine = ENGINES.find((e) => e.id === id);
            runs.push({ id, tvs: run.tvs || engine?.tvs || id, kind: run.kind || 'engine', ...run });
        }
    }
    const order = (run) => {
        const index = ENGINES.findIndex((e) => e.id === run.id);
        return run.kind === 'engine' ? index : 100 + runs.indexOf(run);
    };
    return runs.sort((a, b) => order(a) - order(b));
}

export function writeReport() {
    const runs = collect();
    const rows = new Map();
    for (const run of runs) {
        for (const result of run.results) {
            const key = `${result.flow}|${result.check}`;
            if (!rows.has(key)) rows.set(key, { flow: result.flow, check: result.check, cells: {} });
            rows.get(key).cells[run.id] = result;
        }
    }

    const lines = ['# TV compatibility matrix', ''];
    lines.push(`Generated ${new Date().toISOString()} by \`scripts/tv-matrix\`.`, '');
    lines.push('| Target | Stands in for | Browser build | Pass | Warn | Fail |', '|---|---|---|---|---|---|');
    for (const run of runs) {
        const count = (status) => run.results.filter((r) => r.status === status).length;
        lines.push(`| ${run.id} | ${run.tvs} | ${run.version} | ${count('pass')} | ${count('warn')} | ${count('fail')} |`);
    }
    lines.push('', '## Results by check', '', 'Each cell links to the screenshot taken at that check, when there is one.', '');
    lines.push(`| Flow | Check | ${runs.map((r) => r.id).join(' | ')} |`);
    lines.push(`|---|---|${runs.map(() => '---').join('|')}|`);
    for (const row of rows.values()) {
        const cells = runs.map((run) => {
            const cell = row.cells[run.id];
            if (!cell) return '-';
            return cell.shot && !cell.shot.startsWith('screenshot failed') ? `[${ICON[cell.status]}](${run.id}/${cell.shot})` : ICON[cell.status];
        });
        lines.push(`| ${row.flow} | ${row.check} | ${cells.join(' | ')} |`);
    }
    lines.push('', '## Failures and warnings', '');
    let any = false;
    for (const run of runs) {
        for (const result of run.results) {
            if (result.status === 'pass') continue;
            any = true;
            lines.push(`- **${run.id}** ${ICON[result.status]} - ${result.flow} / ${result.check}: ${result.note}`);
        }
    }
    if (!any) lines.push('None.');
    if (fs.existsSync(path.join(OUT, 'notes.md'))) lines.push('', fs.readFileSync(path.join(OUT, 'notes.md'), 'utf-8'));
    fs.writeFileSync(path.join(OUT, 'report.md'), lines.join('\n') + '\n');
    return path.join(OUT, 'report.md');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    console.log(`[report] ${path.relative(process.cwd(), writeReport())}`);
}
