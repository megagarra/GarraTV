#!/usr/bin/env node
/**
 * Minimal Xtream Codes provider for the TV matrix: a small, deterministic catalog,
 * a live HLS channel and VOD files with Range support, so the signed-in flows can
 * run on every engine without a real account.
 *
 *   node scripts/tv-matrix/mock-provider.mjs            # http://127.0.0.1:3200
 *
 * Account: tvtest / mock-pass-123. Test media is generated once with the ffmpeg
 * that fetch-browsers.mjs downloads. VOD comes in two flavours: WebM (VP9/Opus),
 * which the open-source Chromium snapshots can decode, and MP4 (H.264/AAC), which
 * only stable Chrome and real TVs decode.
 */

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

export const MOCK_PORT = Number(process.env.MOCK_PORT || 3200);
export const MOCK_USER = 'tvtest';
export const MOCK_PASS = 'mock-pass-123';

const ROOT = process.cwd();
const MEDIA = path.join(ROOT, '.tv-browsers', 'media');

function findFfmpeg() {
    const dir = path.join(ROOT, '.tv-browsers', 'ffmpeg');
    const walk = (d) => {
        for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
            const full = path.join(d, entry.name);
            if (entry.isFile() && entry.name.toLowerCase() === 'ffmpeg.exe') return full;
            if (entry.isDirectory()) {
                const found = walk(full);
                if (found) return found;
            }
        }
        return null;
    };
    return fs.existsSync(dir) ? walk(dir) : null;
}

function ffmpeg(args) {
    const exe = findFfmpeg();
    if (!exe) throw new Error('ffmpeg missing: run fetch-browsers.mjs first');
    const result = spawnSync(exe, ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: 'inherit' });
    if (result.status !== 0) throw new Error(`ffmpeg failed: ${args.join(' ')}`);
}

const COLORS = ['0xE50914', '0x1F6FEB', '0x2DA44E', '0xBF8700', '0x8250DF', '0xCF222E', '0x0969DA', '0x1A7F37', '0x9A6700', '0x6639BA', '0xBC4C00', '0x57606A'];

function ensureMedia() {
    fs.mkdirSync(MEDIA, { recursive: true });
    const live = path.join(MEDIA, 'live');
    if (!fs.existsSync(path.join(live, 'index.m3u8'))) {
        fs.mkdirSync(live, { recursive: true });
        console.log('[mock] generating live HLS');
        ffmpeg([
            '-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=25', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000',
            '-t', '120', '-c:v', 'libx264', '-profile:v', 'main', '-pix_fmt', 'yuv420p', '-g', '50', '-c:a', 'aac',
            '-f', 'hls', '-hls_time', '4', '-hls_list_size', '0', '-hls_segment_filename', path.join(live, 'seg%03d.ts'),
            path.join(live, 'index.m3u8'),
        ]);
    }
    if (!fs.existsSync(path.join(MEDIA, 'movie.mp4'))) {
        console.log('[mock] generating MP4');
        ffmpeg([
            '-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=25', '-f', 'lavfi', '-i', 'sine=frequency=330:sample_rate=48000',
            '-t', '60', '-c:v', 'libx264', '-profile:v', 'main', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-movflags', '+faststart',
            path.join(MEDIA, 'movie.mp4'),
        ]);
    }
    if (!fs.existsSync(path.join(MEDIA, 'movie.webm'))) {
        console.log('[mock] generating WebM');
        ffmpeg([
            '-f', 'lavfi', '-i', 'testsrc2=size=854x480:rate=25', '-f', 'lavfi', '-i', 'sine=frequency=550:sample_rate=48000',
            '-t', '60', '-c:v', 'libvpx-vp9', '-deadline', 'realtime', '-cpu-used', '8', '-b:v', '800k', '-c:a', 'libopus',
            path.join(MEDIA, 'movie.webm'),
        ]);
    }
    for (let i = 0; i < COLORS.length; i++) {
        const poster = path.join(MEDIA, `poster${i}.png`);
        if (!fs.existsSync(poster)) {
            ffmpeg(['-f', 'lavfi', '-i', `color=c=${COLORS[i]}:s=300x450`, '-frames:v', '1', poster]);
        }
        const wide = path.join(MEDIA, `wide${i}.png`);
        if (!fs.existsSync(wide)) {
            ffmpeg(['-f', 'lavfi', '-i', `color=c=${COLORS[i]}:s=1280x720`, '-frames:v', '1', wide]);
        }
    }
}

const now = () => Math.floor(Date.now() / 1000);

function catalog(base) {
    const img = (i, kind = 'poster') => `${base}/img/${kind}${i % COLORS.length}.png`;
    const liveCategories = [
        { category_id: '10', category_name: 'Notícias', parent_id: 0 },
        { category_id: '11', category_name: 'Esportes', parent_id: 0 },
    ];
    const live = Array.from({ length: 12 }, (_, i) => ({
        num: i + 1, name: `Canal Teste ${i + 1}`, stream_type: 'live', stream_id: 100 + i,
        stream_icon: img(i), epg_channel_id: `ch${i}`, added: String(now() - i * 3600), category_id: i < 6 ? '10' : '11',
    }));
    const vodCategories = [
        { category_id: '20', category_name: 'Ação', parent_id: 0 },
        { category_id: '21', category_name: 'Comédia', parent_id: 0 },
    ];
    const vod = Array.from({ length: 10 }, (_, i) => ({
        num: i + 1, name: `Filme Teste ${i + 1} (${2016 + i})`, stream_type: 'movie', stream_id: 200 + i,
        stream_icon: img(i), rating: String(5 + (i % 5)), rating_5based: (2.5 + (i % 5) / 2).toFixed(1),
        added: String(now() - i * 86400), category_id: i < 5 ? '20' : '21',
        container_extension: i % 2 === 0 ? 'webm' : 'mp4',
    }));
    const seriesCategories = [{ category_id: '30', category_name: 'Drama', parent_id: 0 }];
    const series = Array.from({ length: 4 }, (_, i) => ({
        num: i + 1, name: `Série Teste ${i + 1}`, series_id: 300 + i, cover: img(i + 3), plot: 'Série de teste do mock.',
        cast: 'Elenco', director: 'Direção', genre: 'Drama', releaseDate: `${2019 + i}-01-01`, rating: '7',
        rating_5based: '3.5', backdrop_path: [img(i + 3, 'wide')], last_modified: String(now() - i * 86400), category_id: '30',
    }));
    return { liveCategories, live, vodCategories, vod, seriesCategories, series, img };
}

function json(res, status, body) {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
}

function playerApi(url, res, base) {
    const params = url.searchParams;
    if (params.get('username') !== MOCK_USER || params.get('password') !== MOCK_PASS) {
        return json(res, 200, { user_info: { auth: 0 } });
    }
    const data = catalog(base);
    const action = params.get('action') || '';
    const b64 = (text) => Buffer.from(text, 'utf-8').toString('base64');
    switch (action) {
        case '':
            return json(res, 200, {
                user_info: {
                    username: MOCK_USER, password: MOCK_PASS, auth: 1, status: 'Active', exp_date: String(now() + 365 * 86400),
                    is_trial: '0', active_cons: '0', created_at: String(now() - 86400), max_connections: '2', allowed_output_formats: ['m3u8', 'ts'],
                },
                server_info: {
                    url: '127.0.0.1', port: String(MOCK_PORT), https_port: '', server_protocol: 'http', rtmp_port: '',
                    timezone: 'America/Sao_Paulo', timestamp_now: now(), time_now: new Date().toISOString(),
                },
            });
        case 'get_live_categories': return json(res, 200, data.liveCategories);
        case 'get_live_streams': return json(res, 200, data.live);
        case 'get_vod_categories': return json(res, 200, data.vodCategories);
        case 'get_vod_streams': return json(res, 200, data.vod);
        case 'get_series_categories': return json(res, 200, data.seriesCategories);
        case 'get_series': return json(res, 200, data.series);
        case 'get_vod_info': {
            const movie = data.vod.find((item) => String(item.stream_id) === params.get('vod_id'));
            if (!movie) return json(res, 200, []);
            const index = movie.stream_id - 200;
            return json(res, 200, {
                info: {
                    name: movie.name, movie_image: data.img(index), cover_big: data.img(index), backdrop_path: [data.img(index, 'wide')],
                    plot: 'Filme de teste gerado pelo mock do provedor.', cast: 'Elenco', director: 'Direção', genre: 'Ação',
                    releasedate: `${2016 + index}-01-01`, duration_secs: 60, duration: '00:01:00', rating: movie.rating,
                },
                movie_data: { stream_id: movie.stream_id, name: movie.name, added: movie.added, category_id: movie.category_id, container_extension: movie.container_extension },
            });
        }
        case 'get_series_info': {
            const show = data.series.find((item) => String(item.series_id) === params.get('series_id'));
            if (!show) return json(res, 200, []);
            const episodes = (season) => Array.from({ length: 3 }, (_, i) => ({
                id: String(show.series_id * 100 + season * 10 + i), episode_num: i + 1, title: `Episódio ${i + 1}`,
                container_extension: i % 2 === 0 ? 'webm' : 'mp4', season,
                info: { duration_secs: 60, duration: '00:01:00', plot: 'Episódio de teste.', movie_image: data.img(i) },
            }));
            return json(res, 200, {
                seasons: [{ season_number: 1, name: 'Temporada 1' }, { season_number: 2, name: 'Temporada 2' }],
                info: { name: show.name, cover: show.cover, plot: show.plot, cast: show.cast, director: show.director, genre: show.genre, releaseDate: show.releaseDate, rating: show.rating, backdrop_path: show.backdrop_path },
                episodes: { 1: episodes(1), 2: episodes(2) },
            });
        }
        case 'get_short_epg': {
            const start = now() - 1200;
            const limit = Number(params.get('limit') || 4);
            return json(res, 200, {
                epg_listings: Array.from({ length: limit }, (_, i) => ({
                    id: String(i), title: b64(`Programa ${i + 1}`), description: b64('Descrição de teste do programa.'),
                    start_timestamp: String(start + i * 3600), stop_timestamp: String(start + (i + 1) * 3600),
                })),
            });
        }
        default:
            return json(res, 200, []);
    }
}

function sendFile(req, res, file, contentType) {
    if (!fs.existsSync(file)) {
        res.writeHead(404);
        return res.end();
    }
    const size = fs.statSync(file).size;
    const range = req.headers.range && /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
    if (range) {
        const start = range[1] ? Number(range[1]) : size - Number(range[2]);
        const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
        if (start >= size || start > end) {
            res.writeHead(416, { 'content-range': `bytes */${size}` });
            return res.end();
        }
        res.writeHead(206, {
            'content-type': contentType, 'content-length': end - start + 1,
            'content-range': `bytes ${start}-${end}/${size}`, 'accept-ranges': 'bytes',
        });
        if (req.method === 'HEAD') return res.end();
        return fs.createReadStream(file, { start, end }).pipe(res);
    }
    res.writeHead(200, { 'content-type': contentType, 'content-length': size, 'accept-ranges': 'bytes' });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
}

export function startMockProvider(port = MOCK_PORT) {
    ensureMedia();
    const base = `http://127.0.0.1:${port}`;
    const server = http.createServer((req, res) => {
        const url = new URL(req.url, base);
        const parts = url.pathname.split('/').filter(Boolean);

        if (url.pathname === '/player_api.php') return playerApi(url, res, base);
        if (parts[0] === 'img' && parts.length === 2) return sendFile(req, res, path.join(MEDIA, path.basename(parts[1])), 'image/png');

        // /live/<user>/<pass>/<id>.m3u8 -> playlist of the shared test channel
        if (parts[0] === 'live' && parts.length === 4) {
            if (parts[1] !== MOCK_USER || parts[2] !== MOCK_PASS) {
                res.writeHead(403);
                return res.end();
            }
            if (parts[3].endsWith('.m3u8')) {
                const text = fs.readFileSync(path.join(MEDIA, 'live', 'index.m3u8'), 'utf-8')
                    .replace(/^(seg\d+\.ts)$/gm, `${base}/hls/$1`);
                res.writeHead(200, { 'content-type': 'application/vnd.apple.mpegurl' });
                return res.end(text);
            }
        }
        if (parts[0] === 'hls' && parts.length === 2) return sendFile(req, res, path.join(MEDIA, 'live', path.basename(parts[1])), 'video/mp2t');

        // /movie|series/<user>/<pass>/<id>.<ext>
        if ((parts[0] === 'movie' || parts[0] === 'series') && parts.length === 4) {
            if (parts[1] !== MOCK_USER || parts[2] !== MOCK_PASS) {
                res.writeHead(403);
                return res.end();
            }
            const webm = parts[3].endsWith('.webm');
            return sendFile(req, res, path.join(MEDIA, webm ? 'movie.webm' : 'movie.mp4'), webm ? 'video/webm' : 'video/mp4');
        }

        res.writeHead(404);
        res.end();
    });
    return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)));
}

if (import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}` || process.argv[1]?.endsWith('mock-provider.mjs')) {
    startMockProvider().then(() => console.log(`[mock] Xtream mock on http://127.0.0.1:${MOCK_PORT} (${MOCK_USER} / ${MOCK_PASS})`));
}
