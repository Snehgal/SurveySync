(() => {
    'use strict';
    const labID = document.body.dataset.labId;
    const base = '/api/labs/' + encodeURIComponent(labID);
    const byId = id => document.getElementById(id);
    let current = null, clockOffset = 0, selectedTable = null, previousFocus = null, busy = false, online = false;
    const message = text => { byId('live-message').textContent = text; byId('live-message').hidden = !text; };
    async function request(path, body) {
        const response = await fetch(base + path, body === undefined ? { cache: 'no-store' } : {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
        });
        if (response.status === 401) { location.replace('/login'); throw new Error('Please sign in again.'); }
        const data = await response.json();
        if (!response.ok) throw new Error(data.message || 'Unable to complete this action.');
        return data;
    }
    function setConnection(connected) {
        online = connected;
        controls();
    }
    function controls() {
        for (const id of ['quiz-mode', 'feedback-mode', 'reset-quiz']) byId(id).disabled = busy || !online || !current?.active;
        byId('issue-form').querySelector('[type="submit"]').disabled = busy || !online || !current?.active;
    }
    function render(data) {
        if (current && data.serverNow < current.serverNow) return;
        current = data;
        clockOffset = data.serverNow - Date.now();
        const feedback = data.mode === 'feedback';
        document.body.classList.toggle('feedback-mode', feedback);
        byId('quiz-mode').setAttribute('aria-pressed', String(!feedback));
        byId('feedback-mode').setAttribute('aria-pressed', String(feedback));
        byId('mode-title').textContent = data.active ? (feedback ? 'Feedback mode' : 'Quiz mode') : 'Session closed';
        byId('reset-quiz').hidden = feedback;
        byId('feedback-timer').hidden = !feedback;
        const votes = feedback ? data.feedback : data.quiz;
        byId('response-total').textContent = votes.total;
        byId('yes-count').textContent = votes.yes;
        byId('no-count').textContent = votes.no;
        const yes = votes.total ? votes.yes / votes.total * 100 : 0;
        const no = votes.total ? 100 - yes : 0;
        byId('yes-bar').style.width = yes + '%';
        byId('no-bar').style.width = no + '%';
        byId('yes-percentage').textContent = votes.total ? Math.round(yes) + '%' : '-';
        const circumference = 2 * Math.PI * 48;
        byId('donut-yes').style.strokeDasharray = `${circumference * yes / 100} ${circumference}`;
        byId('donut-no').style.opacity = votes.total ? '1' : '0';
        document.querySelector('.vote-donut').setAttribute('aria-label', `${votes.yes} Yes, ${votes.no} No, ${votes.total} tables responded`);
        renderSeats();
        tick();
        controls();
        if (selectedTable !== null && (!data.active || !data.helps.some(h => h.tableID === selectedTable))) {
            closeIssue(); message('This help request is no longer active.');
        }
    }
    function renderSeats() {
        if (!current) return;
        const helps = new Map(current.helps.map(h => [h.tableID, h]));
        const unresolved = new Map(current.unresolved.map(h => [h.tableID, h]));
        document.querySelectorAll('.seat[data-table-id]').forEach(seat => {
            const id = Number(seat.dataset.tableId), help = helps.get(id), issue = unresolved.get(id);
            const status = issue ? 'unresolved' : help ? 'help' : 'idle';
            seat.classList.remove('idle', 'help', 'unresolved', 'help-medium', 'help-high');
            seat.classList.add(status);
            seat.dataset.startedAt = help && !issue ? help.startedAt : '';
            seat.tabIndex = status === 'help' && current.active ? 0 : -1;
            if (status === 'help') seat.setAttribute('role', 'button'); else seat.removeAttribute('role');
            seat.title = `Table ${id}` + (issue ? ` - ${issue.issue}${issue.remarks ? ': ' + issue.remarks : ''} · Frozen for this session` : help ? ' - Needs help' : ' - Idle');
            let sub = seat.querySelector('.seat-sub');
            if (!sub) { sub = document.createElement('span'); sub.className = 'seat-sub'; seat.append(sub); }
            sub.textContent = issue ? issue.issue : help ? 'Needs help' : '';
            sub.hidden = !issue && !help;
        });
        const stats = document.querySelectorAll('.stats-bar .stat');
        if (stats.length) { stats[0].textContent = 'Active helps: ' + helps.size; stats[1].textContent = 'Unresolved: ' + unresolved.size; }
        if (document.body.dataset.view === 'list') {
            byId('list-help-count').textContent = helps.size;
            byId('list-unresolved-count').textContent = unresolved.size;
            byId('list-helps').replaceChildren(...current.helps.map(h => {
                const button = document.createElement('button'); button.className = 'chip'; button.type = 'button';
                button.dataset.tableId = h.tableID; button.dataset.startedAt = h.startedAt;
                button.textContent = `Table ${h.tableID} · Needs help`; return button;
            }));
            byId('list-unresolved').replaceChildren(...current.unresolved.map(h => {
                const item = document.createElement('div'); item.className = 'unresolved-detail';
                const title = document.createElement('strong'); title.textContent = `Table ${h.tableID} · ${h.issue}`;
                const remarks = document.createElement('p'); remarks.textContent = h.remarks || 'No remarks'; item.append(title, remarks); return item;
            }));
            if (!helps.size) byId('list-helps').textContent = 'No active help requests.';
            if (!unresolved.size) byId('list-unresolved').textContent = 'No unresolved issues.';
        }
    }
    function tick() {
        if (!current) return;
        const now = Date.now() + clockOffset;
        document.querySelectorAll('[data-started-at]').forEach(seat => {
            if (!seat.dataset.startedAt) return;
            const elapsed = Math.max(0, now - Number(seat.dataset.startedAt));
            seat.classList.toggle('help-medium', elapsed >= 7 * 60000 && elapsed <= 15 * 60000);
            seat.classList.toggle('help-high', elapsed > 15 * 60000);
            const label = `${Math.floor(elapsed / 60000)}:${String(Math.floor(elapsed / 1000) % 60).padStart(2, '0')}`;
            const sub = seat.querySelector('.seat-sub');
            if (sub) sub.textContent = label;
            else if (seat.classList.contains('chip')) seat.textContent = `Table ${seat.dataset.tableId} · ${label}`;
        });
        if (current.mode === 'feedback') {
            const seconds = Math.max(0, Math.ceil((current.feedbackEndsAt - now) / 1000));
            byId('feedback-timer').textContent = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')} remaining`;
            // The server decides expiry; the browser never starts another window on refresh.
        }
    }
    async function command(path, body) {
        busy = true; controls(); message('');
        try { render(await request(path, body)); }
        catch (error) { message(error.message); }
        finally { busy = false; controls(); }
    }
    byId('quiz-mode').addEventListener('click', () => command('/mode', { mode: 'quiz' }));
    byId('feedback-mode').addEventListener('click', () => command('/mode', { mode: 'feedback' }));
    byId('reset-quiz').addEventListener('click', () => command('/reset', {}));
    function openIssue(id, target) {
        if (!online || !current?.active || !current.helps.some(h => h.tableID === id)) return;
        selectedTable = id; previousFocus = target;
        byId('issue-form').reset(); byId('issue-remarks').required = false;
        byId('remarks-requirement').textContent = 'optional for Faulty Equipment';
        byId('issue-error').textContent = '';
        byId('issuePanelTable').textContent = String(id).slice(-2);
        byId('overlay').classList.add('active'); byId('issuePanel').classList.add('active');
        byId('issuePanel').focus();
    }
    function closeIssue() {
        byId('overlay').classList.remove('active'); byId('issuePanel').classList.remove('active');
        selectedTable = null; previousFocus?.focus();
    }
    document.addEventListener('click', event => {
        const target = event.target.closest('[data-table-id]');
        if (target) openIssue(Number(target.dataset.tableId), target);
    });
    document.addEventListener('keydown', event => {
        if (selectedTable !== null) {
            if (event.key === 'Escape' && !busy) closeIssue();
            if (event.key === 'Tab') {
                const items = [...byId('issuePanel').querySelectorAll('input, textarea, button')].filter(e => !e.disabled);
                const first = items[0], last = items[items.length - 1];
                if (event.shiftKey && (document.activeElement === first || document.activeElement === byId('issuePanel'))) { event.preventDefault(); last.focus(); }
                else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
            }
        } else if (['Enter', ' '].includes(event.key) && event.target.matches('.seat.help')) {
            event.preventDefault(); openIssue(Number(event.target.dataset.tableId), event.target);
        }
    });
    byId('overlay').addEventListener('click', () => { if (!busy) closeIssue(); });
    byId('cancel-issue').addEventListener('click', () => { if (!busy) closeIssue(); });
    byId('issue-form').addEventListener('change', () => {
        const required = byId('issue-form').elements.issue.value === 'Others';
        byId('issue-remarks').required = required;
        byId('remarks-requirement').textContent = required ? 'required' : 'optional';
    });
    byId('issue-form').addEventListener('submit', async event => {
        event.preventDefault();
        if (selectedTable === null || busy) return;
        busy = true; controls(); byId('issue-error').textContent = '';
        try {
            const data = await request('/issue', { tableID: selectedTable, issue: event.target.elements.issue.value, remarks: byId('issue-remarks').value });
            closeIssue(); render(data); message('Issue saved. This table is frozen until the session ends.');
        } catch (error) { byId('issue-error').textContent = error.message; }
        finally { busy = false; controls(); }
    });
    document.querySelector('[data-logout]').addEventListener('click', async () => {
        try { const response = await fetch('/logout', { method: 'POST' }); if (!response.ok) throw new Error('Sign out failed.'); location.replace('/login'); }
        catch (error) { message(error.message); }
    });
    const stream = new EventSource(base + '/events');
    stream.onmessage = event => { render(JSON.parse(event.data)); setConnection(true); };
    stream.onerror = () => { setConnection(false); refresh(); };
    stream.addEventListener('failure', event => { setConnection(false); message(JSON.parse(event.data).message); });
    async function refresh() {
        try { render(await request('/state')); setConnection(true); }
        catch (error) { setConnection(false); message(error.message); }
    }
    setInterval(() => { if (stream.readyState !== EventSource.OPEN) refresh(); }, 5000);
    setInterval(tick, 1000);
    window.addEventListener('pageshow', event => { if (event.persisted) location.reload(); });
})();
