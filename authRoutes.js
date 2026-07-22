const express = require('express');
const router = express.Router();

// Assuming your database connection is imported or available here:
// const db = require('../db'); // Adjust path to your database connection if needed

// --- MIDDLEWARES ---

const checkAuthenticated = (req, res, next) => {
    if (req.session.user) {
        return next();
    } else {
        req.flash('error', 'Please log in to view this resource');
        res.redirect('/login');
    }
};

const checkAdmin = (req, res, next) => {
    if (req.session.user && req.session.user.role === 'admin') {
        return next();
    } else {
        req.flash('error', 'Access denied');
        res.redirect('/dashboard');
    }
};

const validateRegistration = (req, res, next) => {
    const { username, email, password, address, contact } = req.body;
    if (!username || !email || !password || !address || !contact) {
        return res.send('All fields are required.');
    }

    if (password.length < 6) {
        req.flash('error', 'Password should be at least 6 or more characters long');
        req.flash('formData', req.body);
        return res.redirect('/register');
    }
    next();
};

// --- PUBLIC & REGISTRATION ROUTES ---
// Wrap your routes in a function that accepts 'db'
module.exports = function(db) {
    router.get('/', (req, res) => {
        res.render('index', { user: req.session.user, messages: req.flash('success') });
    });

    router.get('/register', (req, res) => {
        res.render('register', { messages: req.flash('error'), formData: req.flash('formData')[0] });
    });

    router.post('/register', validateRegistration, (req, res) => {
        const { username, email, password, address, contact, role } = req.body;
        const sql = 'INSERT INTO users (username, email, password, address, contact, role) VALUES (?, ?, SHA1(?), ?, ?, ?)';
        
        db.query(sql, [username, email, password, address, contact, role], (err, result) => {
            if (err) throw err;
            req.flash('success', 'Registration successful! Please log in.');
            res.redirect('/login');
        });
    });

    // --- LOGIN & 2FA FLOW ROUTES ---

    router.get('/login', (req, res) => {
        res.render('login', { 
            messages: req.flash('success'), 
            errors: req.flash('error') 
        });
    });

    router.post('/login', (req, res) => {
        const { username, password } = req.body;
        if (!username || !password) {
            req.flash('error', 'All fields are required.');
            return res.redirect('/login');
        }

        const sql = 'SELECT * FROM users WHERE username = ? AND password = SHA1(?)';
        db.query(sql, [username, password], (err, results) => {
            if (err) throw err;

            if (results.length > 0) {
                const user = results[0];
                const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
                const expiresAt = new Date(Date.now() + 5 * 60000); // 5 mins from now

                const updateSql = 'UPDATE users SET otp_code = ?, otp_expires_at = ? WHERE id = ?';
                db.query(updateSql, [otpCode, expiresAt, user.id], async (updateErr) => {
                    if (updateErr) throw updateErr;

                    const emailSent = await sendTwoFactorEmail(req, user.email, user.username, otpCode);

                    if (emailSent) {
                        req.session.pendingUserId = user.id;
                        req.flash('success', 'OTP sent to your email.');
                        res.redirect('/verify-2fa');
                    } else {
                        req.flash('error', 'Failed to send verification email.');
                        res.redirect('/login');
                    }
                });
            } else {
                req.flash('error', 'Invalid username or password.');
                res.redirect('/login');
            }
        });
    });

    router.get('/verify-2fa', (req, res) => {
        if (!req.session.pendingUserId) {
            return res.redirect('/login');
        }
        res.render('verify-2fa', { 
            messages: req.flash('success'), 
            errors: req.flash('error') 
        });
    });

    router.post('/verify-2fa', (req, res) => {
        const { otp_code } = req.body;
        const userId = req.session.pendingUserId;

        if (!userId) {
            return res.redirect('/login');
        }

        const sql = 'SELECT * FROM users WHERE id = ?';
        db.query(sql, [userId], (err, results) => {
            if (err) throw err;

            if (results.length === 0) {
                req.flash('error', 'User not found.');
                return res.redirect('/login');
            }

            const user = results[0];
            const currentTime = new Date();

            if (user.otp_code === otp_code && new Date(user.otp_expires_at) > currentTime) {
                const clearSql = 'UPDATE users SET otp_code = NULL, otp_expires_at = NULL WHERE id = ?';
                db.query(clearSql, [userId], (clearErr) => {
                    if (clearErr) throw clearErr;

                    delete req.session.pendingUserId;
                    req.session.user = user;
                    req.flash('success', 'Login successful!');
                    res.redirect('/dashboard');
                });
            } else {
                req.flash('error', 'Invalid or expired OTP code.');
                res.redirect('/verify-2fa');
            }
        });
    });

    // --- PROTECTED DASHBOARD & ADMIN ROUTES ---

    router.get('/dashboard', checkAuthenticated, (req, res) => {
        res.render('dashboard', { user: req.session.user });
    });

    router.get('/admin', checkAdmin, (req, res) => {
        res.render('admin', { user: req.session.user });
    });

    router.get('/logout', (req, res) => {
        req.session.destroy();
        res.redirect('/');
    });

    // --- BREVO EMAIL HELPER FUNCTION ---

    async function sendTwoFactorEmail(req, userEmail, username, otpCode) {
        const url = "https://api.brevo.com/v3/smtp/email";

        const htmlContent = await new Promise((resolve, reject) => {
            req.app.render('otp', { username, otpCode }, (err, html) => {
                if (err) reject(err);
                else resolve(html);
            });
        });

        const emailData = {
            sender: { name: "Gig-Runner@yourapp.com", email: process.env.EMAIL_FROM },
            to: [{ email: userEmail, name: username }],
            subject: "Your Two-Factor Authentication (2FA) Code",
            htmlContent: htmlContent
        };

        const response = await fetch(url, {
            method: "POST",
            headers: {
                "accept": "application/json",
                "api-key": process.env.BREVO_API_KEY,
                "content-type": "application/json"
            },
            body: JSON.stringify(emailData)
        });

        // ADD THESE LINES TO DEBUG:
        const responseData = await response.json();
        console.log("Brevo API Status:", response.status);
        console.log("Brevo API Response:", responseData);

        return response.ok;
    }

    module.exports = {
        router,
        checkAuthenticated
    };
    return { router, checkAuthenticated };
};