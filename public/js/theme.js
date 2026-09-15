(function () {
    const storageKey = 'hrpayroll-theme';
    const html = document.documentElement;

    function getStoredTheme() {
        try {
            return localStorage.getItem(storageKey) || localStorage.getItem('theme') || 'light';
        } catch (error) {
            return 'light';
        }
    }

    function persistTheme(theme) {
        try {
            localStorage.setItem(storageKey, theme);
            localStorage.setItem('theme', theme);
        } catch (error) {
            // Ignore storage failures and keep the in-memory theme.
        }
    }

    function syncIcons(theme) {
        document.querySelectorAll('#themeIcon').forEach((icon) => {
            icon.className = theme === 'dark' ? 'bi bi-moon-stars-fill' : 'bi bi-sun-fill';
        });
    }

    function applyTheme(theme) {
        const normalizedTheme = theme === 'dark' ? 'dark' : 'light';
        html.setAttribute('data-bs-theme', normalizedTheme);
        document.body && document.body.setAttribute('data-bs-theme', normalizedTheme);
        syncIcons(normalizedTheme);
        persistTheme(normalizedTheme);
        return normalizedTheme;
    }

    function initializeThemeToggle() {
        const currentTheme = applyTheme(getStoredTheme());

        document.querySelectorAll('#themeToggleBtn').forEach((button) => {
            if (button.dataset.themeBound === '1') {
                return;
            }

            button.dataset.themeBound = '1';
            button.addEventListener('click', () => {
                const activeTheme = html.getAttribute('data-bs-theme') === 'dark' ? 'dark' : 'light';
                const nextTheme = activeTheme === 'dark' ? 'light' : 'dark';
                applyTheme(nextTheme);
            });
        });

        syncIcons(currentTheme);
    }

    function updateFooterYear() {
        const footerYearEl = document.getElementById('footerYear');
        if (footerYearEl) {
            footerYearEl.textContent = new Date().getFullYear();
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            initializeThemeToggle();
            updateFooterYear();
        });
    } else {
        initializeThemeToggle();
        updateFooterYear();
    }
})();
