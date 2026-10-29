'use client';

import { useSyncExternalStore } from 'react';
import { isAndroidApp } from '@/app/lib/apiClient';

const neverChanges = () => () => undefined;

/**
 * True dentro do app Android (sem servidor), onde o Modo TV e o pareamento de
 * aparelhos não existem. A pré-renderização (e a hidratação) usa `false`: as
 * páginas do APK são geradas sem saber onde vão rodar, e o React troca para o
 * valor real logo depois, sem erro de hidratação.
 */
export function useIsAndroidApp(): boolean {
    return useSyncExternalStore(neverChanges, isAndroidApp, () => false);
}
