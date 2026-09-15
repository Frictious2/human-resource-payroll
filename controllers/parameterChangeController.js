const parameterChangeService = require('../services/parameterChangeService');

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

async function getAdminQueue(req, res) {
    try {
        const companyId = getCompanyId(req);
        const user = getUser(req, 'Admin', 'admin');
        const items = await parameterChangeService.listParameterChanges(companyId, {
            module: req.query.module || '',
            status: req.query.status || '',
            submittedBy: user.id || 0
        });

        res.render('admin/parameter_changes/index', {
            title: 'Parameter Change Proposals',
            path: '/admin/parameter-changes',
            user,
            items,
            filters: {
                module: req.query.module || '',
                status: req.query.status || ''
            },
            moduleOptions: Object.values(parameterChangeService.PARAMETER_MODULE_CONFIG).map((config) => ({
                value: config.module,
                label: config.label
            })),
            statusOptions: Object.values(parameterChangeService.PARAMETER_CHANGE_STATUSES),
            getStatusBadgeClass: parameterChangeService.mapStatusBadge,
            success: req.query.success || '',
            error: req.query.error || '',
            discoveryMatrix: parameterChangeService.getDiscoveryMatrix()
        });
    } catch (error) {
        console.error('Admin parameter change queue error:', error);
        res.status(error.statusCode || 500).send(error.message || 'Failed to load parameter change queue.');
    }
}

async function getAdminDetail(req, res) {
    try {
        const detail = await parameterChangeService.getParameterChangeDetail(getCompanyId(req), req.params.requestId, getUser(req, 'Admin', 'admin'));
        res.render('admin/parameter_changes/detail', {
            title: `Parameter Change - ${detail.request.moduleLabel}`,
            path: `/admin/parameter-changes/${req.params.requestId}`,
            user: getUser(req, 'Admin', 'admin'),
            detail,
            getStatusBadgeClass: parameterChangeService.mapStatusBadge,
            success: req.query.success || '',
            error: req.query.error || ''
        });
    } catch (error) {
        console.error('Admin parameter change detail error:', error);
        res.status(error.statusCode || 500).send(error.message || 'Failed to load parameter change detail.');
    }
}

async function postAdminSubmit(req, res) {
    try {
        await parameterChangeService.submitParameterChange({
            companyId: getCompanyId(req),
            requestId: req.params.requestId,
            reason: req.body.reason || '',
            user: getUser(req, 'Admin', 'admin')
        });
        res.redirect(`/admin/parameter-changes/${req.params.requestId}?success=${encodeURIComponent('Your proposed change has been submitted to the Entity Head/HNO. The current live parameter remains unchanged until final approval.')}`);
    } catch (error) {
        console.error('Admin parameter change submit error:', error);
        res.redirect(`/admin/parameter-changes/${req.params.requestId}?error=${encodeURIComponent(error.message || 'Failed to submit parameter change.')}`);
    }
}

async function postAdminCancel(req, res) {
    try {
        await parameterChangeService.cancelParameterChange({
            companyId: getCompanyId(req),
            requestId: req.params.requestId,
            user: getUser(req, 'Admin', 'admin')
        });
        res.redirect('/admin/parameter-changes?success=' + encodeURIComponent('Draft parameter change cancelled successfully.'));
    } catch (error) {
        console.error('Admin parameter change cancel error:', error);
        res.redirect('/admin/parameter-changes?error=' + encodeURIComponent(error.message || 'Failed to cancel parameter change.'));
    }
}

async function getEntityHeadQueue(req, res) {
    try {
        const companyId = getCompanyId(req);
        const items = await parameterChangeService.listParameterChanges(companyId, {
            module: req.query.module || '',
            status: req.query.status || parameterChangeService.PARAMETER_CHANGE_STATUSES.SUBMITTED_TO_ENTITY_HEAD
        });

        res.render('entity_head/parameter_changes/index', {
            title: 'Parameter Change Final Approval',
            path: '/entity-head/parameter-changes',
            user: getUser(req, 'Entity Head', 'entity-head'),
            entityScope: req.entityScope,
            items,
            filters: {
                module: req.query.module || '',
                status: req.query.status || parameterChangeService.PARAMETER_CHANGE_STATUSES.SUBMITTED_TO_ENTITY_HEAD
            },
            moduleOptions: Object.values(parameterChangeService.PARAMETER_MODULE_CONFIG).map((config) => ({
                value: config.module,
                label: config.label
            })),
            statusOptions: Object.values(parameterChangeService.PARAMETER_CHANGE_STATUSES),
            getStatusBadgeClass: parameterChangeService.mapStatusBadge,
            success: req.query.success || '',
            error: req.query.error || ''
        });
    } catch (error) {
        console.error('Entity Head parameter change queue error:', error);
        res.status(error.statusCode || 500).send(error.message || 'Failed to load parameter approval queue.');
    }
}

async function getEntityHeadDetail(req, res) {
    try {
        const detail = await parameterChangeService.getParameterChangeDetail(getCompanyId(req), req.params.requestId, getUser(req, 'Entity Head', 'entity-head'));
        res.render('entity_head/parameter_changes/detail', {
            title: `Final Approval - ${detail.request.moduleLabel}`,
            path: `/entity-head/parameter-changes/${req.params.requestId}`,
            user: getUser(req, 'Entity Head', 'entity-head'),
            entityScope: req.entityScope,
            detail,
            getStatusBadgeClass: parameterChangeService.mapStatusBadge,
            success: req.query.success || '',
            error: req.query.error || ''
        });
    } catch (error) {
        console.error('Entity Head parameter change detail error:', error);
        res.status(error.statusCode || 500).send(error.message || 'Failed to load parameter change detail.');
    }
}

async function postEntityHeadApprove(req, res) {
    try {
        await parameterChangeService.entityHeadApproveParameterChange({
            companyId: getCompanyId(req),
            requestId: req.params.requestId,
            comments: req.body.comments || '',
            user: getUser(req, 'Entity Head', 'entity-head')
        });
        res.redirect(`/entity-head/parameter-changes/${req.params.requestId}?success=${encodeURIComponent('Parameter change approved and applied successfully.')}`);
    } catch (error) {
        console.error('Entity Head parameter change approve error:', error);
        res.redirect(`/entity-head/parameter-changes/${req.params.requestId}?error=${encodeURIComponent(error.message || 'Failed to approve parameter change.')}`);
    }
}

async function postEntityHeadReturn(req, res) {
    try {
        await parameterChangeService.entityHeadReturnParameterChange({
            companyId: getCompanyId(req),
            requestId: req.params.requestId,
            comments: req.body.comments || '',
            user: getUser(req, 'Entity Head', 'entity-head')
        });
        res.redirect(`/entity-head/parameter-changes/${req.params.requestId}?success=${encodeURIComponent('Parameter change returned to the Administrator for correction.')}`);
    } catch (error) {
        console.error('Entity Head parameter change return error:', error);
        res.redirect(`/entity-head/parameter-changes/${req.params.requestId}?error=${encodeURIComponent(error.message || 'Failed to return parameter change.')}`);
    }
}

async function postEntityHeadReject(req, res) {
    try {
        await parameterChangeService.entityHeadRejectParameterChange({
            companyId: getCompanyId(req),
            requestId: req.params.requestId,
            comments: req.body.comments || '',
            user: getUser(req, 'Entity Head', 'entity-head')
        });
        res.redirect(`/entity-head/parameter-changes/${req.params.requestId}?success=${encodeURIComponent('Parameter change rejected successfully.')}`);
    } catch (error) {
        console.error('Entity Head parameter change reject error:', error);
        res.redirect(`/entity-head/parameter-changes/${req.params.requestId}?error=${encodeURIComponent(error.message || 'Failed to reject parameter change.')}`);
    }
}

module.exports = {
    getAdminDetail,
    getAdminQueue,
    getEntityHeadDetail,
    getEntityHeadQueue,
    postAdminCancel,
    postAdminSubmit,
    postEntityHeadApprove,
    postEntityHeadReject,
    postEntityHeadReturn
};
