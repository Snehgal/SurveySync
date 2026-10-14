(() => {
    'use strict';
    const section = document.getElementById('responses-section');
    const labSelect = document.getElementById('response-lab');
    const modeSelect = document.getElementById('response-mode');
    const refreshButton = document.getElementById('response-refresh');
    const errorBox = document.getElementById('response-error');
    let visible = false, loaded = false, loading = false, stream = null, state = null, generation = 0, pending = null;
    const showError = message => { errorBox.textContent = message; errorBox.hidden = !message; };
    async function request(url, signal) {
        const response = await fetch(url, { cache: 'no-store', signal });
        if (response.status === 401 || (response.redirected && new URL(response.url).pathname === '/login')) {
            location.replace('/login'); throw new Error('Please sign in again.');
        }
        if (!response.ok) throw new Error('Unable to load response details.');
        return response.json();
    }
    function render() {
        for (const answer of ['yes', 'no']) {
            const tables = state?.responseDetails[modeSelect.value][answer] || [];
            const container = document.getElementById('response-' + answer + '-tables');
            document.getElementById('response-' + answer + '-count').textContent = tables.length;
            const key = modeSelect.value + ':' + tables.join(',');
            if (state && container.dataset.tables === key) continue;
            container.dataset.tables = state ? key : '';
            if (!tables.length) {
                container.textContent = state ? 'No tables yet.' : labSelect.value ? 'Loading responses...' : 'Select a lab session.';
            } else {
                container.replaceChildren(...tables.map(id => {
                    const item = document.createElement('span'); item.className = 'response-table';
                    item.textContent = 'Table ' + id; return item;
                }));
            }
        }
        document.getElementById('response-session-state').textContent = state && !state.active ? 'Session closed' : '';
        modeSelect.disabled = !state;
    }
    function accept(data, version) {
        if (version !== generation || data.labID !== labSelect.value || (state && data.serverNow < state.serverNow)) return;
        if (!state) modeSelect.value = data.mode;
        state = data; render(); showError('');
    }
    function stop() {
        generation++; stream?.close(); stream = null;
        pending?.abort(); pending = null;
    }
    async function refreshState() {
        if (!visible || document.hidden || !labSelect.value || pending) return;
        const version = generation, controller = new AbortController();
        pending = controller;
        const timeout = setTimeout(() => controller.abort(), 10000);
        try { accept(await request('/response-api/labs/' + encodeURIComponent(labSelect.value) + '/state', controller.signal), version); }
        catch (error) { if (version === generation) showError(error.message); }
        finally { clearTimeout(timeout); if (pending === controller) pending = null; }
    }
    function start() {
        if (!visible || document.hidden || !labSelect.value || stream) return;
        const version = generation;
        stream = new EventSource('/response-api/labs/' + encodeURIComponent(labSelect.value) + '/events');
        stream.onmessage = event => {
            try { accept(JSON.parse(event.data), version); }
            catch { if (version === generation) showError('Unable to read response details.'); }
        };
        stream.onerror = () => { if (version === generation) { showError('Connection interrupted. Retrying...'); refreshState(); } };
        stream.addEventListener('failure', event => {
            if (version === generation) {
                try { showError(JSON.parse(event.data).message); } catch { showError('Unable to load this lab.'); }
            }
        });
    }
    async function loadLabs() {
        if (loading) return;
        loading = true; refreshButton.disabled = true;
        const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 10000);
        try {
            const records = await request('/get-records', controller.signal);
            const selected = labSelect.value;
            const now = Date.now() + 330 * 60000;
            const ongoing = lab => new Date(lab.startTime).getTime() <= now && now < new Date(lab.endTime).getTime();
            records.sort((a, b) => Number(ongoing(b)) - Number(ongoing(a)) || new Date(b.startTime) - new Date(a.startTime));
            const unique = [...new Map(records.map(lab => [lab.labID, lab])).values()];
            const placeholder = document.createElement('option'); placeholder.value = ''; placeholder.textContent = unique.length ? 'Select a lab' : 'No lab sessions';
            labSelect.replaceChildren(placeholder, ...unique.map(lab => {
                const option = document.createElement('option'); option.value = lab.labID;
                option.textContent = lab.labNo + ' · ' + lab.labID; return option;
            }));
            labSelect.disabled = !unique.length;
            labSelect.value = unique.some(lab => lab.labID === selected) ? selected : unique[0]?.labID || '';
            if (selected !== labSelect.value) { stop(); state = null; }
            loaded = true; render(); showError(''); start();
        } catch (error) { showError(error.message); }
        finally { clearTimeout(timeout); loading = false; refreshButton.disabled = false; }
    }
    labSelect.addEventListener('change', () => { stop(); state = null; render(); start(); });
    modeSelect.addEventListener('change', render);
    refreshButton.addEventListener('click', loadLabs);
    new IntersectionObserver(entries => {
        visible = entries[0].isIntersecting;
        if (visible && !document.hidden) { if (loaded) start(); else loadLabs(); }
        else stop();
    }).observe(section);
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) stop();
        else if (visible) { if (loaded) start(); else loadLabs(); }
    });
    setInterval(() => { if (stream && stream.readyState !== EventSource.OPEN) refreshState(); }, 5000);
    window.addEventListener('pagehide', stop);
    window.addEventListener('pageshow', event => { if (event.persisted) start(); });
})();
