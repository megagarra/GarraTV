/** POSIX `path`, the handful of functions the server code calls. */

export const sep = '/';

export function normalize(input: string): string {
    const absolute = input.startsWith('/');
    const parts: string[] = [];
    for (const part of input.split(/[\\/]+/)) {
        if (!part || part === '.') continue;
        if (part === '..') {
            if (parts.length && parts[parts.length - 1] !== '..') parts.pop();
            else if (!absolute) parts.push('..');
            continue;
        }
        parts.push(part);
    }
    const joined = parts.join('/');
    return absolute ? `/${joined}` : joined || '.';
}

export function join(...segments: string[]): string {
    return normalize(segments.filter(Boolean).join('/'));
}

export function resolve(...segments: string[]): string {
    let resolved = '';
    for (let i = segments.length - 1; i >= 0 && !resolved.startsWith('/'); i--) {
        if (segments[i]) resolved = resolved ? `${segments[i]}/${resolved}` : segments[i];
    }
    return normalize(resolved.startsWith('/') ? resolved : `/app/${resolved}`);
}

export function dirname(input: string): string {
    const normalized = normalize(input);
    const index = normalized.lastIndexOf('/');
    if (index <= 0) return index === 0 ? '/' : '.';
    return normalized.slice(0, index);
}

export function basename(input: string, ext?: string): string {
    const base = normalize(input).split('/').pop() || '';
    return ext && base.endsWith(ext) ? base.slice(0, -ext.length) : base;
}

export function extname(input: string): string {
    const base = basename(input);
    const index = base.lastIndexOf('.');
    return index > 0 ? base.slice(index) : '';
}

const path = { sep, normalize, join, resolve, dirname, basename, extname, posix: {} as Record<string, unknown> };
path.posix = path;

export default path;
