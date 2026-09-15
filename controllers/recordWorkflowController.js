const recordWorkflowService = require('../services/recordWorkflowService');

function getCompanyId(req) {
    return req.entityScope?.companyId
        || req.user?.companyId
        || req.user?.company_id
        || req.session?.companyId
        || req.session?.CompanyID
        || 1;
}

function getUser(req, fallbackName, fallbackRole) {
    return req.session?.user || req.user || { name: fallbackName, role: fallbackRole };
}

const MODULE_OPTIONS = Object.keys(recordWorkflowService.MODULE_CONFIG).map((moduleKey) => ({
    value: moduleKey,
    label: recordWorkflowService.MODULE_CONFIG[moduleKey].label
}));

async function getDataEntryQueue(req, res) {
    try {
        const companyId = getCompanyId(req);
        await recordWorkflowService.ensureWorkflowTables();
        await recordWorkflowService.syncAllDraftModules(companyId);

        const filters = {
            module: req.query.module || '',
            status: req.query.status || ''
        };
        const items = await recordWorkflowService.listWorkflowItems(companyId, filters);

        res.render('data_entry/record_workflow/index', {
            title: 'Sensitive Record Workflow',
            path: '/data-entry/workflow/records',
            user: getUser(req, 'Data Entry Clerk', 'data-entry'),
            items,
            filters,
            moduleOptions: MODULE_OPTIONS,
            statusOptions: Object.values(recordWorkflowService.RECORD_WORKFLOW_STATUSES),
            getStatusBadgeClass: recordWorkflowService.mapWorkflowStatusBadge,
            success: req.query.success || '',
            error: req.query.error || ''
        });
    } catch (error) {
        console.error('Data Entry record workflow queue error:', error);
        res.status(error.statusCode || 500).send(error.message || 'Failed to load record workflow queue.');
    }
}

async function postDataEntrySubmit(req, res) {
    try {
        await recordWorkflowService.submitRecord({
            companyId: getCompanyId(req),
            workflowItemId: req.params.workflowItemId,
            module: req.body.module || '',
            user: getUser(req, 'Data Entry Clerk', 'data-entry')
        });

        return res.redirect('/data-entry/workflow/records?success=' + encodeURIComponent('Record submitted to Manager successfully.'));
    } catch (error) {
        console.error('Data Entry record workflow submit error:', error);
        return res.redirect('/data-entry/workflow/records?error=' + encodeURIComponent(error.message || 'Failed to submit record to Manager.'));
    }
}

async function getManagerQueue(req, res) {
    try {
        const companyId = getCompanyId(req);
        await recordWorkflowService.ensureWorkflowTables();
        await recordWorkflowService.syncAllDraftModules(companyId);

        const filters = {
            module: req.query.module || '',
            status: req.query.status || recordWorkflowService.RECORD_WORKFLOW_STATUSES.SUBMITTED_TO_MANAGER
        };
        const items = await recordWorkflowService.listWorkflowItems(companyId, filters);

        res.render('manager/record_workflow/queue', {
            title: 'Sensitive Record Endorsement',
            path: '/manager/record-workflow',
            user: getUser(req, 'Manager', 'manager'),
            items,
            filters,
            moduleOptions: MODULE_OPTIONS,
            statusOptions: Object.values(recordWorkflowService.RECORD_WORKFLOW_STATUSES),
            getStatusBadgeClass: recordWorkflowService.mapWorkflowStatusBadge,
            success: req.query.success || '',
            error: req.query.error || ''
        });
    } catch (error) {
        console.error('Manager record workflow queue error:', error);
        res.status(error.statusCode || 500).send(error.message || 'Failed to load record endorsement queue.');
    }
}

async function getManagerDetail(req, res) {
    try {
        const detail = await recordWorkflowService.getWorkflowDetail(getCompanyId(req), req.params.workflowItemId);

        res.render('manager/record_workflow/detail', {
            title: `Endorse ${detail.item.moduleLabel}`,
            path: `/manager/record-workflow/${req.params.workflowItemId}`,
            user: getUser(req, 'Manager', 'manager'),
            detail,
            getStatusBadgeClass: recordWorkflowService.mapWorkflowStatusBadge,
            success: req.query.success || '',
            error: req.query.error || ''
        });
    } catch (error) {
        console.error('Manager record workflow detail error:', error);
        res.status(error.statusCode || 500).send(error.message || 'Failed to load record endorsement detail.');
    }
}

async function postManagerEndorse(req, res) {
    try {
        await recordWorkflowService.managerEndorseRecord({
            companyId: getCompanyId(req),
            workflowItemId: req.params.workflowItemId,
            user: getUser(req, 'Manager', 'manager'),
            comments: req.body.comments || ''
        });

        return res.redirect(`/manager/record-workflow/${req.params.workflowItemId}?success=${encodeURIComponent('Record endorsed and forwarded to the Entity Head/HNO successfully.')}`);
    } catch (error) {
        console.error('Manager record workflow endorse error:', error);
        return res.redirect(`/manager/record-workflow/${req.params.workflowItemId}?error=${encodeURIComponent(error.message || 'Failed to endorse record.')}`);
    }
}

async function postManagerReturn(req, res) {
    try {
        await recordWorkflowService.managerReturnRecord({
            companyId: getCompanyId(req),
            workflowItemId: req.params.workflowItemId,
            user: getUser(req, 'Manager', 'manager'),
            comments: req.body.comments || ''
        });

        return res.redirect(`/manager/record-workflow/${req.params.workflowItemId}?success=${encodeURIComponent('Record returned to Data Entry successfully.')}`);
    } catch (error) {
        console.error('Manager record workflow return error:', error);
        return res.redirect(`/manager/record-workflow/${req.params.workflowItemId}?error=${encodeURIComponent(error.message || 'Failed to return record.')}`);
    }
}

async function getEntityHeadQueue(req, res) {
    try {
        const companyId = getCompanyId(req);
        await recordWorkflowService.ensureWorkflowTables();
        await recordWorkflowService.syncAllDraftModules(companyId);

        const filters = {
            module: req.query.module || '',
            status: req.query.status || recordWorkflowService.RECORD_WORKFLOW_STATUSES.SUBMITTED_TO_ENTITY_HEAD
        };
        const items = await recordWorkflowService.listWorkflowItems(companyId, filters);

        res.render('entity_head/record_workflow/queue', {
            title: 'Sensitive Record Final Approval',
            path: '/entity-head/record-workflow',
            user: getUser(req, 'Entity Head', 'entity-head'),
            entityScope: req.entityScope,
            items,
            filters,
            moduleOptions: MODULE_OPTIONS,
            statusOptions: Object.values(recordWorkflowService.RECORD_WORKFLOW_STATUSES),
            getStatusBadgeClass: recordWorkflowService.mapWorkflowStatusBadge,
            success: req.query.success || '',
            error: req.query.error || ''
        });
    } catch (error) {
        console.error('Entity Head record workflow queue error:', error);
        res.status(error.statusCode || 500).send(error.message || 'Failed to load final approval queue.');
    }
}

async function getEntityHeadDetail(req, res) {
    try {
        const detail = await recordWorkflowService.getWorkflowDetail(getCompanyId(req), req.params.workflowItemId);

        res.render('entity_head/record_workflow/detail', {
            title: `Final Approval - ${detail.item.moduleLabel}`,
            path: `/entity-head/record-workflow/${req.params.workflowItemId}`,
            user: getUser(req, 'Entity Head', 'entity-head'),
            entityScope: req.entityScope,
            detail,
            getStatusBadgeClass: recordWorkflowService.mapWorkflowStatusBadge,
            success: req.query.success || '',
            error: req.query.error || ''
        });
    } catch (error) {
        console.error('Entity Head record workflow detail error:', error);
        res.status(error.statusCode || 500).send(error.message || 'Failed to load final approval detail.');
    }
}

async function postEntityHeadApprove(req, res) {
    try {
        await recordWorkflowService.entityHeadApproveRecord({
            companyId: getCompanyId(req),
            workflowItemId: req.params.workflowItemId,
            user: getUser(req, 'Entity Head', 'entity-head'),
            comments: req.body.comments || ''
        });

        return res.redirect(`/entity-head/record-workflow/${req.params.workflowItemId}?success=${encodeURIComponent('Record received final approval successfully.')}`);
    } catch (error) {
        console.error('Entity Head record workflow approve error:', error);
        return res.redirect(`/entity-head/record-workflow/${req.params.workflowItemId}?error=${encodeURIComponent(error.message || 'Failed to approve record.')}`);
    }
}

async function postEntityHeadReturn(req, res) {
    try {
        await recordWorkflowService.entityHeadReturnRecord({
            companyId: getCompanyId(req),
            workflowItemId: req.params.workflowItemId,
            user: getUser(req, 'Entity Head', 'entity-head'),
            comments: req.body.comments || ''
        });

        return res.redirect(`/entity-head/record-workflow/${req.params.workflowItemId}?success=${encodeURIComponent('Record returned for correction successfully.')}`);
    } catch (error) {
        console.error('Entity Head record workflow return error:', error);
        return res.redirect(`/entity-head/record-workflow/${req.params.workflowItemId}?error=${encodeURIComponent(error.message || 'Failed to return record.')}`);
    }
}

async function postEntityHeadReject(req, res) {
    try {
        await recordWorkflowService.entityHeadRejectRecord({
            companyId: getCompanyId(req),
            workflowItemId: req.params.workflowItemId,
            user: getUser(req, 'Entity Head', 'entity-head'),
            comments: req.body.comments || ''
        });

        return res.redirect(`/entity-head/record-workflow/${req.params.workflowItemId}?success=${encodeURIComponent('Record rejected successfully.')}`);
    } catch (error) {
        console.error('Entity Head record workflow reject error:', error);
        return res.redirect(`/entity-head/record-workflow/${req.params.workflowItemId}?error=${encodeURIComponent(error.message || 'Failed to reject record.')}`);
    }
}

module.exports = {
    getDataEntryQueue,
    getEntityHeadDetail,
    getEntityHeadQueue,
    getManagerDetail,
    getManagerQueue,
    postDataEntrySubmit,
    postEntityHeadApprove,
    postEntityHeadReject,
    postEntityHeadReturn,
    postManagerEndorse,
    postManagerReturn
};
