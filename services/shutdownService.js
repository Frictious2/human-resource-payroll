function createShutdownHandler({ server, sessionStore, pool, mailer, timeoutMs = Number(process.env.SHUTDOWN_TIMEOUT_MS) || 30000, exit = code => process.exit(code) }) {
    let operation;
    return function shutdown() {
        if (operation) return operation;
        operation = (async () => {
            const timer = setTimeout(() => {
                console.error('Shutdown deadline exceeded; active requests may have been interrupted.');
                server.closeAllConnections?.();
                exit(1);
            }, Math.max(1000, timeoutMs));
            try {
                sessionStore.stopCleanup?.();
                // Drain HTTP before closing resources used by in-flight transactions.
                await new Promise((resolve, reject) => {
                    server.close(error => error ? reject(error) : resolve());
                    server.closeIdleConnections?.();
                });
                await sessionStore.close();
                await mailer.close();
                await pool.end();
                clearTimeout(timer);
                exit(0);
            } catch {
                clearTimeout(timer);
                console.error('Shutdown resource cleanup failed.');
                exit(1);
            }
        })();
        return operation;
    };
}

module.exports = { createShutdownHandler };
