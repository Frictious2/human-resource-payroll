const mysql = require('mysql2/promise');

const BASE_URL = process.env.TEST_BASE_URL || 'http://127.0.0.1:3001';
const DB_CONFIG = {
  host: process.env.DBHOST || '127.0.0.1',
  user: process.env.DBUSER || 'root',
  password: process.env.DBPASS || '',
  database: process.env.DBNAME || 'personnel_master'
};

const COMPANY_ID = 1;
const ADMIN_USER = {
  pfno: 99151,
  username: 'phase13_dept_admin',
  email: 'phase13.dept.admin@test.local',
  fullName: 'Phase 13 Department Admin',
  level: 'Admin',
  password: 'DeptPass@123'
};
const ENTITY_USER = {
  pfno: 99152,
  username: 'phase13_dept_hno',
  email: 'phase13.dept.hno@test.local',
  fullName: 'Mustapha G. Koroma',
  level: 'Entity Head',
  password: 'DeptPass@123'
};

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

class HttpSession {
  constructor(baseUrl) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.cookies = new Map();
    this.csrfToken = '';
  }

  _storeCookies(response) {
    const setCookie = response.headers.getSetCookie ? response.headers.getSetCookie() : [];
    for (const header of setCookie) {
      const [pair] = header.split(';');
      const index = pair.indexOf('=');
      if (index > -1) {
        const key = pair.slice(0, index).trim();
        const value = pair.slice(index + 1).trim();
        this.cookies.set(key, value);
      }
    }
  }

  _cookieHeader() {
    return Array.from(this.cookies.entries()).map(([k, v]) => `${k}=${v}`).join('; ');
  }

  async request(path, options = {}) {
    const headers = new Headers(options.headers || {});
    if (this.cookies.size) {
      headers.set('Cookie', this._cookieHeader());
    }

    const response = await fetch(`${this.baseUrl}${path}`, {
      ...options,
      headers,
      redirect: options.redirect || 'manual'
    });

    this._storeCookies(response);
    const text = await response.text();
    const tokenMatch = text.match(/<meta\s+name=["']csrf-token["']\s+content=["']([^"']+)["']/i)
      || text.match(/name=["']_csrf["']\s+value=["']([^"']+)["']/i);
    if (tokenMatch) this.csrfToken = tokenMatch[1];

    return {
      status: response.status,
      headers: response.headers,
      text,
      location: response.headers.get('location') || '',
      json() {
        return JSON.parse(text);
      }
    };
  }

  async get(path, headers = {}) {
    return this.request(path, { method: 'GET', headers });
  }

  async postForm(path, form) {
    const body = new URLSearchParams(form);
    return this.request(path, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'text/html,application/xhtml+xml',
        'X-CSRF-Token': this.csrfToken
      },
      body
    });
  }

  async postJson(path, payload, method = 'POST') {
    return this.request(path, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'X-CSRF-Token': this.csrfToken
      },
      body: JSON.stringify(payload)
    });
  }
}

async function ensurePortalUser(db, user) {
  const [rows] = await db.query('SELECT PFNo FROM tblpassword WHERE Username = ? OR Email = ? LIMIT 1', [user.username, user.email]);
  if (rows.length) {
    await db.query(
      `UPDATE tblpassword
       SET PFNo = ?, Username = ?, FullName = ?, Pword = ?, Email = ?, Level = ?, CompanyID = ?
       WHERE Username = ? OR Email = ?`,
      [user.pfno, user.username, user.fullName, user.password, user.email, user.level, COMPANY_ID, user.username, user.email]
    );
    return;
  }

  await db.query(
    `INSERT INTO tblpassword (DateCreated, Level, PFNo, Username, FullName, Pword, Email, CompanyID)
     VALUES (NOW(), ?, ?, ?, ?, ?, ?, ?)`,
    [user.level, user.pfno, user.username, user.fullName, user.password, user.email, COMPANY_ID]
  );
}

async function loginAs(session, loginPath, identifier, password) {
  await session.get(loginPath);
  const response = await session.postForm(loginPath, { identifier, password });
  assert(response.status === 302, `Expected login redirect from ${loginPath}, got ${response.status}`);
  assert(response.location, `Expected login redirect location for ${loginPath}`);
  return response.location;
}

async function fetchRequest(db, requestId) {
  const [rows] = await db.query('SELECT * FROM parameter_change_requests WHERE id = ?', [requestId]);
  return rows[0] || null;
}

async function fetchActions(db, requestId) {
  const [rows] = await db.query('SELECT * FROM parameter_change_actions WHERE ChangeRequestID = ? ORDER BY id ASC', [requestId]);
  return rows;
}

async function fetchNotifications(db, requestId) {
  const [rows] = await db.query(
    `SELECT * FROM workflow_notifications
     WHERE ReferenceID = ?
     ORDER BY id ASC`,
    [String(requestId)]
  );
  return rows;
}

async function fetchLiveDept(db, code) {
  const [rows] = await db.query('SELECT * FROM tbldept WHERE Code = ? AND (CompanyID = ? OR CompanyID IS NULL) LIMIT 1', [code, COMPANY_ID]);
  return rows[0] || null;
}

async function fetchLiveDeptByName(db, name) {
  const [rows] = await db.query('SELECT * FROM tbldept WHERE Dept = ? AND (CompanyID = ? OR CompanyID IS NULL) ORDER BY Code DESC LIMIT 1', [name, COMPANY_ID]);
  return rows[0] || null;
}

async function cleanupTestArtifacts(db, prefix) {
  const [requests] = await db.query(
    `SELECT id, RecordReference
     FROM parameter_change_requests
     WHERE ParameterModule = 'departments'
       AND (
         Reason LIKE ?
         OR ProposedValues LIKE ?
         OR OldValues LIKE ?
       )`,
    [`%${prefix}%`, `%${prefix}%`, `%${prefix}%`]
  );

  if (requests.length) {
    const ids = requests.map((row) => row.id);
    await db.query(`DELETE FROM parameter_change_actions WHERE ChangeRequestID IN (${ids.map(() => '?').join(',')})`, ids);
    await db.query(`DELETE FROM workflow_notifications WHERE ReferenceID IN (${ids.map(() => '?').join(',')})`, ids.map(String));
    await db.query(`DELETE FROM parameter_change_requests WHERE id IN (${ids.map(() => '?').join(',')})`, ids);
  }

  await db.query('DELETE FROM tbldept WHERE Dept LIKE ? AND (CompanyID = ? OR CompanyID IS NULL)', [`${prefix}%`, COMPANY_ID]);
}

async function main() {
  const db = await mysql.createConnection(DB_CONFIG);
  const admin = new HttpSession(BASE_URL);
  const entity = new HttpSession(BASE_URL);
  const prefix = `Phase15A Dept ${Date.now()}`;
  const summary = {
    routesTested: [],
    create: {},
    update: {},
    delete: {},
    notifications: {},
    queueChecks: {},
    defects: []
  };

  try {
    await ensurePortalUser(db, ADMIN_USER);
    await ensurePortalUser(db, ENTITY_USER);
    await cleanupTestArtifacts(db, prefix);

    await loginAs(admin, '/login', ADMIN_USER.email, ADMIN_USER.password);
    await loginAs(entity, '/entity-head/login', ENTITY_USER.email, ENTITY_USER.password);

    summary.routesTested.push('/login', '/entity-head/login');

    const adminPage = await admin.get('/admin/parameters/departments');
    assert(adminPage.status === 200, 'Admin Department page did not load.');
    assert(adminPage.text.includes('Department maintenance now uses the approval workflow'), 'Department page explanation is missing.');
    summary.routesTested.push('/admin/parameters/departments');

    const liveListBefore = await admin.get('/admin/api/parameters/departments', { Accept: 'application/json' });
    assert(liveListBefore.status === 200, 'Department API list did not load.');
    summary.routesTested.push('/admin/api/parameters/departments');
    const liveDataBefore = liveListBefore.json().data;

    const createDraft = await admin.postJson('/admin/api/parameters/departments', {
      Dept: `${prefix} Create`,
      reason: `${prefix} create draft`
    });
    assert(createDraft.status === 200, `Create proposal failed with status ${createDraft.status}`);
    const createDraftJson = createDraft.json();
    const createRequestId = createDraftJson.proposal.id;
    const createRecordReference = createDraftJson.proposal.reference;
    summary.routesTested.push('POST /admin/api/parameters/departments');
    summary.create.draftRequestId = createRequestId;
    summary.create.recordReference = createRecordReference;
    assert(createDraftJson.pendingApproval === true, 'Create proposal did not return pending approval state.');

    const createRequestDraft = await fetchRequest(db, createRequestId);
    assert(createRequestDraft && createRequestDraft.Status === 'DRAFT', 'Create request did not stay in DRAFT.');
    const liveBeforeApproval = await fetchLiveDept(db, createRecordReference);
    assert(!liveBeforeApproval, 'Live department row was created before approval.');

    const adminDraftDetail = await admin.get(`/admin/parameter-changes/${createRequestId}`);
    assert(adminDraftDetail.status === 200, 'Admin detail page did not load for draft proposal.');
    assert(adminDraftDetail.text.includes(createRecordReference), 'Admin detail page is missing the Department reference.');
    summary.routesTested.push(`/admin/parameter-changes/${createRequestId}`);

    const adminListAfterDraft = await admin.get('/admin/api/parameters/departments', { Accept: 'application/json' });
    const adminListAfterDraftJson = adminListAfterDraft.json().data;
    assert(
      (adminListAfterDraftJson.pendingCreates || []).some((row) => row.proposedCode === createRecordReference && row.proposedLabel === `${prefix} Create`),
      'Pending create proposal is not visible in the Department page data source.'
    );

    const submitCreate = await admin.postForm(`/admin/parameter-changes/${createRequestId}/submit`, {
      reason: `${prefix} submit create`
    });
    assert(submitCreate.status === 302, 'Create proposal submit did not redirect.');
    summary.routesTested.push(`POST /admin/parameter-changes/${createRequestId}/submit`);

    const createSubmitted = await fetchRequest(db, createRequestId);
    assert(createSubmitted.Status === 'SUBMITTED_TO_ENTITY_HEAD', 'Create request did not move to SUBMITTED_TO_ENTITY_HEAD.');

    const entityNotificationsAfterCreate = await fetchNotifications(db, createRequestId);
    assert(entityNotificationsAfterCreate.some((row) => Number(row.RecipientUserID) === ENTITY_USER.pfno || row.RecipientRole === 'entity-head'), 'Entity Head notification was not created for submitted Department proposal.');

    const entityQueue = await entity.get('/entity-head/parameter-changes');
    assert(entityQueue.status === 200, 'Entity Head parameter queue did not load.');
    assert(entityQueue.text.includes(createRecordReference), 'Entity Head queue did not show submitted Department proposal.');
    summary.routesTested.push('/entity-head/parameter-changes');

    const entityDetail = await entity.get(`/entity-head/parameter-changes/${createRequestId}`);
    assert(entityDetail.status === 200, 'Entity Head detail page did not load.');
    assert(entityDetail.text.includes(createRecordReference), 'Entity Head detail is missing Department reference.');
    summary.routesTested.push(`/entity-head/parameter-changes/${createRequestId}`);

    const returnedCreate = await entity.postForm(`/entity-head/parameter-changes/${createRequestId}/return`, {
      comments: `${prefix} return for correction`
    });
    assert(returnedCreate.status === 302, 'Entity Head return did not redirect.');
    summary.routesTested.push(`POST /entity-head/parameter-changes/${createRequestId}/return`);

    const createReturned = await fetchRequest(db, createRequestId);
    assert(createReturned.Status === 'RETURNED_BY_ENTITY_HEAD', 'Create request did not move to RETURNED_BY_ENTITY_HEAD.');

    const adminNotificationsAfterReturn = await fetchNotifications(db, createRequestId);
    assert(adminNotificationsAfterReturn.some((row) => Number(row.RecipientUserID) === ADMIN_USER.pfno || row.RecipientRole === 'admin'), 'Admin was not notified after return.');

    const correctedCreate = await admin.postJson('/admin/api/parameters/departments', {
      Code: createRecordReference,
      Dept: `${prefix} Create Corrected`,
      reason: `${prefix} corrected create draft`
    });
    assert(correctedCreate.status === 200, 'Corrected create draft failed.');
    const correctedCreateJson = correctedCreate.json();
    assert(Number(correctedCreateJson.proposal.id) === Number(createRequestId), 'Returned create draft did not update the existing request.');

    const resubmitCreate = await admin.postForm(`/admin/parameter-changes/${createRequestId}/submit`, {
      reason: `${prefix} resubmit corrected create`
    });
    assert(resubmitCreate.status === 302, 'Corrected create resubmit did not redirect.');

    const approveCreate = await entity.postForm(`/entity-head/parameter-changes/${createRequestId}/approve`, {
      comments: `${prefix} approve create`
    });
    assert(approveCreate.status === 302, 'Create approval did not redirect.');
    summary.routesTested.push(`POST /entity-head/parameter-changes/${createRequestId}/approve`);

    const createApplied = await fetchRequest(db, createRequestId);
    assert(createApplied.Status === 'APPLIED', 'Create request did not move to APPLIED.');
    const createdLiveRow = await fetchLiveDept(db, createRecordReference);
    assert(createdLiveRow && createdLiveRow.Dept === `${prefix} Create Corrected`, 'Approved create did not write the live tbldept row.');
    summary.create.appliedCode = createRecordReference;

    const updateDraft = await admin.postJson(`/admin/api/parameters/departments/${encodeURIComponent(createRecordReference)}`, {
      Dept: `${prefix} Updated`,
      reason: `${prefix} update draft`
    }, 'PATCH');
    assert(updateDraft.status === 200, 'Update proposal failed.');
    const updateDraftJson = updateDraft.json();
    const updateRequestId = updateDraftJson.proposal.id;
    summary.routesTested.push(`PATCH /admin/api/parameters/departments/${createRecordReference}`);
    const liveAfterUpdateDraft = await fetchLiveDept(db, createRecordReference);
    assert(liveAfterUpdateDraft.Dept === `${prefix} Create Corrected`, 'Live department changed before update approval.');

    await admin.postForm(`/admin/parameter-changes/${updateRequestId}/submit`, {
      reason: `${prefix} submit update`
    });
    const updateSubmitted = await fetchRequest(db, updateRequestId);
    assert(updateSubmitted.Status === 'SUBMITTED_TO_ENTITY_HEAD', 'Update request did not move to submitted.');
    const lockedUpdateAttempt = await admin.postJson(`/admin/api/parameters/departments/${encodeURIComponent(createRecordReference)}`, {
      Dept: `${prefix} Should Stay Locked`,
      reason: `${prefix} locked update attempt`
    }, 'PATCH');
    assert(lockedUpdateAttempt.status === 409, 'Submitted Department update should be locked from Admin edits.');

    await db.query('UPDATE tbldept SET Dept = ? WHERE Code = ? AND (CompanyID = ? OR CompanyID IS NULL)', [`${prefix} Tampered`, createRecordReference, COMPANY_ID]);
    const updateApproveConflict = await entity.postForm(`/entity-head/parameter-changes/${updateRequestId}/approve`, {
      comments: `${prefix} approve update`
    });
    assert(updateApproveConflict.status === 302, 'Update approval conflict did not redirect.');
    const conflictMessage = decodeURIComponent(updateApproveConflict.location || '');
    assert(
      conflictMessage.includes('changed after submission') || conflictMessage.includes('resubmission'),
      'Checksum conflict did not return the expected message.'
    );
    const updateStillSubmitted = await fetchRequest(db, updateRequestId);
    assert(updateStillSubmitted.Status === 'SUBMITTED_TO_ENTITY_HEAD', 'Checksum conflict should not change request status.');
    await db.query('UPDATE tbldept SET Dept = ? WHERE Code = ? AND (CompanyID = ? OR CompanyID IS NULL)', [`${prefix} Create Corrected`, createRecordReference, COMPANY_ID]);

    const updateApprove = await entity.postForm(`/entity-head/parameter-changes/${updateRequestId}/approve`, {
      comments: `${prefix} approve update after restore`
    });
    assert(updateApprove.status === 302, 'Update approval after restore did not redirect.');
    const updatedLiveRow = await fetchLiveDept(db, createRecordReference);
    assert(updatedLiveRow.Dept === `${prefix} Updated`, 'Approved update did not apply exactly once.');
    summary.update.requestId = updateRequestId;

    const deleteReferenced = await admin.postJson('/admin/api/parameters/departments/01', {
      reason: `${prefix} referenced delete check`
    }, 'DELETE');
    assert(deleteReferenced.status === 409, `Referenced delete should be blocked, got ${deleteReferenced.status}`);
    assert(deleteReferenced.json().error.includes('cannot be deleted'), 'Referenced delete did not return dependency message.');
    summary.delete.referencedBlock = deleteReferenced.json().error;
    summary.routesTested.push('DELETE /admin/api/parameters/departments/01');

    const deleteDraft = await admin.postJson(`/admin/api/parameters/departments/${encodeURIComponent(createRecordReference)}`, {
      reason: `${prefix} safe delete draft`
    }, 'DELETE');
    assert(deleteDraft.status === 200, 'Safe delete proposal failed.');
    const deleteDraftJson = deleteDraft.json();
    const deleteRequestId = deleteDraftJson.proposal.id;
    summary.routesTested.push(`DELETE /admin/api/parameters/departments/${createRecordReference}`);

    const liveBeforeDeleteApproval = await fetchLiveDept(db, createRecordReference);
    assert(liveBeforeDeleteApproval, 'Live row disappeared before delete approval.');

    await admin.postForm(`/admin/parameter-changes/${deleteRequestId}/submit`, {
      reason: `${prefix} submit delete`
    });
    const rejectDelete = await entity.postForm(`/entity-head/parameter-changes/${deleteRequestId}/reject`, {
      comments: `${prefix} reject delete`
    });
    assert(rejectDelete.status === 302, 'Delete rejection did not redirect.');
    const deleteRejected = await fetchRequest(db, deleteRequestId);
    assert(deleteRejected.Status === 'FINAL_REJECTED', 'Delete request did not move to FINAL_REJECTED.');
    const liveAfterReject = await fetchLiveDept(db, createRecordReference);
    assert(liveAfterReject, 'Rejected delete changed the live row.');
    summary.routesTested.push(`POST /entity-head/parameter-changes/${deleteRequestId}/reject`);

    const deleteDraft2 = await admin.postJson(`/admin/api/parameters/departments/${encodeURIComponent(createRecordReference)}`, {
      reason: `${prefix} safe delete draft two`
    }, 'DELETE');
    assert(deleteDraft2.status === 200, 'Second safe delete proposal failed.');
    const deleteRequestId2 = deleteDraft2.json().proposal.id;
    await admin.postForm(`/admin/parameter-changes/${deleteRequestId2}/submit`, {
      reason: `${prefix} submit delete two`
    });
    const approveDelete = await entity.postForm(`/entity-head/parameter-changes/${deleteRequestId2}/approve`, {
      comments: `${prefix} approve delete`
    });
    assert(approveDelete.status === 302, 'Delete approval did not redirect.');
    const deletedLiveRow = await fetchLiveDept(db, createRecordReference);
    assert(!deletedLiveRow, 'Approved delete did not remove the live row.');
    const deleteApplied = await fetchRequest(db, deleteRequestId2);
    assert(deleteApplied.Status === 'APPLIED', 'Delete request did not move to APPLIED.');

    const cancelDraft = await admin.postJson('/admin/api/parameters/departments', {
      Dept: `${prefix} Cancel Draft`,
      reason: `${prefix} cancel draft setup`
    });
    assert(cancelDraft.status === 200, 'Cancel draft setup failed.');
    const cancelDraftId = cancelDraft.json().proposal.id;
    const cancelDraftDetail = await admin.get(`/admin/parameter-changes/${cancelDraftId}`);
    assert(cancelDraftDetail.status === 200, 'Admin detail page did not load for cancelable draft.');
    const cancelDraftRoute = await admin.postForm(`/admin/parameter-changes/${cancelDraftId}/cancel`, {});
    assert(cancelDraftRoute.status === 302, 'Draft cancel did not redirect.');
    const cancelDraftRow = await fetchRequest(db, cancelDraftId);
    assert(cancelDraftRow.Status === 'CANCELLED', 'Draft cancel did not move request to CANCELLED.');
    summary.routesTested.push(`POST /admin/parameter-changes/${cancelDraftId}/cancel`);

    const missingReasonCreate = await admin.postJson('/admin/api/parameters/departments', {
      Dept: `${prefix} Missing Reason`
    });
    assert(missingReasonCreate.status === 400, 'Missing reason create should return 400.');

    const missingReasonUpdate = await admin.postJson(`/admin/api/parameters/departments/${encodeURIComponent('013')}`, {
      Dept: 'HRMD Runtime Check'
    }, 'PATCH');
    assert(missingReasonUpdate.status === 400, 'Missing reason update should return 400.');

    const missingReasonDelete = await admin.postJson(`/admin/api/parameters/departments/${encodeURIComponent('013')}`, {}, 'DELETE');
    assert(missingReasonDelete.status === 400, 'Missing reason delete should return 400.');

    const allActions = await fetchActions(db, createRequestId);
    assert(allActions.some((row) => row.Action === 'RETURN'), 'Return history was not preserved.');
    assert(allActions.some((row) => row.Action === 'APPLY'), 'Apply history is missing.');

    const adminWorkQueue = await admin.get('/work-queue');
    assert(adminWorkQueue.status === 200, 'Admin work queue did not load.');
    summary.routesTested.push('/work-queue');

    summary.notifications.createSubmitted = entityNotificationsAfterCreate.length;
    summary.notifications.createReturned = adminNotificationsAfterReturn.length;
    summary.queueChecks.adminWorkQueueLoaded = true;
    summary.queueChecks.entityQueueLoaded = true;

    console.log(JSON.stringify({
      ok: true,
      baseUrl: BASE_URL,
      companyId: COMPANY_ID,
      routesTested: summary.routesTested,
      create: summary.create,
      update: summary.update,
      delete: summary.delete,
      notifications: summary.notifications,
      queueChecks: summary.queueChecks
    }, null, 2));
  } finally {
    await db.end();
  }
}

main().catch((error) => {
  console.error('Department parameter workflow test failed.');
  console.error(error);
  process.exit(1);
});
