'use client';

import { useEffect } from 'react';
import { isRemoteControlDevice } from '@/app/lib/deviceProfile';

const LOCK_ATTR = 'data-remote-locked';
const TEXT_TYPES = ['', 'text', 'search', 'password', 'email', 'url', 'tel', 'number'];

type TextField = HTMLInputElement | HTMLTextAreaElement;

function isTextField(el: EventTarget | null): el is TextField {
    if (el instanceof HTMLTextAreaElement) return true;
    return el instanceof HTMLInputElement && TEXT_TYPES.indexOf((el.getAttribute('type') || '').toLowerCase()) !== -1;
}

function isOkKey(event: KeyboardEvent): boolean {
    // 23 = DPAD_CENTER on remotes whose OK isn't mapped to Enter.
    return event.key === 'Enter' || event.keyCode === 13 || event.keyCode === 23;
}

/**
 * Em TVs com controle remoto, o teclado virtual só abre quando o usuário aperta
 * OK sobre um campo de texto (ou toca nele) — nunca só porque o foco passou por
 * ali ao navegar. Enquanto apenas focado, o campo fica `readOnly`, e o WebView /
 * navegador da TV não abre teclado para campo somente leitura. Celular e PC não
 * são afetados.
 */
export function useRemoteTextFields() {
    useEffect(() => {
        if (!isRemoteControlDevice()) return undefined;

        // The field the user is about to type in: its next focus must not be locked.
        let editing: TextField | null = null;

        const lock = (field: TextField) => {
            // A field that is read-only on purpose stays out of this.
            if (field.readOnly) return;
            field.readOnly = true;
            field.setAttribute(LOCK_ATTR, 'true');
        };
        const unlock = (field: TextField) => {
            if (field.getAttribute(LOCK_ATTR) !== 'true') return;
            field.removeAttribute(LOCK_ATTR);
            field.readOnly = false;
        };

        const onFocusIn = (event: FocusEvent) => {
            const field = event.target;
            if (!isTextField(field)) return;
            if (field === editing) {
                editing = null;
                return;
            }
            lock(field);
        };
        const onFocusOut = (event: FocusEvent) => {
            if (isTextField(event.target)) unlock(event.target);
        };

        const startEditing = (field: TextField) => {
            editing = field;
            unlock(field);
            // Focusing an editable field is what makes the WebView show the keyboard,
            // so the already-focused field is focused again now that it is writable.
            field.blur();
            field.focus();
        };

        const onKeyDown = (event: KeyboardEvent) => {
            const field = document.activeElement;
            if (!isTextField(field) || field.getAttribute(LOCK_ATTR) !== 'true') return;
            if (isOkKey(event)) {
                event.preventDefault();
                event.stopPropagation();
                startEditing(field);
            } else if (event.key && event.key.length === 1) {
                // A physical keyboard on the TV: typing just works.
                unlock(field);
            }
        };

        // Touch or a pointer remote (LG Magic Remote): a deliberate click edits.
        // mousedown/touchstart, not pointerdown: Chrome 53 has no pointer events.
        const onPress = (event: Event) => {
            const field = event.target;
            if (!isTextField(field)) return;
            if (document.activeElement === field) startEditing(field);
            else editing = field;
        };

        document.addEventListener('focusin', onFocusIn, true);
        document.addEventListener('focusout', onFocusOut, true);
        window.addEventListener('keydown', onKeyDown, true);
        document.addEventListener('mousedown', onPress, true);
        document.addEventListener('touchstart', onPress, true);

        // A field focused before this ran (autoFocus) is locked right away.
        if (isTextField(document.activeElement)) lock(document.activeElement);

        return () => {
            document.removeEventListener('focusin', onFocusIn, true);
            document.removeEventListener('focusout', onFocusOut, true);
            window.removeEventListener('keydown', onKeyDown, true);
            document.removeEventListener('mousedown', onPress, true);
            document.removeEventListener('touchstart', onPress, true);
        };
    }, []);
}
