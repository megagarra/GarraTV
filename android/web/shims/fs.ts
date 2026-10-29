/**
 * `fs` / `fs/promises` over the Android file bridge. Paths are virtual: the shell
 * roots them in the app's private storage, so `data/config.json` and the subtitle
 * cache land where the server code expects them, just inside the APK sandbox.
 * Text only — nothing in the server code reads or writes binary files.
 */
import { fsBridge, unwrap } from './native';

type PathLike = string;

interface MkdirOptions {
    recursive?: boolean;
}

interface ReaddirOptions {
    withFileTypes?: boolean;
}

interface NativeEntry {
    name: string;
    directory: boolean;
}

export class Dirent {
    constructor(readonly name: string, private readonly directory: boolean) {}

    isDirectory(): boolean {
        return this.directory;
    }

    isFile(): boolean {
        return !this.directory;
    }
}

// Callers always ask for utf-8; without an encoding Node would return a Buffer,
// whose toString() is this same text, so the encoding is accepted and ignored.
export function readFileSync(path: PathLike, _options?: unknown): string {
    void _options;
    return unwrap<string>(fsBridge().readFile(String(path)));
}

export function writeFileSync(path: PathLike, data: unknown): void {
    unwrap<null>(fsBridge().writeFile(String(path), typeof data === 'string' ? data : String(data)));
}

export function mkdirSync(path: PathLike, _options?: MkdirOptions): void {
    void _options;
    unwrap<null>(fsBridge().mkdir(String(path)));
}

export function readdirSync(path: PathLike, options?: ReaddirOptions): string[] | Dirent[] {
    const entries = unwrap<NativeEntry[]>(fsBridge().readdir(String(path)));
    if (options?.withFileTypes) return entries.map(entry => new Dirent(entry.name, entry.directory));
    return entries.map(entry => entry.name);
}

export function unlinkSync(path: PathLike): void {
    unwrap<null>(fsBridge().unlink(String(path)));
}

export function existsSync(path: PathLike): boolean {
    try {
        unwrap<unknown>(fsBridge().stat(String(path)));
        return true;
    } catch {
        return false;
    }
}

function accessSync(path: PathLike): void {
    unwrap<unknown>(fsBridge().stat(String(path)));
}

function later<T>(work: () => T): Promise<T> {
    try {
        return Promise.resolve(work());
    } catch (error) {
        return Promise.reject(error);
    }
}

export const promises = {
    readFile: (path: PathLike, options?: unknown) => later(() => readFileSync(path, options)),
    writeFile: (path: PathLike, data: unknown) => later(() => writeFileSync(path, data)),
    mkdir: (path: PathLike, options?: MkdirOptions) => later(() => mkdirSync(path, options)),
    readdir: (path: PathLike, options?: ReaddirOptions) => later(() => readdirSync(path, options)),
    unlink: (path: PathLike) => later(() => unlinkSync(path)),
    access: (path: PathLike) => later(() => accessSync(path)),
    rm: (path: PathLike) => later(() => {
        try {
            unlinkSync(path);
        } catch {
            /* rm({ force }) semantics: a missing file is fine */
        }
    }),
};

const fs = {
    readFileSync,
    writeFileSync,
    mkdirSync,
    readdirSync,
    unlinkSync,
    existsSync,
    Dirent,
    promises,
};

export default fs;
