import { NextResponse } from 'next/server';
import { enforceAccountAccess } from '@/app/lib/apiAuth';
import { readCredentials } from '@/app/lib/liveShare';
import { refreshSpotlight } from '@/app/lib/spotlight';
import type { ContentType } from '@/app/lib/dbTypes';
import { syncXtreamToSqlite, type SyncProgressUpdate, type SyncStage, type XtreamCredentials } from '@/app/lib/xtreamSync';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type SyncJobStatus = 'running' | 'completed' | 'failed' | 'cancelled';

interface SyncTypeProgress {
    stage: SyncStage;
    processed: number;
    total: number;
}

interface SyncJob {
    id: string;
    status: SyncJobStatus;
    progress: number;
    message: string;
    startedAt: number;
    updatedAt: number;
    lastSync?: number;
    error?: string;
    /** One entry per content type, for the loading screen's three rows. */
    perType: Record<ContentType, SyncTypeProgress>;
    controller: AbortController;
}

type SyncJobResponse = Omit<SyncJob, 'controller'>;

const globalSyncState = globalThis as typeof globalThis & {
    garratvSyncJobs?: Map<string, SyncJob>;
};

function jobs() {
    if (!globalSyncState.garratvSyncJobs) {
        globalSyncState.garratvSyncJobs = new Map();
    }

    return globalSyncState.garratvSyncJobs;
}

function publicJob(job: SyncJob): SyncJobResponse {
    return {
        id: job.id,
        status: job.status,
        progress: job.progress,
        message: job.message,
        startedAt: job.startedAt,
        updatedAt: job.updatedAt,
        lastSync: job.lastSync,
        error: job.error,
        perType: job.perType,
    };
}

function currentRunningJob() {
    for (const job of jobs().values()) {
        if (job.status === 'running') return job;
    }

    return undefined;
}

const waiting = (): SyncTypeProgress => ({ stage: 'waiting', processed: 0, total: 0 });

function createJob() {
    // Finished jobs are only polled for a moment after they end; keep the map small.
    for (const [id, old] of jobs()) {
        if (old.status !== 'running') jobs().delete(id);
    }
    const job: SyncJob = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        status: 'running',
        progress: 0,
        message: 'Iniciando sincronizacao no servidor',
        startedAt: Date.now(),
        updatedAt: Date.now(),
        perType: { live: waiting(), movie: waiting(), series: waiting() },
        controller: new AbortController(),
    };

    jobs().set(job.id, job);
    return job;
}

function updateJob(job: SyncJob, update: Partial<SyncProgressUpdate>) {
    if (typeof update.progress === 'number') {
        job.progress = Math.max(0, Math.min(100, update.progress));
    }
    if (update.message) job.message = update.message;
    if (update.type && update.stage) {
        job.perType[update.type] = {
            stage: update.stage,
            processed: update.processed ?? 0,
            total: update.total ?? 0,
        };
    }
    job.updatedAt = Date.now();
}

async function runJob(job: SyncJob, credentials: XtreamCredentials) {
    try {
        const lastSync = await syncXtreamToSqlite(credentials, job.controller.signal, update => updateJob(job, update));
        job.status = 'completed';
        job.progress = 100;
        job.message = 'Sincronizacao concluida';
        job.lastSync = lastSync;
        // New catalog: rebuild the home highlights now, before anyone opens home.
        refreshSpotlight('pt-BR');
    } catch (error) {
        if (job.controller.signal.aborted) {
            job.status = 'cancelled';
            job.message = 'Sincronizacao cancelada';
        } else {
            job.status = 'failed';
            job.error = error instanceof Error ? error.message : 'Erro desconhecido na sincronizacao';
            job.message = job.error;
            console.error('[ServerSync] Job failed:', error);
        }
    } finally {
        job.updatedAt = Date.now();
    }
}

export async function POST(request: Request) {
    const accessResponse = await enforceAccountAccess(request);
    if (accessResponse) return accessResponse;

    try {
        const credentials = await readCredentials();
        if (!credentials) {
            return NextResponse.json({ error: 'Conta não configurada' }, { status: 503 });
        }

        const running = currentRunningJob();
        if (running) {
            return NextResponse.json({ job: publicJob(running), reused: true });
        }

        const job = createJob();
        void runJob(job, credentials);

        return NextResponse.json({ job: publicJob(job) });
    } catch (error) {
        console.error('[ServerSync] Failed to start job:', error);
        return NextResponse.json({ error: 'Failed to start sync' }, { status: 500 });
    }
}

export async function GET(request: Request) {
    const accessResponse = await enforceAccountAccess(request);
    if (accessResponse) return accessResponse;

    const { searchParams } = new URL(request.url);
    const jobId = searchParams.get('jobId');
    const job = jobId ? jobs().get(jobId) : currentRunningJob();

    if (!job) {
        return NextResponse.json({ job: null });
    }

    return NextResponse.json({ job: publicJob(job) });
}

export async function DELETE(request: Request) {
    const accessResponse = await enforceAccountAccess(request);
    if (accessResponse) return accessResponse;

    const { searchParams } = new URL(request.url);
    const jobId = searchParams.get('jobId');
    const job = jobId ? jobs().get(jobId) : currentRunningJob();

    if (!job) {
        return NextResponse.json({ success: true });
    }

    job.controller.abort();
    job.status = 'cancelled';
    job.progress = 0;
    job.message = 'Sincronizacao cancelada';
    job.updatedAt = Date.now();

    return NextResponse.json({ success: true, job: publicJob(job) });
}
