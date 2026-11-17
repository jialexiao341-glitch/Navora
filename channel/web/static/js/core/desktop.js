/* Electron desktop shell bridge for the Web Console.
   No-ops completely when running in a standard browser (!window.electronAPI). */
(function initElectronDesktopBridge() {
    const api = typeof window !== 'undefined' ? window.electronAPI : null;
    if (!api) return;

    const root = document.documentElement;
    root.classList.add('electron-desktop');
    root.classList.add(api.platform === 'darwin' ? 'electron-mac' : 'electron-win');

    function setMaximizeIcon(maximized) {
        const icon = document.getElementById('win-ctrl-max-icon');
        if (!icon) return;
        if (maximized) {
            icon.innerHTML =
                '<path d="M3.5 4V2.5a.8.8 0 0 1 .8-.8h5.2a.8.8 0 0 1 .8.8v5.2a.8.8 0 0 1-.8.8H8" stroke="currentColor" stroke-width="1.2" fill="none"/>' +
                '<rect x="1.8" y="4" width="6.2" height="6.2" rx="0.8" stroke="currentColor" stroke-width="1.2" fill="none"/>';
        } else {
            icon.innerHTML =
                '<rect x="2.2" y="2.2" width="7.6" height="7.6" rx="1" stroke="currentColor" stroke-width="1.2" fill="none"/>';
        }
    }

    if (typeof api.windowIsMaximized === 'function') {
        api.windowIsMaximized().then(setMaximizeIcon).catch(function() {});
    }
    if (typeof api.onMaximizeChange === 'function') {
        api.onMaximizeChange(setMaximizeIcon);
    }

    // Keep sidebar version aligned with packaged Electron app version.
    if (typeof api.getAppVersion === 'function') {
        api.getAppVersion().then(function(ver) {
            if (!ver) return;
            const formatted = ver.startsWith('v') ? ver : 'v' + ver;
            if (typeof APP_VERSION !== 'undefined') APP_VERSION = formatted;
            if (typeof _setSidebarVersionLabel === 'function') {
                _setSidebarVersionLabel(formatted);
            }
        }).catch(function() {});
    }

    // Native application menu shortcuts -> console views/actions.
    if (typeof api.onMenuAction === 'function') {
        api.onMenuAction(function(action) {
            if (action === 'new-chat') {
                if (typeof navigateTo === 'function') navigateTo('chat');
                if (typeof newChat === 'function') newChat();
            } else if (action === 'open-settings') {
                if (typeof navigateTo === 'function') navigateTo('config');
            } else if (action === 'view-logs') {
                if (typeof navigateTo === 'function') navigateTo('logs');
            }
        });
    }

    // Notification click -> focus & switch session.
    if (typeof api.onOpenSession === 'function') {
        api.onOpenSession(function(sessionId) {
            if (!sessionId) return;
            if (typeof navigateTo === 'function') navigateTo('chat');
            if (typeof switchSession === 'function') switchSession(sessionId);
        });
    }

    // Launch-at-login toggle in System Config Card (Windows / macOS only).
    (function initLaunchAtLogin() {
        const supports = typeof api.setLoginItemEnabled === 'function'
            && (api.platform === 'win32' || api.platform === 'darwin');
        if (!supports) return;
        const wrap = document.getElementById('cfg-launch-at-login-wrap');
        const input = document.getElementById('cfg-launch-at-login');
        const errEl = document.getElementById('cfg-launch-at-login-error');
        if (!wrap || !input) return;

        wrap.classList.remove('hidden');
        if (typeof api.getLoginItemEnabled === 'function') {
            api.getLoginItemEnabled().then(function(enabled) {
                input.checked = !!enabled;
            }).catch(function() {});
        }

        input.addEventListener('change', function() {
            const next = !!input.checked;
            if (errEl) {
                errEl.textContent = '';
                errEl.classList.add('hidden');
            }
            Promise.resolve(api.setLoginItemEnabled(next)).then(function(res) {
                if (!res) return;
                input.checked = !!res.enabled;
                if (!res.ok && errEl) {
                    const prefix = typeof t === 'function' ? t('config_launch_at_login_error') : 'Failed to change launch at login';
                    const refused = typeof t === 'function' ? t('config_launch_at_login_refused') : 'The system did not accept this change';
                    errEl.textContent = res.error ? (prefix + ': ' + res.error) : refused;
                    errEl.classList.remove('hidden');
                }
            }).catch(function(err) {
                input.checked = !next;
                if (errEl) {
                    const prefix = typeof t === 'function' ? t('config_launch_at_login_error') : 'Failed to change launch at login';
                    errEl.textContent = prefix + ': ' + (err && err.message ? err.message : String(err));
                    errEl.classList.remove('hidden');
                }
            });
        });
    })();

    // Desktop auto-updater UI bridge.
    const updateState = {
        status: null,
        version: '',
        percent: 0,
        dismissedVersion: null,
        bannerOpen: false,
    };

    function _tr(key, fallback) {
        if (typeof t === 'function') {
            const val = t(key);
            if (val && val !== key) return val;
        }
        return fallback;
    }

    function _ensureBanner() {
        let el = document.getElementById('desktop-update-banner');
        if (el) return el;
        el = document.createElement('div');
        el.id = 'desktop-update-banner';
        el.className = 'desktop-update-banner hidden';
        el.innerHTML =
            '<div class="flex items-center justify-between gap-2 mb-2">' +
                '<span id="dub-title" class="text-xs font-semibold truncate"></span>' +
                '<button type="button" id="dub-close" class="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer p-0.5">' +
                    '<i class="fas fa-xmark text-xs"></i>' +
                '</button>' +
            '</div>' +
            '<div id="dub-body" class="space-y-2"></div>';
        document.body.appendChild(el);
        document.getElementById('dub-close').addEventListener('click', function() {
            updateState.dismissedVersion = updateState.version || updateState.dismissedVersion;
            updateState.bannerOpen = false;
            _renderBanner();
        });
        return el;
    }

    function _startDownload() {
        const lang = typeof currentLang !== 'undefined' ? currentLang : 'zh';
        if (typeof _updateRunning !== 'undefined') _updateRunning = true;
        if (typeof _renderUpdateAction === 'function') {
            _renderUpdateAction('updating', _tr('update_downloading', 'Downloading…'), { disabled: true });
        }
        updateState.bannerOpen = true;
        updateState.status = { state: 'downloading', percent: 0 };
        _renderBanner();
        if (typeof api.downloadUpdate === 'function') {
            Promise.resolve(api.downloadUpdate(lang)).catch(function() {});
        }
    }

    function _installNow() {
        if (typeof api.installUpdate === 'function') {
            void api.installUpdate();
        }
    }

    function _renderBanner() {
        const banner = _ensureBanner();
        const st = updateState.status;
        if (!updateState.bannerOpen || !st) {
            banner.classList.add('hidden');
            return;
        }
        const titleEl = document.getElementById('dub-title');
        const bodyEl = document.getElementById('dub-body');
        if (!titleEl || !bodyEl) return;

        bodyEl.innerHTML = '';

        if (st.state === 'error') {
            titleEl.textContent = _tr('update_failed', 'Update failed');
            const msg = document.createElement('p');
            msg.className = 'text-xs text-slate-500 dark:text-slate-400 break-words';
            const rawMsg = st.message || '';
            msg.textContent = /No published versions on GitHub/i.test(rawMsg)
                ? _tr('update_no_releases', 'No releases published on GitHub yet')
                : (rawMsg || _tr('update_error', 'Could not check for updates'));
            const retryBtn = document.createElement('button');
            retryBtn.type = 'button';
            retryBtn.className = 'w-full py-1.5 px-3 rounded-lg bg-primary-500 hover:bg-primary-600 text-white text-xs font-medium cursor-pointer transition-colors';
            retryBtn.textContent = _tr('update_retry', 'Retry');
            retryBtn.addEventListener('click', function() {
                if (typeof checkForConsoleUpdate === 'function') checkForConsoleUpdate();
            });
            bodyEl.appendChild(msg);
            bodyEl.appendChild(retryBtn);
            banner.classList.remove('hidden');
            return;
        }

        if (st.state === 'downloading') {
            const pct = Math.max(0, Math.min(100, Math.round(st.percent || 0)));
            titleEl.textContent = _tr('update_available', 'Update available');
            const label = document.createElement('p');
            label.className = 'text-xs text-slate-500 dark:text-slate-400';
            label.textContent = _tr('update_downloading', 'Downloading…') + ' ' + pct + '%';
            const track = document.createElement('div');
            track.className = 'desktop-update-bar-track';
            const fill = document.createElement('div');
            fill.className = 'desktop-update-bar-fill';
            fill.style.width = pct + '%';
            track.appendChild(fill);
            bodyEl.appendChild(label);
            bodyEl.appendChild(track);
            banner.classList.remove('hidden');
            return;
        }

        if (st.state === 'downloaded') {
            titleEl.textContent = _tr('update_available', 'Update available');
            const ver = document.createElement('p');
            ver.className = 'text-xs text-slate-500 dark:text-slate-400';
            ver.textContent = updateState.version ? 'v' + updateState.version : '';
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'w-full py-1.5 px-3 rounded-lg bg-primary-500 hover:bg-primary-600 text-white text-xs font-medium cursor-pointer transition-colors';
            btn.textContent = _tr('update_restart', 'Restart to install');
            btn.addEventListener('click', _installNow);
            if (ver.textContent) bodyEl.appendChild(ver);
            bodyEl.appendChild(btn);
            banner.classList.remove('hidden');
            return;
        }

        if (st.state === 'available') {
            titleEl.textContent = _tr('update_available', 'Update available');
            if (updateState.version) {
                const ver = document.createElement('p');
                ver.className = 'text-xs text-slate-500 dark:text-slate-400';
                ver.textContent = 'v' + updateState.version;
                bodyEl.appendChild(ver);
            }
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'w-full py-1.5 px-3 rounded-lg bg-primary-500 hover:bg-primary-600 text-white text-xs font-medium cursor-pointer transition-colors';
            btn.textContent = _tr('update_download', 'Download update');
            btn.addEventListener('click', _startDownload);
            bodyEl.appendChild(btn);
            banner.classList.remove('hidden');
            return;
        }

        banner.classList.add('hidden');
    }

    window.desktopTriggerUpdateAction = function() {
        const st = updateState.status;
        if (st && st.state === 'downloaded') {
            _installNow();
        } else if (st && st.state === 'available') {
            _startDownload();
        } else if (typeof checkForConsoleUpdate === 'function') {
            checkForConsoleUpdate();
        }
    };

    if (typeof api.onUpdateStatus === 'function') {
        api.onUpdateStatus(function(st) {
            if (!st || !st.state) return;
            updateState.status = st;

            if (st.state === 'checking') {
                if (typeof _updateChecking !== 'undefined') _updateChecking = true;
                if (typeof _renderUpdateAction === 'function') {
                    _renderUpdateAction('checking', _tr('update_checking', 'Checking…'), { disabled: true });
                }
                return;
            }

            if (st.state === 'not-available') {
                if (typeof _updateChecking !== 'undefined') _updateChecking = false;
                if (typeof _updateRunning !== 'undefined') _updateRunning = false;
                updateState.bannerOpen = false;
                _renderBanner();
                if (typeof _renderUpdateAction === 'function') {
                    _renderUpdateAction('up_to_date', _tr('update_up_to_date', 'You are up to date'));
                }
                return;
            }

            if (st.state === 'available') {
                if (typeof _updateChecking !== 'undefined') _updateChecking = false;
                updateState.version = st.version || '';
                const alreadyDismissed = updateState.dismissedVersion && updateState.dismissedVersion === updateState.version;
                updateState.bannerOpen = st.userInitiated === true || !alreadyDismissed;
                _renderBanner();
                if (typeof _renderUpdateAction === 'function') {
                    _renderUpdateAction('available', _tr('update_now', 'Update now'));
                }
                return;
            }

            if (st.state === 'downloading') {
                if (typeof _updateChecking !== 'undefined') _updateChecking = false;
                if (typeof _updateRunning !== 'undefined') _updateRunning = true;
                updateState.percent = Math.round(st.percent || 0);
                updateState.bannerOpen = true;
                _renderBanner();
                if (typeof _renderUpdateAction === 'function') {
                    _renderUpdateAction('updating', _tr('update_downloading', 'Downloading…') + ' ' + updateState.percent + '%', { disabled: true });
                }
                return;
            }

            if (st.state === 'downloaded') {
                if (typeof _updateChecking !== 'undefined') _updateChecking = false;
                if (typeof _updateRunning !== 'undefined') _updateRunning = false;
                updateState.version = st.version || updateState.version;
                updateState.bannerOpen = true;
                _renderBanner();
                if (typeof _renderUpdateAction === 'function') {
                    _renderUpdateAction('available', _tr('update_restart', 'Restart to install'));
                }
                return;
            }

            if (st.state === 'error') {
                const wasRunning = typeof _updateRunning !== 'undefined' && _updateRunning;
                if (typeof _updateChecking !== 'undefined') _updateChecking = false;
                if (typeof _updateRunning !== 'undefined') _updateRunning = false;
                // Only surface errors that came from an explicit user action or
                // an in-progress download; silent background checks (e.g. offline
                // or before the first GitHub Release exists) should not pop up.
                const shouldShow = st.userInitiated === true || wasRunning || updateState.bannerOpen;
                updateState.bannerOpen = shouldShow;
                _renderBanner();
                if (shouldShow && typeof _renderUpdateAction === 'function') {
                    const rawMsg = st.message || '';
                    const friendly = /No published versions on GitHub/i.test(rawMsg)
                        ? _tr('update_no_releases', 'No releases published on GitHub yet')
                        : (rawMsg || _tr('update_error', 'Could not check for updates'));
                    _renderUpdateAction('failed', friendly);
                } else if (!shouldShow && typeof _renderUpdateAction === 'function') {
                    _renderUpdateAction('idle', _tr('update_check', 'Check for update'));
                }
            }
        });
    }
})();
