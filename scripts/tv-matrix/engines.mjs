/**
 * The TV engines the matrix covers. `base` is the Chromium branch base position of
 * that major version: the newest trunk snapshot at or below it is that version.
 */

export const ENGINES = [
    { id: 'c53', major: 53, base: 403382, platform: 'webos', tvs: 'webOS 4.x (2018-19) - app floor' },
    { id: 'c68', major: 68, base: 576753, platform: 'webos', tvs: 'webOS 5 (2020)' },
    // r664998's Windows sandbox kills its renderers on Windows 11 (the TV runs it on Linux, unsandboxed by Windows).
    { id: 'c76', major: 76, base: 665002, platform: 'tizen', tvs: 'Tizen 6.0 (2021)', extraArgs: ['--no-sandbox'] },
    { id: 'c79', major: 79, base: 706915, platform: 'webos', tvs: 'webOS 6 (2021)' },
    { id: 'c85', major: 85, base: 782793, platform: 'tizen', tvs: 'Tizen 6.5 (2022)' },
    { id: 'c87', major: 87, base: 812852, platform: 'webos', tvs: 'webOS 22' },
    { id: 'c94', major: 94, base: 911515, platform: 'webos', tvs: 'webOS 23, Tizen 7' },
    { id: 'c108', major: 108, base: 1058933, platform: 'tizen', tvs: 'webOS 24, Tizen 8' },
    { id: 'stable', major: 0, base: 0, platform: 'android', hasH264: true, tvs: 'Android TV / Google TV / Fire TV (current WebView)' },
];

/** User agents the real TVs send, with the engine's own major version. */
export function userAgentFor(engine, actualVersion) {
    const chrome = actualVersion || `${engine.major}.0.0.0`;
    if (engine.platform === 'webos') {
        return `Mozilla/5.0 (Web0S; Linux/SmartTV) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chrome} Safari/537.36 WebAppManager`;
    }
    if (engine.platform === 'tizen') {
        return `Mozilla/5.0 (SMART-TV; LINUX; Tizen 6.0) AppleWebKit/537.36 (KHTML, like Gecko) Version/6.0 Chrome/${chrome} TV Safari/537.36`;
    }
    return null;
}

/** Back key code per platform (webOS 461, Tizen 10009, Android Escape/Backspace). */
export function backKeyFor(engine) {
    if (engine.platform === 'webos') return { keyCode: 461, key: 'GoBack', code: '' };
    if (engine.platform === 'tizen') return { keyCode: 10009, key: 'XF86Back', code: '' };
    return { keyCode: 27, key: 'Escape', code: 'Escape' };
}
