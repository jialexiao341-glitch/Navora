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
            } else if (action === 'open-chat') {
                if (typeof navigateTo === 'function') navigateTo('chat');
                const input = document.getElementById('chat-input');
                if (input && typeof input.focus === 'function') input.focus();
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
        notes: '',
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

    function _detectPendingWork() {
        const sendBtn = typeof document.getElementById === 'function' ? document.getElementById('send-btn') : null;
        if (sendBtn && sendBtn.classList && typeof sendBtn.classList.contains === 'function' && sendBtn.classList.contains('send-btn-cancel')) {
            return 'busy';
        }
        const chatInput = typeof document.getElementById === 'function' ? document.getElementById('chat-input') : null;
        if (chatInput && typeof chatInput.value === 'string' && chatInput.value.trim()) {
            return 'draft';
        }
        return '';
    }

    function _installNow() {
        if (typeof api.installUpdate !== 'function') return;
        const pending = _detectPendingWork();
        const proceed = function() { void api.installUpdate(); };
        if (!pending) {
            proceed();
            return;
        }
        const title = _tr('update_confirm_title', 'Restart to install update');
        const message = pending === 'busy'
            ? _tr('update_confirm_busy', 'A task is currently running. Restarting now to install the update will interrupt it. Continue?')
            : _tr('update_confirm_draft', 'You have an unsent draft in the input box. Restarting now will discard it. Continue?');
        if (typeof showConfirmDialog === 'function') {
            showConfirmDialog({
                title: title,
                message: message,
                okText: _tr('update_install_now', 'Install now'),
                cancelText: _tr('update_later', 'Later'),
                tone: 'primary',
                onConfirm: proceed,
            });
            return;
        }
        if (typeof window.confirm !== 'function' || window.confirm(message)) {
            proceed();
        }
    }

    function _formatNotesPreview(rawNotes) {
        const text = String(rawNotes || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        if (!text) return '';
        return text.length > 160 ? text.slice(0, 159).trimEnd() + '…' : text;
    }

    function _appendNotesBlock(bodyEl) {
        const summary = _formatNotesPreview(updateState.notes);
        if (!summary) return;
        const notesEl = document.createElement('p');
        notesEl.className = 'text-[11px] text-slate-500 dark:text-slate-400 leading-snug break-words line-clamp-3';
        notesEl.textContent = summary;
        bodyEl.appendChild(notesEl);
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
            const actions = document.createElement('div');
            actions.className = 'flex items-center gap-2';
            if (typeof api.openUpdaterLog === 'function') {
                const logBtn = document.createElement('button');
                logBtn.type = 'button';
                logBtn.className = 'flex-1 py-1 px-2 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 text-[11px] font-medium cursor-pointer transition-colors';
                logBtn.textContent = _tr('update_open_log', 'View log');
                logBtn.addEventListener('click', function() {
                    void api.openUpdaterLog();
                });
                actions.appendChild(logBtn);
            }
            const manualBtn = document.createElement('button');
            manualBtn.type = 'button';
            manualBtn.className = 'flex-1 py-1 px-2 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 text-[11px] font-medium cursor-pointer transition-colors';
            manualBtn.textContent = _tr('update_manual_download', 'Manual download');
            manualBtn.addEventListener('click', function() {
                const url = typeof GITHUB_RELEASES_URL !== 'undefined'
                    ? GITHUB_RELEASES_URL
                    : 'https://github.com/jialexiao341-glitch/Navora/releases';
                if (typeof window.open === 'function') window.open(url, '_blank', 'noopener,noreferrer');
            });
            actions.appendChild(manualBtn);
            bodyEl.appendChild(msg);
            bodyEl.appendChild(retryBtn);
            bodyEl.appendChild(actions);
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
            _appendNotesBlock(bodyEl);
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
            _appendNotesBlock(bodyEl);
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
                updateState.notes = st.notes || '';
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
                if (st.notes) updateState.notes = st.notes;
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

    // Desktop floating pet overlay <-> main console bridge (only in main console window).
    const isPetOverlay = root.classList && typeof root.classList.contains === 'function' && root.classList.contains('pet-window-mode');
    if (!isPetOverlay && typeof document.addEventListener === 'function') {
        const pushWindowTheme = function() {
            if (typeof api.setWindowTheme !== 'function' || !root.classList || typeof root.classList.contains !== 'function') return;
            const saved = typeof localStorage !== 'undefined' ? localStorage.getItem('cow_theme') : '';
            const pref = saved === 'dark' || saved === 'light'
                ? saved
                : (root.classList.contains('dark') ? 'dark' : 'light');
            void api.setWindowTheme(pref);
        };
        pushWindowTheme();

        if (typeof api.petSyncToOverlay === 'function' || typeof api.setWindowTheme === 'function') {
            if (typeof api.petSyncToOverlay === 'function') {
                ['navora:companion-phase', 'navora:reply-complete', 'navora:focus-state', 'navora:ambient-audio'].forEach(function(type) {
                    document.addEventListener(type, function(e) {
                        api.petSyncToOverlay({ type: type, detail: e && e.detail ? e.detail : {} });
                    });
                });
            }
            if (typeof MutationObserver === 'function') {
                const syncThemeLang = function() {
                    pushWindowTheme();
                    if (typeof api.petSyncToOverlay === 'function') {
                        api.petSyncToOverlay({
                            type: 'appearance',
                            detail: {
                                dark: root.classList.contains('dark'),
                                lang: typeof currentLang !== 'undefined' ? currentLang : (root.getAttribute('lang') || ''),
                            },
                        });
                    }
                };
                new MutationObserver(syncThemeLang).observe(root, {
                    attributes: true,
                    attributeFilter: ['class', 'style', 'lang'],
                });
                const sendBtn = document.getElementById('send-btn');
                if (sendBtn && typeof api.petSyncToOverlay === 'function') {
                    let lastBusy = sendBtn.classList.contains('send-btn-cancel');
                    new MutationObserver(function() {
                        const busy = sendBtn.classList.contains('send-btn-cancel');
                        if (busy === lastBusy) return;
                        lastBusy = busy;
                        api.petSyncToOverlay({ type: 'working-state', detail: { working: busy } });
                    }).observe(sendBtn, { attributes: true, attributeFilter: ['class'] });
                }
            }
        }

        if (typeof api.onPetQuickMessage === 'function') {
            api.onPetQuickMessage(function(text) {
                if (!text || typeof sendMessage !== 'function') return;
                const mainInput = document.getElementById('chat-input');
                if (!mainInput) return;
                const savedDraft = mainInput.value;
                mainInput.value = text;
                sendMessage();
                if (savedDraft) {
                    mainInput.value = savedDraft;
                    if (typeof Event === 'function' && typeof mainInput.dispatchEvent === 'function') {
                        mainInput.dispatchEvent(new Event('input', { bubbles: true }));
                    }
                }
            });
        }

        if (typeof api.onPetConfigChanged === 'function') {
            api.onPetConfigChanged(function(patch) {
                if (typeof CustomEvent === 'function' && typeof document.dispatchEvent === 'function') {
                    document.dispatchEvent(new CustomEvent('navora:pet-config-sync', { detail: patch || {} }));
                }
            });
        }
    }
})();
