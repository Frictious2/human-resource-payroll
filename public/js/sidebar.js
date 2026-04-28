(function () {
    if (window.__hrPayrollSidebarScriptLoaded) {
        return;
    }
    window.__hrPayrollSidebarScriptLoaded = true;

    function normalizePath(value) {
        if (!value) {
            return '/';
        }

        try {
            const url = new URL(value, window.location.origin);
            let pathname = url.pathname || '/';
            if (pathname.length > 1) {
                pathname = pathname.replace(/\/+$/, '');
            }
            return pathname || '/';
        } catch (error) {
            return value;
        }
    }

    function markActiveLinks() {
        const currentPath = normalizePath(window.location.pathname);
        const links = Array.from(document.querySelectorAll('.sidebar .nav-link[href]'));
        let activeLink = null;
        let bestScore = -1;

        for (const link of links) {
            const href = link.getAttribute('href');
            if (!href || href === '#') {
                continue;
            }

            const linkPath = normalizePath(href);
            const exactMatch = linkPath === currentPath;
            const sectionMatch = linkPath !== '/' && currentPath.startsWith(linkPath + '/');

            if (!exactMatch && !sectionMatch) {
                continue;
            }

            const score = linkPath.length;
            if (score > bestScore) {
                bestScore = score;
                activeLink = link;
            }
        }

        if (!activeLink) {
            return;
        }

        activeLink.classList.add('active');
        activeLink.setAttribute('aria-current', 'page');

        const collapse = activeLink.closest('.collapse');
        if (!collapse) {
            return;
        }

        collapse.classList.add('show');
        const collapseId = collapse.getAttribute('id');
        if (!collapseId) {
            return;
        }

        const toggle = document.querySelector(`.sidebar [data-bs-target="#${collapseId}"]`);
        if (toggle) {
            toggle.classList.add('active');
            toggle.setAttribute('aria-expanded', 'true');
        }
    }

    function bindFallbackCollapse() {
        if (window.__hrPayrollSidebarFallbackBound) {
            return;
        }
        window.__hrPayrollSidebarFallbackBound = true;

        document.querySelectorAll('.sidebar [data-bs-toggle="collapse"]').forEach((toggle) => {
            toggle.addEventListener('click', (event) => {
                if (window.bootstrap && window.bootstrap.Collapse) {
                    return;
                }

                event.preventDefault();
                const targetSelector = toggle.getAttribute('data-bs-target');
                if (!targetSelector) {
                    return;
                }

                const target = document.querySelector(targetSelector);
                if (!target) {
                    return;
                }

                const shouldOpen = !target.classList.contains('show');
                target.classList.toggle('show', shouldOpen);
                toggle.setAttribute('aria-expanded', shouldOpen ? 'true' : 'false');
            });
        });
    }

    function ensureBootstrapBundle() {
        if (window.bootstrap && window.bootstrap.Collapse) {
            return Promise.resolve();
        }

        const existingLoader = document.querySelector('script[data-sidebar-bootstrap-loader="true"]');
        if (existingLoader) {
            return new Promise((resolve) => {
                existingLoader.addEventListener('load', resolve, { once: true });
                existingLoader.addEventListener('error', resolve, { once: true });
            });
        }

        return new Promise((resolve) => {
            const script = document.createElement('script');
            script.src = '/vendor/bootstrap.bundle.min.js';
            script.defer = true;
            script.dataset.sidebarBootstrapLoader = 'true';
            script.addEventListener('load', resolve, { once: true });
            script.addEventListener('error', resolve, { once: true });
            document.head.appendChild(script);
        });
    }

    function initSidebar() {
        markActiveLinks();
        bindFallbackCollapse();
    }

    document.addEventListener('DOMContentLoaded', function () {
        ensureBootstrapBundle().finally(initSidebar);
    });
})();
