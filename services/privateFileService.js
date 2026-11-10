const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const multer = require('multer');
const pool = require('../config/db');
const { assertInstallationUser, getInstallationCompanyId, assertCompanyInput } = require('./installationCompanyService');

const privateRoot = path.resolve(process.env.PRIVATE_UPLOAD_DIR || path.join(__dirname, '..', 'private', 'uploads'));
const legacyRoot = path.resolve(__dirname, '..', 'public', 'uploads');
if (privateRoot === path.resolve(__dirname, '..', 'public') || privateRoot.startsWith(path.resolve(__dirname, '..', 'public') + path.sep)) {
    throw new Error('PRIVATE_UPLOAD_DIR must be outside public storage.');
}

function imageType(buffer) {
    if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return 'png';
    if (buffer.length >= 3 && buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255) return 'jpg';
    if (/^GIF8[79]a$/.test(buffer.subarray(0, 6).toString('ascii'))) return 'gif';
    if (buffer.subarray(0, 4).toString() === 'RIFF' && buffer.subarray(8, 12).toString() === 'WEBP') return 'webp';
    return null;
}

function createImageUpload(kind, maxSize = 3 * 1024 * 1024) {
    if (!['staff_photos', 'medical_receipts', 'logos'].includes(kind)) throw new Error('Invalid upload category');
    const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: maxSize, files: 1, fields: 150, parts: 151 },
        fileFilter: (req, file, cb) => {
            const okay = /^image\/(jpeg|png|gif|webp)$/.test(file.mimetype)
                && /^\.(jpe?g|png|gif|webp)$/i.test(path.extname(file.originalname));
            cb(okay ? null : Object.assign(new Error('Only supported image files are allowed.'), { status: 400 }), okay);
        } });
    return { single: field => (req, res, next) => upload.single(field)(req, res, async error => {
        if (error) { error.status = 400; return next(error); }
        try {
            assertInstallationUser(req.user);
            assertCompanyInput(req.body);
            if (kind !== 'logos') {
                const companyId = Number(req.user?.companyId);
                if (req.user?.role !== 'data-entry' || !Number.isSafeInteger(companyId) || companyId < 1) return res.sendStatus(403);
                const pfNo = String(req.body.pfno || req.body.pfNo || '');
                if (!/^[a-zA-Z0-9_-]{1,50}$/.test(pfNo)) return res.status(400).send('A valid staff identifier is required.');
                const [staff] = await pool.execute('SELECT CompanyID FROM tblstaff WHERE PFNo = ?', [pfNo]);
                if (staff.some(row => Number(row.CompanyID) !== companyId) || (kind === 'medical_receipts' && !staff.length)) return res.sendStatus(403);
            }
            if (!req.file) return next();
            const type = imageType(req.file.buffer);
            const claimed = req.file.mimetype === 'image/jpeg' ? 'jpg' : req.file.mimetype.split('/')[1];
            if (!type || type !== claimed) return res.status(400).send('The uploaded file is not a valid supported image.');
            const directory = path.join(privateRoot, kind);
            await fs.mkdir(directory, { recursive: true, mode: 0o700 });
            const resolvedDirectory = await fs.realpath(directory);
            const publicRoot = path.resolve(__dirname, '..', 'public');
            if (resolvedDirectory === publicRoot || resolvedDirectory.startsWith(publicRoot + path.sep)) throw new Error('Unsafe upload directory');
            req.file.filename = `${crypto.randomUUID()}.${type}`;
            req.file.path = path.join(directory, req.file.filename);
            await fs.writeFile(req.file.path, req.file.buffer, { flag: 'wx', mode: 0o600 });
            delete req.file.buffer;
            next();
        } catch (error) { next(error.status ? error : Object.assign(new Error('Unable to store the uploaded image.'), { status: 500 })); }
    }) };
}

function createPrivateFileHandler({ executor = pool, roots = [privateRoot, legacyRoot] } = {}) {
    return async (req, res) => {
        const parts = req.path.split('/').filter(Boolean);
        const category = parts.length === 1 ? 'logos' : parts[0];
        const filename = parts[parts.length - 1] || '';
        if (parts.length < 1 || parts.length > 2 || !['logos','staff_photos','medical_receipts'].includes(category)
            || !/^[a-zA-Z0-9_-]+\.(jpe?g|png|gif|webp)$/i.test(filename)) return res.sendStatus(404);
        const url = '/uploads/' + parts.join('/');
        try {
            let rows;
            if (category === 'logos') {
                [rows] = await executor.query('SELECT CompanyID FROM tblcominfo WHERE LogoPath = ? AND CompanyID = ? LIMIT 1', [url, getInstallationCompanyId()]);
            } else {
                if (!req.user) return res.sendStatus(401);
                const companyId = Number(req.user.companyId);
                if (!Number.isSafeInteger(companyId) || companyId < 1) return res.sendStatus(403);
                assertInstallationUser(req.user);
                const roles = category === 'medical_receipts'
                    ? ['admin','data-entry','manager','auditor','entity-head']
                    : ['admin','data-entry','manager','auditor','entity-head','finance-officer','finance-manager'];
                if (!roles.includes(req.user.role)) return res.sendStatus(403);
                const query = category === 'staff_photos'
                    ? 'SELECT PFNo FROM tblstaff WHERE PhotoPath = ? AND CompanyID = ? LIMIT 1'
                    : 'SELECT PFNo FROM tblmedical WHERE PicturePath = ? AND CompanyID = ? LIMIT 1';
                [rows] = await executor.query(query, [url, companyId]);
            }
            if (!rows.length) return res.sendStatus(404);
            const relative = parts.join(path.sep);
            for (const root of roots) {
                let file;
                try { file = await fs.realpath(path.join(root, relative)); }
                catch (error) { if (error.code === 'ENOENT') continue; throw error; }
                const resolvedRoot = await fs.realpath(root);
                if (!file.startsWith(resolvedRoot + path.sep)) return res.sendStatus(404);
                res.set({ 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff',
                    'Content-Security-Policy': "default-src 'none'; sandbox", 'Content-Disposition': 'inline' });
                return res.sendFile(file, error => { if (error && !res.headersSent) res.sendStatus(404); });
            }
            return res.sendStatus(404);
        } catch { return res.sendStatus(404); }
    };
}

module.exports = { createImageUpload, createPrivateFileHandler, imageType, privateRoot };
