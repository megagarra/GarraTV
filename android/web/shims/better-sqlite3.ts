/**
 * The subset of better-sqlite3 the server stores use, over the Android SQLite
 * bridge. Same synchronous semantics, so sqliteCache/userStore/tvModeStore run
 * in the WebView without a line changed.
 */
import { dbBridge, unwrap } from './native';

type Row = Record<string, unknown>;

interface RunResult {
    changes: number;
    lastInsertRowid: number;
}

interface CompiledSql {
    sql: string;
    /** Named parameters in binding order, or null when the statement is positional. */
    names: string[] | null;
}

/**
 * The native side binds by position only, so `@name`/`:name`/`$name` are rewritten
 * to `?` here. Quotes, identifiers and comments are skipped so a literal like
 * 'a:b' is never mistaken for a parameter.
 */
function compile(source: string): CompiledSql {
    const names: string[] = [];
    let out = '';
    let i = 0;
    while (i < source.length) {
        const ch = source[i];
        if (ch === "'" || ch === '"' || ch === '`' || ch === '[') {
            const close = ch === '[' ? ']' : ch;
            let j = i + 1;
            while (j < source.length) {
                if (source[j] === close) {
                    if (close !== ']' && source[j + 1] === close) {
                        j += 2;
                        continue;
                    }
                    break;
                }
                j++;
            }
            out += source.slice(i, j + 1);
            i = j + 1;
            continue;
        }
        if (ch === '-' && source[i + 1] === '-') {
            const end = source.indexOf('\n', i);
            const stop = end === -1 ? source.length : end;
            out += source.slice(i, stop);
            i = stop;
            continue;
        }
        if (ch === '/' && source[i + 1] === '*') {
            const end = source.indexOf('*/', i + 2);
            const stop = end === -1 ? source.length : end + 2;
            out += source.slice(i, stop);
            i = stop;
            continue;
        }
        if ((ch === '@' || ch === ':' || ch === '$') && /[A-Za-z_]/.test(source[i + 1] || '')) {
            let j = i + 1;
            while (j < source.length && /[A-Za-z0-9_]/.test(source[j])) j++;
            names.push(source.slice(i + 1, j));
            out += '?';
            i = j;
            continue;
        }
        out += ch;
        i++;
    }
    return { sql: out, names: names.length > 0 ? names : null };
}

function toSqlValue(value: unknown): unknown {
    if (value === undefined || value === null) return null;
    if (typeof value === 'boolean') return value ? 1 : 0;
    if (typeof value === 'bigint') return Number(value);
    if (typeof value === 'number' || typeof value === 'string') return value;
    throw new TypeError('SQLite3 can only bind numbers, strings, bigints, buffers, and null');
}

function flatten(args: unknown[]): unknown[] {
    const values: unknown[] = [];
    for (const arg of args) {
        if (Array.isArray(arg)) values.push(...arg);
        else values.push(arg);
    }
    return values;
}

class Statement {
    private readonly compiled: CompiledSql;
    private pluckFirst = false;

    constructor(private readonly db: Database, readonly source: string) {
        this.compiled = compile(source);
    }

    pluck(toggle = true): this {
        this.pluckFirst = toggle;
        return this;
    }

    private params(args: unknown[]): string {
        let values: unknown[];
        if (this.compiled.names) {
            const named = (args.find(arg => arg !== null && typeof arg === 'object' && !Array.isArray(arg)) ?? {}) as Row;
            values = this.compiled.names.map((name) => {
                if (!(name in named)) throw new RangeError(`Missing named parameter "${name}"`);
                return named[name];
            });
        } else {
            values = flatten(args);
        }
        return JSON.stringify(values.map(toSqlValue));
    }

    private call<T>(mode: string, args: unknown[]): T {
        return unwrap<T>(dbBridge().query(this.db.handle, this.compiled.sql, this.params(args), mode));
    }

    run(...args: unknown[]): RunResult {
        return this.call<RunResult>('run', args);
    }

    get(...args: unknown[]): unknown {
        const row = this.call<Row | null>('get', args);
        if (row === null || row === undefined) return undefined;
        return this.pluckFirst ? row[Object.keys(row)[0]] : row;
    }

    all(...args: unknown[]): unknown[] {
        const rows = this.call<Row[]>('all', args);
        return this.pluckFirst ? rows.map(row => row[Object.keys(row)[0]]) : rows;
    }

    iterate(...args: unknown[]): IterableIterator<unknown> {
        return this.all(...args)[Symbol.iterator]();
    }
}

interface PragmaOptions {
    simple?: boolean;
}

type TransactionFn<A extends unknown[], R> = ((...args: A) => R) & {
    deferred: (...args: A) => R;
    immediate: (...args: A) => R;
    exclusive: (...args: A) => R;
};

export default class Database {
    readonly handle: number;
    readonly name: string;
    open = true;
    private depth = 0;
    private readonly statements = new Map<string, Statement>();

    constructor(filename: string) {
        this.name = filename;
        const base = filename.split(/[\\/]/).pop() || filename;
        this.handle = dbBridge().open(base);
        if (this.handle < 0) throw new Error(`Unable to open database ${base}`);
    }

    get inTransaction(): boolean {
        return this.depth > 0;
    }

    prepare(source: string): Statement {
        let statement = this.statements.get(source);
        if (!statement) {
            statement = new Statement(this, source);
            this.statements.set(source, statement);
        }
        return statement;
    }

    exec(source: string): this {
        unwrap<null>(dbBridge().exec(this.handle, source));
        return this;
    }

    pragma(source: string, options: PragmaOptions = {}): unknown {
        const rows = unwrap<Row[]>(dbBridge().query(this.handle, `PRAGMA ${source}`, '[]', 'all'));
        if (!options.simple) return rows;
        const first = rows[0];
        return first ? first[Object.keys(first)[0]] : undefined;
    }

    transaction<A extends unknown[], R>(fn: (...args: A) => R): TransactionFn<A, R> {
        const wrapped = (...args: A): R => {
            const nested = this.depth > 0;
            const savepoint = `tx_${this.depth}`;
            this.exec(nested ? `SAVEPOINT ${savepoint}` : 'BEGIN');
            this.depth++;
            try {
                const result = fn(...args);
                this.depth--;
                this.exec(nested ? `RELEASE ${savepoint}` : 'COMMIT');
                return result;
            } catch (error) {
                this.depth--;
                this.exec(nested ? `ROLLBACK TO ${savepoint}; RELEASE ${savepoint}` : 'ROLLBACK');
                throw error;
            }
        };
        return Object.assign(wrapped, { deferred: wrapped, immediate: wrapped, exclusive: wrapped });
    }

    close(): this {
        this.open = false;
        return this;
    }
}
