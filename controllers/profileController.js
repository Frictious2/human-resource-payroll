const profileService = require('../services/profileService');

function saveSession(req) {
    return new Promise((resolve, reject) => {
        if (!req.session || typeof req.session.save !== 'function') {
            resolve();
            return;
        }

        req.session.save((error) => {
            if (error) {
                reject(error);
                return;
            }
            resolve();
        });
    });
}

function consumeProfileFeedback(req) {
    const feedback = req.session && req.session.profileFeedback ? req.session.profileFeedback : null;
    if (req.session) {
        delete req.session.profileFeedback;
    }
    return feedback;
}

function storeProfileFeedback(req, feedback) {
    if (req.session) {
        req.session.profileFeedback = feedback;
    }
}

async function renderProfile(req, res) {
    try {
        const profile = await profileService.getProfileBySessionUser(req.user);
        const feedback = consumeProfileFeedback(req);
        res.render('profile', profileService.buildProfilePageData({
            sessionUser: req.user,
            profile,
            feedback,
            entityScope: req.entityScope || res.locals.entityScope || null
        }));
    } catch (error) {
        console.error('Profile render error:', error);
        res.status(500).render('shared/coming-soon', {
            role: req.user ? req.user.role : 'user',
            title: 'Profile',
            group: 'Account',
            user: req.user || { name: 'User' },
            message: 'Unable to load your profile right now.'
        });
    }
}

async function updateProfile(req, res) {
    try {
        const result = await profileService.updateProfile({
            sessionUser: req.user,
            fullName: req.body.fullName,
            email: req.body.email
        });

        req.session.user = result.updatedSessionUser;
        req.user = result.updatedSessionUser;
        storeProfileFeedback(req, result.feedback);
        await saveSession(req);
        res.redirect('/profile');
    } catch (error) {
        storeProfileFeedback(req, {
            type: 'danger',
            section: 'profile',
            message: error.expose ? error.message : 'Unable to update profile information.'
        });
        await saveSession(req);
        res.redirect('/profile');
    }
}

async function updatePassword(req, res) {
    try {
        const result = await profileService.updatePassword({
            sessionUser: req.user,
            currentPassword: req.body.currentPassword,
            newPassword: req.body.newPassword,
            confirmPassword: req.body.confirmPassword
        });

        storeProfileFeedback(req, result.feedback);
        await saveSession(req);
        res.redirect('/profile');
    } catch (error) {
        storeProfileFeedback(req, {
            type: 'danger',
            section: 'password',
            message: error.expose ? error.message : 'Unable to update password.'
        });
        await saveSession(req);
        res.redirect('/profile');
    }
}

module.exports = {
    renderProfile,
    updateProfile,
    updatePassword
};
