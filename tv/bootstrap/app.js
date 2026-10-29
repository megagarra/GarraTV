/*
 * GarraTV — TV client.
 *
 * Installed on the television and talks to the viewer's IPTV provider directly,
 * the same way a Smarters-style player does. There is no home server to type
 * and no device to approve: the Xtream portal URL, username and password stay
 * on this set and the streams play from the provider.
 *
 * ES5 only, no dependencies: this must also run on webOS 5 (Chromium 68).
 */
(function () {
    'use strict';

    var STORAGE_HOST = 'garratv_xtream_host';
    var STORAGE_USER = 'garratv_xtream_user';
    var STORAGE_PASS = 'garratv_xtream_pass';

    var REQUEST_TIMEOUT_MS = 25000;
    var KEY_BACK_TV = 461;
    var KEY_BACK_TIZEN = 10009;
    var KEY_BACK_ANDROID = 4;
    var LIST_CAP = 300;

    var SECTIONS = {
        live: { categories: 'get_live_categories', items: 'get_live_streams', idKey: 'stream_id' },
        movie: { categories: 'get_vod_categories', items: 'get_vod_streams', idKey: 'stream_id' },
        series: { categories: 'get_series_categories', items: 'get_series', idKey: 'series_id' }
    };

    var account = null;
    var section = 'live';
    var cache = {};
    var categoryId = '';
    var episodes = null;
    var playing = null;

    var memory = {};

    function read(key) {
        if (Object.prototype.hasOwnProperty.call(memory, key)) return memory[key];
        var value = '';
        try { value = window.localStorage.getItem(key) || ''; } catch (e) { value = ''; }
        memory[key] = value;
        return value;
    }

    function write(key, value) {
        memory[key] = value || '';
        try {
            if (value) window.localStorage.setItem(key, value);
            else window.localStorage.removeItem(key);
        } catch (e) { /* this session still works */ }
    }

    function $(id) { return document.getElementById(id); }

    var SCREENS = ['screen-loading', 'screen-login', 'screen-home', 'screen-player'];

    function show(id) {
        for (var i = 0; i < SCREENS.length; i++) {
            var element = $(SCREENS[i]);
            if (!element) continue;
            var base = element.getAttribute('data-base') || 'screen';
            element.className = (SCREENS[i] === id) ? base : base + ' hidden';
        }
        var focusable = $(id).querySelector('[data-focusable="true"]');
        if (focusable) {
            try { focusable.focus(); } catch (e) { /* ignore */ }
        }
    }

    function setText(id, text) {
        var node = $(id);
        node.innerHTML = '';
        node.appendChild(document.createTextNode(text));
    }

    function request(url, onDone) {
        var xhr = new XMLHttpRequest();
        var settled = false;

        function finish(status, text) {
            if (settled) return;
            settled = true;
            onDone(status, text);
        }

        try { xhr.open('GET', url, true); } catch (e) { finish(0, ''); return; }

        var watchdog = window.setTimeout(function () { finish(0, ''); }, REQUEST_TIMEOUT_MS);
        var settle = function (status, text) {
            window.clearTimeout(watchdog);
            finish(status, text);
        };

        xhr.timeout = REQUEST_TIMEOUT_MS;
        xhr.onreadystatechange = function () {
            if (xhr.readyState === 4) settle(xhr.status, xhr.responseText);
        };
        xhr.ontimeout = function () { settle(0, ''); };
        xhr.onerror = function () { settle(0, ''); };

        try { xhr.send(); } catch (e) { settle(0, ''); }
    }

    function parseJson(text) {
        try { return JSON.parse(text); } catch (e) { return null; }
    }

    function normalizeHost(value) {
        var host = String(value || '').replace(/^\s+|\s+$/g, '').replace(/\/+$/, '');
        if (!host) return '';
        if (host.indexOf('://') === -1) host = 'http://' + host;
        return host;
    }

    function apiUrl(action, extra) {
        var url = account.host + '/player_api.php?username=' + encodeURIComponent(account.username) +
            '&password=' + encodeURIComponent(account.password);
        if (action) url += '&action=' + encodeURIComponent(action);
        if (extra) url += extra;
        return url;
    }

    function streamUrl(kind, id, extension) {
        var ext = extension || (kind === 'live' ? 'm3u8' : 'mp4');
        return account.host + '/' + kind + '/' + encodeURIComponent(account.username) + '/' +
            encodeURIComponent(account.password) + '/' + encodeURIComponent(id) + '.' + ext;
    }

    function showLogin(message) {
        $('login-submit').disabled = false;
        setText('login-submit', 'Entrar');
        if (message) {
            setText('login-error', message);
            $('login-error').className = 'error';
        } else {
            $('login-error').className = 'error hidden';
        }
        show('screen-login');
    }

    function loginFailed(message) {
        showLogin(message || 'Não foi possível entrar. Confira o servidor, o usuário e a senha.');
    }

    function remember(host, username, password) {
        account = { host: host, username: username, password: password };
        write(STORAGE_HOST, host);
        write(STORAGE_USER, username);
        write(STORAGE_PASS, password);
    }

    function forget() {
        account = null;
        cache = {};
        episodes = null;
        stopPlayback();
        write(STORAGE_HOST, '');
        write(STORAGE_USER, '');
        write(STORAGE_PASS, '');
        $('portal-input').value = '';
        $('user-input').value = '';
        $('pass-input').value = '';
        showLogin('');
    }

    function checkAccount(next) {
        request(apiUrl(''), function (status, text) {
            var data = parseJson(text);
            var info = data && data.user_info;
            if (status !== 200 || !info || String(info.auth) !== '1') {
                next(false);
                return;
            }
            next(true);
        });
    }

    function submitLogin() {
        var host = normalizeHost($('portal-input').value);
        var username = String($('user-input').value || '').replace(/^\s+|\s+$/g, '');
        var password = String($('pass-input').value || '');
        if (!host || !username || !password) {
            showLogin('Preencha o servidor, o usuário e a senha.');
            return;
        }
        $('login-submit').disabled = true;
        setText('login-submit', 'Entrando…');
        $('login-error').className = 'error hidden';
        account = { host: host, username: username, password: password };
        checkAccount(function (ok) {
            if (!ok) {
                account = null;
                loginFailed('');
                return;
            }
            remember(host, username, password);
            openSection('live');
        });
    }

    function loadAction(action, extra, next) {
        request(apiUrl(action, extra), function (status, text) {
            var data = parseJson(text);
            if (status !== 200 || !data) {
                next(null);
                return;
            }
            next(data);
        });
    }

    function asList(value) {
        return Object.prototype.toString.call(value) === '[object Array]' ? value : [];
    }

    function itemName(item) {
        return String(item.name || item.title || 'Sem nome');
    }

    function itemId(item) {
        var spec = SECTIONS[section];
        return String(item[spec.idKey] || item.id || '');
    }

    function ensureSection(name, next) {
        if (cache[name]) {
            next(cache[name]);
            return;
        }
        var spec = SECTIONS[name];
        show('screen-loading');
        loadAction(spec.categories, '', function (categories) {
            if (!categories) {
                showLogin('A lista não respondeu. Confira se o servidor do provedor está no ar.');
                return;
            }
            loadAction(spec.items, '', function (items) {
                if (!items) {
                    showLogin('A lista não respondeu. Confira se o servidor do provedor está no ar.');
                    return;
                }
                cache[name] = { categories: asList(categories), items: asList(items) };
                next(cache[name]);
            });
        });
    }

    function categoriesFor(data) {
        var list = [{ category_id: '', category_name: 'Todos' }];
        for (var i = 0; i < data.categories.length; i++) list.push(data.categories[i]);
        return list;
    }

    function itemsFor(data) {
        if (section === 'series' && episodes) return episodes;
        var all = data.items;
        if (!categoryId) return all;
        var matched = [];
        for (var i = 0; i < all.length; i++) {
            if (String(all[i].category_id) === String(categoryId)) matched.push(all[i]);
        }
        return matched;
    }

    function fillColumn(column, rows, emptyText, onChoose) {
        column.innerHTML = '';
        if (!rows.length) {
            var empty = document.createElement('div');
            empty.className = 'row-empty';
            empty.appendChild(document.createTextNode(emptyText));
            column.appendChild(empty);
            return;
        }
        var shown = rows.length > LIST_CAP ? rows.slice(0, LIST_CAP) : rows;
        for (var i = 0; i < shown.length; i++) {
            (function (row) {
                var button = document.createElement('button');
                button.className = 'row';
                button.setAttribute('data-focusable', 'true');
                button.appendChild(document.createTextNode(row.label));
                button.onclick = function () { onChoose(row); };
                column.appendChild(button);
            })(shown[i]);
        }
        if (rows.length > LIST_CAP) {
            var more = document.createElement('div');
            more.className = 'row-empty';
            more.appendChild(document.createTextNode('Mostrando ' + LIST_CAP + ' de ' + rows.length + '. Escolha uma categoria.'));
            column.appendChild(more);
        }
    }

    function renderHome() {
        var data = cache[section];
        if (!data) return;

        var tabs = ['live', 'movie', 'series'];
        for (var t = 0; t < tabs.length; t++) {
            $('tab-' + tabs[t]).className = 'tab' + (tabs[t] === section ? ' tab-on' : '');
        }

        var cats = categoriesFor(data);
        var catRows = [];
        for (var c = 0; c < cats.length; c++) {
            catRows.push({
                label: String(cats[c].category_name || 'Categoria'),
                id: String(cats[c].category_id || '')
            });
        }
        fillColumn($('cat-col'), catRows, 'Nenhuma categoria', function (row) {
            episodes = null;
            categoryId = row.id;
            renderHome();
            var first = $('item-col').querySelector('[data-focusable="true"]');
            if (first) first.focus();
        });

        var source = itemsFor(data);
        var itemRows = [];
        for (var i = 0; i < source.length; i++) {
            itemRows.push({ label: itemName(source[i]), raw: source[i] });
        }
        fillColumn($('item-col'), itemRows, 'Nada nesta categoria', function (row) {
            chooseItem(row.raw);
        });

        show('screen-home');
        markSelectedCategory();
    }

    function markSelectedCategory() {
        var buttons = $('cat-col').querySelectorAll('.row');
        var cats = categoriesFor(cache[section]);
        for (var i = 0; i < buttons.length && i < cats.length; i++) {
            if (String(cats[i].category_id || '') === String(categoryId)) buttons[i].className = 'row row-on';
        }
    }

    function openSection(name) {
        section = name;
        categoryId = '';
        episodes = null;
        ensureSection(name, function () { renderHome(); });
    }

    function chooseItem(item) {
        if (section === 'series' && !episodes) {
            show('screen-loading');
            loadAction('get_series_info', '&series_id=' + encodeURIComponent(itemId(item)), function (info) {
                var grouped = info && info.episodes;
                var flat = [];
                if (grouped) {
                    for (var season in grouped) {
                        if (!Object.prototype.hasOwnProperty.call(grouped, season)) continue;
                        var list = asList(grouped[season]);
                        for (var i = 0; i < list.length; i++) {
                            flat.push({
                                name: 'T' + season + ' · ' + itemName(list[i]),
                                id: String(list[i].id || ''),
                                container_extension: list[i].container_extension || 'mp4'
                            });
                        }
                    }
                }
                episodes = flat;
                renderHome();
                var first = $('item-col').querySelector('[data-focusable="true"]');
                if (first) first.focus();
            });
            return;
        }

        var id = episodes ? String(item.id || '') : itemId(item);
        var extension = item.container_extension || '';
        var kind = section === 'live' ? 'live' : (section === 'movie' ? 'movie' : 'series');
        play(itemName(item), streamUrl(kind, id, extension));
    }

    function play(title, url) {
        playing = { title: title, url: url };
        var video = $('player');
        setText('player-title', title);
        show('screen-player');
        try {
            video.pause();
            video.src = url;
            var started = video.play();
            if (started && started.catch) started.catch(function () { /* autoplay can wait for a key */ });
        } catch (e) { /* the provider URL is still loaded on the element */ }
    }

    function stopPlayback() {
        playing = null;
        var video = $('player');
        try {
            video.pause();
            video.removeAttribute('src');
            video.load();
        } catch (e) { /* ignore */ }
    }

    function stepChannel(delta) {
        if (!playing || !cache[section]) return;
        var rows = itemsFor(cache[section]);
        if (!rows.length) return;
        var current = -1;
        for (var i = 0; i < rows.length; i++) {
            if (itemName(rows[i]) === playing.title) current = i;
        }
        var next = current + delta;
        if (next < 0 || next >= rows.length) return;
        chooseItem(rows[next]);
    }

    function columnButtons() {
        var active = document.activeElement;
        var home = $('screen-home');
        if (!home || home.className.indexOf('hidden') !== -1) return [];
        if (active && $('cat-col').contains(active)) return $('cat-col').querySelectorAll('[data-focusable="true"]');
        if (active && $('item-col').contains(active)) return $('item-col').querySelectorAll('[data-focusable="true"]');
        return [];
    }

    function moveInColumn(delta) {
        var buttons = columnButtons();
        if (!buttons.length) return false;
        var index = -1;
        for (var i = 0; i < buttons.length; i++) {
            if (buttons[i] === document.activeElement) index = i;
        }
        var next = index + delta;
        if (next < 0) next = 0;
        if (next >= buttons.length) next = buttons.length - 1;
        buttons[next].focus();
        try { buttons[next].scrollIntoView(false); } catch (e) { /* ignore */ }
        return true;
    }

    function switchColumn(toItems) {
        var column = $(toItems ? 'item-col' : 'cat-col');
        var button = column.querySelector('[data-focusable="true"]');
        if (button) button.focus();
    }

    function onKey(event) {
        var code = event.keyCode;

        if (code === KEY_BACK_TV || code === KEY_BACK_TIZEN || code === KEY_BACK_ANDROID) {
            event.preventDefault();
            if ($('screen-player').className.indexOf('hidden') === -1) {
                stopPlayback();
                show('screen-home');
                return;
            }
            if (episodes) {
                episodes = null;
                renderHome();
                return;
            }
            if ($('screen-home').className.indexOf('hidden') === -1) {
                var inItems = document.activeElement && $('item-col').contains(document.activeElement);
                if (inItems) switchColumn(false);
                return;
            }
            exitApp();
            return;
        }

        if ($('screen-player').className.indexOf('hidden') === -1) {
            if (code === 427 || code === 33) stepChannel(-1);
            if (code === 428 || code === 34) stepChannel(1);
            return;
        }

        if ($('screen-home').className.indexOf('hidden') !== -1) return;

        if (code === 38) {
            if (moveInColumn(-1)) event.preventDefault();
        } else if (code === 40) {
            if (moveInColumn(1)) event.preventDefault();
        } else if (code === 37) {
            switchColumn(false);
            event.preventDefault();
        } else if (code === 39) {
            switchColumn(true);
            event.preventDefault();
        }
    }

    function exitApp() {
        try {
            if (window.webOS && window.webOS.platformBack) {
                window.webOS.platformBack();
                return;
            }
            if (window.tizen && window.tizen.application) {
                window.tizen.application.getCurrentApplication().exit();
                return;
            }
        } catch (e) { /* fall through */ }
        window.close();
    }

    function bakedServers() {
        var list = window.GARRATV_SERVERS;
        var urls = [];
        if (!list || !list.length) return urls;
        for (var i = 0; i < list.length; i++) {
            if (list[i]) urls.push(String(list[i]).replace(/\/$/, ''));
        }
        return urls;
    }

    /**
     * The packaged TV opens the real GarraTV app: the same login, the free
     * channel list, and the rest of the layout. It does not ask for an address
     * and it does not ask anyone to approve the set.
     */
    function openGarraTV() {
        var urls = bakedServers();
        if (!urls.length) return false;

        show('screen-loading');
        var pending = urls.length;
        var opened = false;

        for (var i = 0; i < urls.length; i++) {
            (function (url) {
                request(url + '/garratv', function (status) {
                    if (opened) return;
                    if (status > 0) {
                        opened = true;
                        window.location.replace(url + '/garratv');
                        return;
                    }
                    pending -= 1;
                    if (pending === 0) showLogin('Não foi possível abrir o aplicativo. Confira se ele está no ar.');
                });
            })(urls[i]);
        }
        return true;
    }

    function boot() {
        if (openGarraTV()) return;

        var host = read(STORAGE_HOST);
        var username = read(STORAGE_USER);
        var password = read(STORAGE_PASS);
        if (!host || !username || !password) {
            showLogin('');
            return;
        }
        account = { host: host, username: username, password: password };
        $('portal-input').value = host;
        $('user-input').value = username;
        checkAccount(function (ok) {
            if (!ok) {
                account = null;
                loginFailed('A conta salva não entrou. Digite de novo.');
                return;
            }
            openSection('live');
        });
    }

    function init() {
        var screens = document.querySelectorAll('.screen, .stage');
        for (var i = 0; i < screens.length; i++) {
            screens[i].setAttribute('data-base', screens[i].className.replace(' hidden', ''));
        }

        $('login-submit').onclick = submitLogin;
        $('portal-input').onkeydown = function (event) { if (event.keyCode === 13) $('user-input').focus(); };
        $('user-input').onkeydown = function (event) { if (event.keyCode === 13) $('pass-input').focus(); };
        $('pass-input').onkeydown = function (event) { if (event.keyCode === 13) submitLogin(); };
        $('tab-live').onclick = function () { openSection('live'); };
        $('tab-movie').onclick = function () { openSection('movie'); };
        $('tab-series').onclick = function () { openSection('series'); };
        $('logout').onclick = forget;

        document.addEventListener('keydown', onKey, false);

        var tizenKeys = ['Back', 'MediaPlayPause', 'MediaPlay', 'MediaPause', 'MediaStop',
            'MediaFastForward', 'MediaRewind', 'MediaTrackNext', 'MediaTrackPrevious',
            'ChannelUp', 'ChannelDown'];
        if (window.tizen && window.tizen.tvinputdevice) {
            for (var k = 0; k < tizenKeys.length; k++) {
                try { window.tizen.tvinputdevice.registerKey(tizenKeys[k]); } catch (e) { /* older firmware */ }
            }
        }

        document.addEventListener('keydown', function (event) {
            var video = $('player');
            if ($('screen-player').className.indexOf('hidden') !== -1) return;
            if (event.keyCode === 415) {
                try { video.play(); } catch (e) { /* ignore */ }
            }
            if (event.keyCode === 19 || event.keyCode === 413) {
                try { video.pause(); } catch (e) { /* ignore */ }
            }
        }, false);

        boot();
    }

    if (document.readyState === 'complete' || document.readyState === 'interactive') init();
    else document.addEventListener('DOMContentLoaded', init, false);
})();
