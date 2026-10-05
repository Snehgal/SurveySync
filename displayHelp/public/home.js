(() => {
    'use strict';
    const list = document.querySelector('.lab-list');
    let updating = false;

    function render(labs) {
        const ids = new Set(labs.map(lab => lab.labID));
        const links = new Map([...list.querySelectorAll('.lab-link[data-lab-id]')]
            .map(link => [link.dataset.labId, link]));
        for (const [id, link] of links) if (!ids.has(id)) link.remove();

        if (labs.length) list.querySelector('.empty-state')?.remove();
        labs.forEach((lab, index) => {
            let link = links.get(lab.labID);
            if (!link) {
                link = document.createElement('a');
                link.className = 'lab-link';
                link.dataset.labId = lab.labID;
                const card = document.createElement('div');
                card.className = 'lab';
                const heading = document.createElement('div');
                heading.append(document.createElement('h2'));
                const arrow = document.createElement('span');
                arrow.className = 'expand-icon';
                arrow.textContent = '\u2192';
                card.append(heading, arrow);
                link.append(card);
            }
            const href = '/lab/' + encodeURIComponent(lab.labID) + '/map';
            if (link.getAttribute('href') !== href) link.setAttribute('href', href);
            const title = link.querySelector('h2');
            if (title.textContent !== lab.labNumber) title.textContent = lab.labNumber;
            if (list.children[index] !== link) list.insertBefore(link, list.children[index] || null);
        });

        if (!labs.length && !list.querySelector('.empty-state')) {
            const empty = document.createElement('div');
            empty.className = 'empty-state';
            const title = document.createElement('span');
            title.textContent = 'All clear';
            const description = document.createElement('p');
            description.textContent = 'There are no ongoing labs right now.';
            empty.append(title, description);
            list.append(empty);
        }
    }

    async function refresh() {
        if (updating || document.hidden) return;
        updating = true;
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000);
        try {
            const response = await fetch('/?format=json', { cache: 'no-store', signal: controller.signal });
            if (response.status === 401 || (response.redirected && new URL(response.url).pathname === '/login')) {
                location.replace('/login');
                return;
            }
            if (!response.ok) throw new Error('Unable to update ongoing labs.');
            const data = await response.json();
            if (!Array.isArray(data.labs)) throw new Error('Invalid lab list.');
            render(data.labs);
        } catch (error) {
            console.warn('Ongoing labs update failed:', error.message);
        } finally {
            clearTimeout(timeout);
            updating = false;
        }
    }

    setInterval(refresh, 5000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
    window.addEventListener('pageshow', event => { if (event.persisted) refresh(); });
})();
