(function () {
    function initializeReportViewer(options) {
        const config = Object.assign({
            containerSelector: '[data-report-viewer]',
            pageSelector: '[data-report-page]',
            prevSelector: '[data-report-prev]',
            nextSelector: '[data-report-next]',
            indicatorSelector: '[data-report-indicator]',
            detailSelector: '[data-report-detail]'
        }, options || {});

        const container = document.querySelector(config.containerSelector);
        if (!container) {
            return null;
        }

        const pages = Array.from(container.querySelectorAll(config.pageSelector));
        const previousButton = document.querySelector(config.prevSelector);
        const nextButton = document.querySelector(config.nextSelector);
        const indicator = document.querySelector(config.indicatorSelector);
        const detail = document.querySelector(config.detailSelector);
        let currentIndex = Math.max(0, Math.min(Number(config.initialPageIndex) || 0, pages.length - 1));

        function updateControls() {
            const totalPages = pages.length;
            const currentPage = pages[currentIndex];

            if (previousButton) {
                previousButton.disabled = currentIndex <= 0 || totalPages <= 1;
            }

            if (nextButton) {
                nextButton.disabled = currentIndex >= totalPages - 1 || totalPages <= 1;
            }

            if (indicator) {
                indicator.textContent = `Page ${Math.max(currentIndex + 1, totalPages ? 1 : 0)} of ${Math.max(totalPages, 1)}`;
            }

            if (detail) {
                detail.textContent = currentPage ? currentPage.getAttribute('data-page-label') || '' : '';
            }
        }

        function showPage(index) {
            currentIndex = Math.max(0, Math.min(index, pages.length - 1));
            pages.forEach((page, pageIndex) => {
                const active = pageIndex === currentIndex;
                page.classList.toggle('active', active);
                page.setAttribute('aria-hidden', active ? 'false' : 'true');
            });
            updateControls();
        }

        function showAllPages() {
            container.classList.add('viewer-export-mode');
            pages.forEach((page) => {
                page.classList.add('active');
                page.setAttribute('aria-hidden', 'false');
            });
        }

        function restoreViewer() {
            container.classList.remove('viewer-export-mode');
            showPage(currentIndex);
        }

        function withAllPages(task) {
            showAllPages();
            const done = Promise.resolve()
                .then(task)
                .finally(() => restoreViewer());
            return done;
        }

        if (previousButton) {
            previousButton.addEventListener('click', function () {
                showPage(currentIndex - 1);
            });
        }

        if (nextButton) {
            nextButton.addEventListener('click', function () {
                showPage(currentIndex + 1);
            });
        }

        document.addEventListener('keydown', function (event) {
            if (event.defaultPrevented) return;
            const target = event.target;
            const tagName = target && target.tagName ? target.tagName.toLowerCase() : '';
            if (tagName === 'input' || tagName === 'textarea' || tagName === 'select' || target?.isContentEditable) {
                return;
            }

            if (event.key === 'ArrowLeft' && previousButton && !previousButton.disabled) {
                event.preventDefault();
                showPage(currentIndex - 1);
            }

            if (event.key === 'ArrowRight' && nextButton && !nextButton.disabled) {
                event.preventDefault();
                showPage(currentIndex + 1);
            }
        });

        window.addEventListener('beforeprint', showAllPages);
        window.addEventListener('afterprint', restoreViewer);

        showPage(currentIndex);

        return {
            showPage,
            nextPage: function () { showPage(currentIndex + 1); },
            previousPage: function () { showPage(currentIndex - 1); },
            updateControls,
            showAllPages,
            restoreViewer,
            withAllPages,
            getCurrentPage: function () { return currentIndex + 1; },
            getTotalPages: function () { return pages.length; }
        };
    }

    window.initializeReportViewer = initializeReportViewer;
})();
