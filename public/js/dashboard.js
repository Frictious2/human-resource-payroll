(function () {
    // Theme persistence
    const html = document.documentElement;
    const savedTheme = localStorage.getItem('theme') || 'light';
    html.setAttribute('data-bs-theme', savedTheme);

    const themeIcon = document.getElementById('themeIcon');
    const themeToggleBtn = document.getElementById('themeToggleBtn');

    function syncIcon(theme) {
        if (!themeIcon) return;
        themeIcon.className = theme === 'dark' ? 'bi bi-moon-stars-fill' : 'bi bi-sun-fill';
    }
    syncIcon(savedTheme);

    if (themeToggleBtn) {
        themeToggleBtn.addEventListener('click', () => {
            const current = html.getAttribute('data-bs-theme') === 'dark' ? 'dark' : 'light';
            const next = current === 'dark' ? 'light' : 'dark';
            html.setAttribute('data-bs-theme', next);
            localStorage.setItem('theme', next);
            syncIcon(next);
        });
    }

    // Footer year
    const footerYearEl = document.getElementById('footerYear');
    if (footerYearEl) {
        footerYearEl.textContent = new Date().getFullYear();
    }

    // Charts
    const lineCtx = document.getElementById('lineChart');
    const barCtx = document.getElementById('barChart');
    const donutCtx = document.getElementById('donutChart');

    // Payroll Trend (last 6 months)
    if (lineCtx) {
        new Chart(lineCtx, {
            type: 'line',
            data: {
                labels: ['Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep'],
                datasets: [{
                    label: 'Payroll ($)',
                    data: [78000, 82000, 79000, 86000, 84250, 88000],
                    borderColor: '#0d6efd',
                    backgroundColor: 'rgba(13, 110, 253, 0.15)',
                    tension: 0.3,
                    fill: true
                }]
            },
            options: {
                responsive: true,
                plugins: {
                    legend: { display: false }
                },
                scales: {
                    y: { beginAtZero: false }
                }
            }
        });
    }

    // Department data (total employees per department)
    const deptLabels = ['HR', 'Payroll', 'Engineering', 'Sales', 'Marketing'];
    const deptData = [12, 6, 48, 24, 14];
    const deptColors = ['#6c757d', '#198754', '#0d6efd', '#fd7e14', '#6610f2'];

    if (barCtx) {
        new Chart(barCtx, {
            type: 'bar',
            data: {
                labels: deptLabels,
                datasets: [{
                    label: 'Employees',
                    data: deptData,
                    backgroundColor: deptColors
                }]
            },
            options: {
                responsive: true,
                plugins: {
                    legend: { display: false }
                },
                scales: {
                    y: { beginAtZero: true }
                }
            }
        });
    }

    // Calendar: show leaves, retirements, meetings, holidays for current month
    const calendarEl = document.getElementById('calendar');
    if (calendarEl && window.FullCalendar) {
        const today = new Date();
        const year = today.getFullYear();
        const month = today.getMonth(); // 0-indexed

        // Helper to build a date in the current month
        const d = (day, hour = null) => {
            const date = new Date(year, month, day);
            if (hour !== null) date.setHours(hour, 0, 0, 0);
            return date.toISOString().slice(0, hour === null ? 10 : 19);
        };

        const events = [
            // Leaves
            { title: 'Leave: Jane Doe', start: d(5), end: d(8), allDay: true, color: '#0d6efd' },
            { title: 'Leave: Peter Pan', start: d(18), end: d(20), allDay: true, color: '#0d6efd' },

            // Retirements
            { title: 'Retirement: John Smith', start: d(22), allDay: true, color: '#dc3545' },

            // Meetings
            { title: 'Meeting: HR Sync', start: d(14, 10), color: '#198754' },
            { title: 'Meeting: Finance Review', start: d(25, 14), color: '#198754' },

            // Holidays
            { title: 'Holiday: Independence Day', start: d(26), allDay: true, color: '#fd7e14' }
        ];

        const calendar = new FullCalendar.Calendar(calendarEl, {
            initialView: 'dayGridMonth',
            height: 'auto',
            headerToolbar: {
                left: 'prev,next today',
                center: 'title',
                right: 'dayGridMonth,timeGridWeek,timeGridDay'
            },
            events
        });
        calendar.render();
    }
})();