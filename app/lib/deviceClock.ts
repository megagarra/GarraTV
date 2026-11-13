/**
 * Times shown in the app follow the device's clock settings. In the Android app
 * the system is asked for its time zone offset and 12/24-hour choice: some TV
 * WebViews (the TCL's) cannot resolve the system zone and run in UTC, and the
 * locale alone does not say whether the owner picked a 24-hour clock. Browsers
 * and webOS keep the browser's own local time.
 */
interface ClockBridge {
    utcOffsetMinutes?: () => number;
    is24HourClock?: () => boolean;
}

function clockBridge(): ClockBridge | undefined {
    if (typeof window === 'undefined') return undefined;
    return (window as unknown as { GarraTVApp?: ClockBridge }).GarraTVApp;
}

/** The date shifted so that its UTC fields read as the device's wall clock, or null off Android. */
function deviceWallClock(date: Date): Date | null {
    const bridge = clockBridge();
    if (!bridge || typeof bridge.utcOffsetMinutes !== 'function') return null;
    try {
        const offset = Number(bridge.utcOffsetMinutes());
        return Number.isFinite(offset) ? new Date(date.getTime() + offset * 60_000) : null;
    } catch {
        return null;
    }
}

function deviceHour12(): boolean | undefined {
    const bridge = clockBridge();
    if (!bridge || typeof bridge.is24HourClock !== 'function') return undefined;
    try {
        return !bridge.is24HourClock();
    } catch {
        return undefined;
    }
}

/** "21:05" / "9:05 PM", as the device shows it. */
export function formatDeviceTime(date: Date, locale: string): string {
    const options: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit' };
    const hour12 = deviceHour12();
    if (hour12 !== undefined) options.hour12 = hour12;
    const wall = deviceWallClock(date);
    const text = wall
        ? wall.toLocaleTimeString(locale, { ...options, timeZone: 'UTC' })
        : date.toLocaleTimeString(locale, options);
    // Some Chrome versions print midnight as "24:05" with hour12: false.
    return hour12 === false ? text.replace(/^24/, '00') : text;
}

/** "sábado, 1 de novembro", on the device's calendar day. */
export function formatDeviceDate(date: Date, locale: string, options: Intl.DateTimeFormatOptions): string {
    const wall = deviceWallClock(date);
    return wall ? wall.toLocaleDateString(locale, { ...options, timeZone: 'UTC' }) : date.toLocaleDateString(locale, options);
}
