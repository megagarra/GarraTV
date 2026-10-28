import { NextResponse } from 'next/server';
import { enforceApiAccess } from '@/app/lib/apiAuth';
import {
    getFreeChannels,
    getFreeCountries,
    getFreeTierConfig,
    resolveCountry,
    saveFreeTierConfig,
} from '@/app/lib/freeChannels';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Action = 'saveConfig' | 'refresh';

interface FreeChannelsRequestBody {
    action?: Action;
    defaultCountry?: string;
    contactLabel?: string;
    contactUrl?: string;
    country?: string;
}

function isContactUrl(value: string): boolean {
    return /^https?:\/\//i.test(value) || value.indexOf('mailto:') === 0 || value.indexOf('tel:') === 0;
}

// GET - public: the guest screen needs it before anyone signs in. Stream URLs stay
// on the server; the player asks the relay for `?free=<id>`.
//   ?view=countries      -> countries that have a playlist
//   ?country=<cc>        -> that country's channels (default country otherwise)
export async function GET(request: Request) {
    const accessResponse = await enforceApiAccess(request);
    if (accessResponse) return accessResponse;

    const { searchParams } = new URL(request.url);
    const config = await getFreeTierConfig();
    const contact = { label: config.contactLabel, url: config.contactUrl };

    if (searchParams.get('view') === 'countries') {
        try {
            const countries = await getFreeCountries();
            return NextResponse.json({ data: { countries, defaultCountry: config.defaultCountry } });
        } catch (error) {
            console.error('[FreeChannels] Failed to load countries', error);
            return NextResponse.json({ error: 'Falha ao carregar os países' }, { status: 502 });
        }
    }

    const country = await resolveCountry(searchParams.get('country'));
    try {
        const playlist = await getFreeChannels(country);
        return NextResponse.json({
            data: {
                country,
                channels: playlist.channels.map(({ id, name, logo, groups }) => ({ id, name, logo, groups })),
                updatedAt: playlist.updatedAt,
                contact,
                defaultCountry: config.defaultCountry,
            },
        });
    } catch (error) {
        console.error('[FreeChannels] Failed to load playlist', country, error);
        return NextResponse.json({
            error: 'Falha ao carregar a lista gratuita',
            data: { country, channels: [], updatedAt: 0, contact, defaultCountry: config.defaultCountry },
        }, { status: 502 });
    }
}

export async function POST(request: Request) {
    const accessResponse = await enforceApiAccess(request);
    if (accessResponse) return accessResponse;

    try {
        const body = await request.json() as FreeChannelsRequestBody;

        switch (body.action) {
            case 'saveConfig': {
                const contactUrl = (body.contactUrl ?? '').trim();
                if (contactUrl && !isContactUrl(contactUrl)) {
                    return NextResponse.json({ error: 'Link de contato inválido' }, { status: 400 });
                }
                await saveFreeTierConfig({
                    defaultCountry: await resolveCountry(body.defaultCountry),
                    contactLabel: (body.contactLabel ?? '').trim().slice(0, 200),
                    contactUrl,
                });
                return NextResponse.json({ success: true });
            }
            case 'refresh': {
                const country = await resolveCountry(body.country);
                const playlist = await getFreeChannels(country, true);
                return NextResponse.json({ data: { country, count: playlist.channels.length, updatedAt: playlist.updatedAt } });
            }
            default:
                return NextResponse.json({ error: 'Ação inválida' }, { status: 400 });
        }
    } catch (error) {
        console.error('[FreeChannels] Request failed', error);
        return NextResponse.json({ error: 'Falha ao atualizar a lista gratuita' }, { status: 500 });
    }
}
