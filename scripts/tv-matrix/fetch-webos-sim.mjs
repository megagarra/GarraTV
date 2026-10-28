#!/usr/bin/env node
/**
 * Downloads LG's webOS TV Simulators (Windows) into .tv-browsers/webos-sim, the same way
 * the download page does (its "agree and download" dialog asks LG's API for a signed link).
 * Running this accepts LG's webOS TV SDK terms, as the page's dialog would.
 *
 *   node scripts/tv-matrix/fetch-webos-sim.mjs            # 6.0, 22 and 26
 *   node scripts/tv-matrix/fetch-webos-sim.mjs 6.0 24     # specific releases
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const PAGE = 'https://webostv.developer.lge.com/develop/tools/simulator-installation';
const DIR = path.join(process.cwd(), '.tv-browsers', 'webos-sim');
const wanted = process.argv.slice(2).length ? process.argv.slice(2) : ['6.0', '22', '26'];

fs.mkdirSync(DIR, { recursive: true });
const page = await (await fetch(PAGE)).text();

for (const version of wanted) {
    const match = new RegExp(`"fileName":"(webOS_TV_${version.replace('.', '\\.')}_Simulator_[\\d.]+_win\\.zip)","fileId":"(RF\\d+)"`).exec(page);
    if (!match) {
        console.error(`[webos-sim] ${version}: not on the download page`);
        process.exitCode = 1;
        continue;
    }
    const [, fileName, fileId] = match;
    const target = path.join(DIR, fileName.replace(/\.zip$/, ''));
    if (fs.existsSync(target)) {
        console.log(`[webos-sim] ${version}: already present`);
        continue;
    }
    const { fileIdEnc } = await (await fetch('https://webostv.developer.lge.com/api/downloadSDK', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fileId }),
    })).json();
    const xml = await (await fetch(`https://developer.lge.com/common/file/DownloadFilePath.ajax?${new URLSearchParams({ fileId: fileIdEnc })}`, {
        method: 'POST', headers: { Origin: 'https://webostv.developer.lge.com', Referer: 'https://webostv.developer.lge.com/' },
    })).text();
    const url = /gftsUrl="([^"]+)"/.exec(xml)?.[1]?.replace(/&amp;/g, '&');
    if (!url) throw new Error(`${version}: LG returned no download link`);

    const zip = path.join(DIR, fileName);
    console.log(`[webos-sim] ${version}: downloading ${fileName}`);
    const response = await fetch(url);
    await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(zip));
    fs.mkdirSync(target, { recursive: true });
    const unzip = spawnSync('tar', ['-xf', zip, '-C', target], { stdio: 'inherit' });
    if (unzip.status !== 0) throw new Error(`tar failed for ${zip}`);
    fs.rmSync(zip);
}
