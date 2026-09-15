(function initializeCsrfProtection() {
    'use strict';

    const meta = document.querySelector('meta[name="csrf-token"]');
    const token = meta ? meta.getAttribute('content') : '';
    if (!token) return;

    const safeMethods = new Set(['GET', 'HEAD', 'OPTIONS']);
    const isSameOrigin = (url) => {
        try {
            return new URL(url, window.location.href).origin === window.location.origin;
        } catch (error) {
            return false;
        }
    };

    const secureForms = (root) => {
        const forms = root.querySelectorAll ? root.querySelectorAll('form') : [];
        forms.forEach((form) => {
            const method = String(form.method || 'GET').toUpperCase();
            if (safeMethods.has(method) || form.querySelector('input[name="_csrf"]')) return;
            const input = document.createElement('input');
            input.type = 'hidden';
            input.name = '_csrf';
            input.value = token;
            form.appendChild(input);
        });
    };

    secureForms(document);
    new MutationObserver((mutations) => {
        for (const mutation of mutations) {
            mutation.addedNodes.forEach((node) => {
                if (node.nodeType === Node.ELEMENT_NODE) secureForms(node);
            });
        }
    }).observe(document.documentElement, { childList: true, subtree: true });

    const nativeFetch = window.fetch.bind(window);
    window.fetch = function securedFetch(input, init) {
        const options = { ...(init || {}) };
        const request = input instanceof Request ? input : null;
        const method = String(options.method || (request && request.method) || 'GET').toUpperCase();
        const url = request ? request.url : input;
        if (!safeMethods.has(method) && isSameOrigin(url)) {
            const headers = new Headers(request ? request.headers : undefined);
            new Headers(options.headers || {}).forEach((value, key) => headers.set(key, value));
            headers.set('X-CSRF-Token', token);
            options.headers = headers;
        }
        return nativeFetch(input, options);
    };

    const nativeOpen = XMLHttpRequest.prototype.open;
    const nativeSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function securedOpen(method, url) {
        this.__csrfMethod = String(method || 'GET').toUpperCase();
        this.__csrfSameOrigin = isSameOrigin(url);
        return nativeOpen.apply(this, arguments);
    };
    XMLHttpRequest.prototype.send = function securedSend() {
        if (!safeMethods.has(this.__csrfMethod) && this.__csrfSameOrigin) {
            this.setRequestHeader('X-CSRF-Token', token);
        }
        return nativeSend.apply(this, arguments);
    };
})();
