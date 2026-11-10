// cPanel/Passenger's conventional startup file. Only one HTTP listener is created.
require('./server').startManagedServer().catch(() => {
    console.error('Application startup failed. Check protected server logs and configuration.');
    process.exit(1);
});
