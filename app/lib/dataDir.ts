import path from 'path';

/**
 * Where SQLite, config and the subtitle cache live.
 *
 * Docker and `next dev` leave this unset and keep using `./data`.
 * The Windows app sets `GARRATV_DATA_DIR` because the install folder
 * (and a Microsoft Store package) is not a safe place for that state.
 *
 * Read through a computed key so the production bundle does not inline
 * the value from the machine that ran `next build`.
 */
export function dataDir(): string {
    const key = 'GARRATV_DATA_DIR';
    const override = process.env[key];
    if (typeof override === 'string' && override.trim().length > 0) {
        return path.resolve(override);
    }
    return path.join(process.cwd(), 'data');
}
