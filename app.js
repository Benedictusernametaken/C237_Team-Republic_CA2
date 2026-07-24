// IMPORTS
require('dotenv').config();
const crypto = require('crypto');
const express = require('express');
const mysql = require('mysql2');
const session = require('express-session');
const flash = require('connect-flash');
const multer = require('multer');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 3000;

// DATABASE CONNECTION
const db = mysql.createConnection({
    host: 'c237-eaint-mysql.mysql.database.azure.com',
    user: 'c237_001',
    password: 'c237001@2026!',
    database: 'c237_001_teamrepublic',
    ssl: {
        rejectUnauthorized: true
    }
});

db.connect((err) => {
    if (err) {
        throw err;
    }
    console.log('Connected to database');
});

// EXPRESS
app.use(express.urlencoded({ extended: false }));
app.use(express.static('public'));
app.set('view engine', 'ejs');

// SESSION AND FLASH
app.use(session({
    secret: 'secret',
    resave: false,
    saveUninitialized: true,
    cookie: {
        maxAge: 1000 * 60 * 60 * 24 * 7
    }
}));
app.use(flash());

// IMAGE UPLOAD
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, 'public/images');
    },
    filename: (req, file, cb) => {
        const imageName = Date.now() + '-' + file.originalname;
        cb(null, imageName);
    }
});
const upload = multer({
    storage: storage
});

// OTP FUNCTIONS
const OTP_EXPIRY_MS = 5 * 60 * 1000;
const MAX_OTP_ATTEMPTS = 5;

function createOtpCode() {
    return crypto.randomInt(100000, 1000000).toString();
}

function hashOtp(otpCode) {
    return crypto
        .createHash('sha256')
        .update(otpCode)
        .digest('hex');
}

function getSafeUser(user) {
    return {
        id: user.id,
        username: user.username,
        email: user.email,
        address: user.address,
        contact: user.contact,
        role: user.role
    };
}

function maskEmail(email) {
    const emailParts = email.split('@');
    const name = emailParts[0];
    const domain = emailParts[1];

    if (!name || !domain) {
        return 'your email address';
    }

    return name.charAt(0) + '***@' + domain;
}

async function sendOtpEmail(user, otpCode) {
    const apiKey = process.env.BREVO_API_KEY;
    const senderEmail = process.env.EMAIL_FROM;
    const senderName = process.env.EMAIL_FROM_NAME || 'GigRunners';

    if (!apiKey || !senderEmail) {
        console.log('Brevo settings are missing from the .env file.');
        return false;
    }

    const emailData = {
        sender: {
            name: senderName,
            email: senderEmail
        },
        to: [
            {
                email: user.email,
                name: user.username
            }
        ],
        subject: 'Your GigRunners login code',
        htmlContent: `
            <h2>GigRunners Login Verification</h2>
            <p>Hello ${user.username},</p>
            <p>Your OTP code is:</p>
            <h1>${otpCode}</h1>
            <p>This code expires in 5 minutes.</p>
        `
    };

    try {
        const response = await fetch('https://api.brevo.com/v3/smtp/email', {
            method: 'POST',
            headers: {
                accept: 'application/json',
                'api-key': apiKey,
                'content-type': 'application/json'
            },
            body: JSON.stringify(emailData)
        });

        if (response.ok) {
            return true;
        } else {
            console.log('Unable to send OTP email.');
            return false;
        }
    } catch (error) {
        console.log('Unable to send OTP email.');
        return false;
    }
}

// LOGIN CHECKS
const checkAuthenticated = (req, res, next) => {
    if (req.session.user) {
        return next();
    } else {
        req.flash('error', 'Please log in to view this resource');
        res.redirect('/login');
    }
};

const checkAdmin = (req, res, next) => {
    if (req.session.user.role === 'admin') {
        return next();
    } else {
        req.flash('error', 'Access denied');
        res.redirect('/profile');
    }
};

// REGISTRATION VALIDATION
const validateRegistration = (req, res, next) => {
    const username = req.body.username;
    const email = req.body.email;
    const password = req.body.password;
    const address = req.body.address;
    const contact = req.body.contact;

    if (!username || !email || !password || !address || !contact) {
        req.flash('error', 'All fields are required.');
        req.flash('formData', req.body);
        return res.redirect('/register');
    }

    if (password.length < 6) {
        req.flash('error', 'Password should be at least 6 characters long');
        req.flash('formData', req.body);
        return res.redirect('/register');
    }

    next();
};

// HOME PAGE AND SEARCH
app.get('/', (req, res) => {
    res.redirect('/login');
});

app.get('/home', checkAuthenticated, (req, res) => {
    const search = req.query.search;

    if (search) {
        const sql = 'SELECT * FROM gigs WHERE status = ? AND accepted_by IS NULL AND title LIKE ?';
        db.query(sql, ['open', '%' + search + '%'], (err, results) => {
            if (err) {
                throw err;
            }
            res.render('index', {
                user: req.session.user,
                gigs: results,
                search: search,
            });
        });
    } else {
        const sql = 'SELECT * FROM gigs WHERE status = ? AND accepted_by IS NULL';
        db.query(sql, ['open'], (err, results) => {
            if (err) {
                throw err;
            }
            res.render('index', {
                user: req.session.user,
                gigs: results,
                search: '',
            });
        });
    }
});

// POST GIG PAGE
app.get('/post', checkAuthenticated, (req, res) => {
    res.render('post', {
        user: req.session.user,
        errors: req.flash('error')
    });
});

// POST NEW GIG
app.post('/post', checkAuthenticated, upload.single('image'), (req, res) => {
    const title = req.body.title;
    const description = req.body.description;
    const cash = req.body.cash;
    const category = req.body.category;
    const creatorId = req.session.user.id;
    const image = req.file.filename;
    const findIdSql = 'SELECT MAX(gig_id) AS maxId FROM gigs';
    db.query(findIdSql, (err, results) => {
        if (err) {
            throw err;
        }
        let newGigId = 1;
        if (results[0].maxId) {
            newGigId = results[0].maxId + 1;
        }
        const sql = 'INSERT INTO gigs (gig_id, creator_id, accepted_by, title, description, cash, image, category, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)';
        db.query(sql, [newGigId, creatorId, null, title, description, cash, image, category, 'open'], (err, result) => {
            if (err) {
                throw err;
            }
            req.flash('success', 'Gig posted successfully.');
            res.redirect('/profile');
        });
    });
});

// GIG DETAILS
app.get('/gig/:id', checkAuthenticated, (req, res) => {
    const gigId = req.params.id;
    const sql = 'SELECT * FROM gigs WHERE gig_id = ?';
    db.query(sql, [gigId], (err, results) => {
        if (err) {
            throw err;
        }
        if (results.length > 0) {
            res.render('gig', {
                user: req.session.user,
                gig: results[0],
            });
        } else {
            res.send('Gig not found');
        }
    });
});

// ACCEPT GIG
app.post('/gig/:id/accept', checkAuthenticated, (req, res) => {
    const gigId = req.params.id;
    const userId = req.session.user.id;
    const sql = 'UPDATE gigs SET accepted_by = ?, status = ? WHERE gig_id = ? AND accepted_by IS NULL';
    db.query(sql, [userId, 'closed', gigId], (err, result) => {
        if (err) {
            throw err;
        }
        req.flash('success', 'Gig accepted successfully.');
        res.redirect('/profile');
    });
});

// DELETE POSTED GIG
app.post('/gig/:id/delete', checkAuthenticated, (req, res) => {
    const gigId = req.params.id;
    const userId = req.session.user.id;
    const sql = 'DELETE FROM gigs WHERE gig_id = ? AND creator_id = ?';
    db.query(sql, [gigId, userId], (err, result) => {
        if (err) {
            throw err;
        }
        req.flash('success', 'Gig deleted successfully.');
        res.redirect('/profile');
    });
});

// REPORT GIG
app.get('/report/:id', checkAuthenticated, (req, res) => {
    const gigId = req.params.id;
    const sql = 'SELECT * FROM gigs WHERE gig_id = ?';
    db.query(sql, [gigId], (err, results) => {
        if (err) {
            throw err;
        }
        if (results.length > 0) {
            res.render('report', {
                user: req.session.user,
                gig: results[0],
                messages: req.flash('success'),
                errors: req.flash('error')
            });
        } else {
            res.send('Gig not found');
        }
    });
});

app.post('/report', checkAuthenticated, (req, res) => {
    const reason = req.body.reason;
    const comment = req.body.comment;
    const gigId = req.body.gig_id;
    const userId = req.session.user.id;
    const sql = 'INSERT INTO reports (reason, comment, gig_id, user_id, status) VALUES (?, ?, ?, ?, ?)';
    db.query(sql, [reason, comment, gigId, userId, 'pending'], (err, result) => {
        if (err) {
            throw err;
        }
        req.flash('success', 'Report submitted successfully.');
        res.redirect('/home');
    });
});

// REGISTER
app.get('/register', (req, res) => {
    res.render('register', {
        user: null,
        messages: req.flash('error'),
        formData: req.flash('formData')[0] || {}
    });
});

app.post('/register', validateRegistration, (req, res) => {
    const username = req.body.username;
    const email = req.body.email;
    const password = req.body.password;
    const address = req.body.address;
    const contact = req.body.contact;
    const role = 'user';
    const sql = 'INSERT INTO users (username, email, password, address, contact, role) VALUES (?, ?, SHA1(?), ?, ?, ?)';
    db.query(sql, [username, email, password, address, contact, role], (err, result) => {
        if (err) {
            throw err;
        }
        req.flash('success', 'Registration successful. Please log in.');
        res.redirect('/login');
    });
});

// LOGIN AND OTP
app.get('/login', (req, res) => {
    res.render('login', {
        user: null,
        messages: req.flash('success'),
        errors: req.flash('error')
    });
});

app.post('/login', (req, res) => {
    const username = req.body.username;
    const password = req.body.password;

    if (!username || !password) {
        req.flash('error', 'Username and password are required.');
        return res.redirect('/login');
    }

    const sql = 'SELECT * FROM users WHERE username = ? AND password = SHA1(?)';
    db.query(sql, [username, password], async (err, results) => {
        if (err) {
            throw err;
        }
        if (results.length > 0) {
            const user = results[0];
            const otpCode = createOtpCode();
            const emailSent = await sendOtpEmail(user, otpCode);

            if (emailSent) {
                req.session.pendingLogin = {
                    userId: user.id,
                    otpHash: hashOtp(otpCode),
                    expiresAt: Date.now() + OTP_EXPIRY_MS,
                    attempts: 0,
                    maskedEmail: maskEmail(user.email)
                };
                req.flash('success', 'A verification code was sent to your email.');
                res.redirect('/verify-otp');
            } else {
                req.flash('error', 'Unable to send the verification email.');
                res.redirect('/login');
            }
        } else {
            req.flash('error', 'Invalid username or password.');
            res.redirect('/login');
        }
    });
});

app.get('/verify-otp', (req, res) => {
    const pendingLogin = req.session.pendingLogin;

    if (!pendingLogin) {
        req.flash('error', 'Please log in first.');
        return res.redirect('/login');
    }

    if (Date.now() > pendingLogin.expiresAt) {
        delete req.session.pendingLogin;
        req.flash('error', 'Your verification code expired. Please log in again.');
        return res.redirect('/login');
    }

    res.render('verify-otp', {
        user: null,
        maskedEmail: pendingLogin.maskedEmail,
        messages: req.flash('success'),
        errors: req.flash('error')
    });
});

app.post('/verify-otp', (req, res) => {
    const otpCode = req.body.otp_code;
    const pendingLogin = req.session.pendingLogin;

    if (!pendingLogin) {
        req.flash('error', 'Please log in first.');
        return res.redirect('/login');
    }

    if (Date.now() > pendingLogin.expiresAt) {
        delete req.session.pendingLogin;
        req.flash('error', 'Your verification code expired. Please log in again.');
        return res.redirect('/login');
    }

    const expectedHash = Buffer.from(pendingLogin.otpHash, 'hex');
    const submittedHash = Buffer.from(hashOtp(otpCode), 'hex');
    const codeMatches = expectedHash.length === submittedHash.length && crypto.timingSafeEqual(expectedHash, submittedHash);

    if (codeMatches) {
        const sql = 'SELECT id, username, email, address, contact, role FROM users WHERE id = ?';
        db.query(sql, [pendingLogin.userId], (err, results) => {
            if (err) {
                throw err;
            }
            req.session.user = getSafeUser(results[0]);
            delete req.session.pendingLogin;
            req.flash('success', 'Login successful.');
            res.redirect('/home');
        });
    } else {
        pendingLogin.attempts = pendingLogin.attempts + 1;

        if (pendingLogin.attempts >= MAX_OTP_ATTEMPTS) {
            delete req.session.pendingLogin;
            req.flash('error', 'Too many incorrect attempts. Please log in again.');
            res.redirect('/login');
        } else {
            req.flash('error', 'Incorrect verification code.');
            res.redirect('/verify-otp');
        }
    }
});

app.post('/verify-otp/resend', (req, res) => {
    const pendingLogin = req.session.pendingLogin;

    if (!pendingLogin) {
        req.flash('error', 'Please log in first.');
        return res.redirect('/login');
    }

    const sql = 'SELECT * FROM users WHERE id = ?';
    db.query(sql, [pendingLogin.userId], async (err, results) => {
        if (err) {
            throw err;
        }
        const user = results[0];
        const otpCode = createOtpCode();
        const emailSent = await sendOtpEmail(user, otpCode);

        if (emailSent) {
            req.session.pendingLogin = {
                userId: user.id,
                otpHash: hashOtp(otpCode),
                expiresAt: Date.now() + OTP_EXPIRY_MS,
                attempts: 0,
                maskedEmail: maskEmail(user.email)
            };
            req.flash('success', 'A new verification code was sent.');
        } else {
            req.flash('error', 'Unable to resend the verification email.');
        }
        res.redirect('/verify-otp');
    });
});

// PROFILE
app.get('/profile', checkAuthenticated, (req, res) => {
    const userId = req.session.user.id;
    const acceptedSql = 'SELECT * FROM gigs WHERE accepted_by = ? ORDER BY gig_id DESC';
    db.query(acceptedSql, [userId], (err, acceptedGigs) => {
        if (err) {
            throw err;
        }
        const createdSql = 'SELECT * FROM gigs WHERE creator_id = ? ORDER BY gig_id DESC';
        db.query(createdSql, [userId], (err, createdGigs) => {
            if (err) {
                throw err;
            }
            res.render('profile', {
                user: req.session.user,
                acceptedGigs: acceptedGigs,
                createdGigs: createdGigs,
                messages: req.flash('success'),
                errors: req.flash('error')
            });
        });
    });
});

app.get('/dashboard', checkAuthenticated, (req, res) => {
    res.redirect('/profile');
});

// ADMIN PAGE
app.get('/admin', checkAuthenticated, checkAdmin, (req, res) => {
    const reportsSql = 'SELECT * FROM reports WHERE status = ? ORDER BY report_id DESC';
    const usersSql = 'SELECT id, username, role FROM users ORDER BY id';
    const gigsSql = 'SELECT * FROM gigs';

    db.query(reportsSql, ['pending'], (err, reports) => {
        if (err) {
            throw err;
        }
        db.query(usersSql, (err, users) => {
            if (err) {
                throw err;
            }
            db.query(gigsSql, (err, gigs) => {
                if (err) {
                    throw err;
                }

                let totalUsers = 0;
                let postedOnlyUsers = 0;
                let acceptedOnlyUsers = 0;
                let bothUsers = 0;
                let inactiveUsers = 0;

                for (let i = 0; i < users.length; i++) {
                    if (users[i].role !== 'admin') {
                        totalUsers = totalUsers + 1;
                        let postedGig = false;
                        let acceptedGig = false;

                        for (let j = 0; j < gigs.length; j++) {
                            if (gigs[j].creator_id == users[i].id) {
                                postedGig = true;
                            }
                            if (gigs[j].accepted_by == users[i].id) {
                                acceptedGig = true;
                            }
                        }

                        if (postedGig && acceptedGig) {
                            bothUsers = bothUsers + 1;
                        } else if (postedGig) {
                            postedOnlyUsers = postedOnlyUsers + 1;
                        } else if (acceptedGig) {
                            acceptedOnlyUsers = acceptedOnlyUsers + 1;
                        } else {
                            inactiveUsers = inactiveUsers + 1;
                        }
                    }
                }

                const totalGigs = gigs.length;
                let averageGigsPerUser = '0.00';

                if (totalUsers > 0) {
                    averageGigsPerUser = (totalGigs / totalUsers).toFixed(2);
                }

                res.render('admin', {
                    user: req.session.user,
                    reports: reports,
                    users: users,
                    totalUsers: totalUsers,
                    totalGigs: totalGigs,
                    averageGigsPerUser: averageGigsPerUser,
                    userActivity: {
                        postedOnlyUsers: postedOnlyUsers,
                        acceptedOnlyUsers: acceptedOnlyUsers,
                        bothUsers: bothUsers,
                        inactiveUsers: inactiveUsers
                    },
                    messages: req.flash('success'),
                    errors: req.flash('error')
                });
            });
        });
    });
});

// DELETE USER
app.post('/admin/users/:id/delete', checkAuthenticated, checkAdmin, (req, res) => {
    const userId = req.params.id;
    if (userId == req.session.user.id) {
        req.flash('error', 'You cannot delete your own account.');
        return res.redirect('/admin');
    }
    const reopenGigsSql = 'UPDATE gigs SET accepted_by = NULL, status = ? WHERE accepted_by = ?';
    db.query(reopenGigsSql, ['open', userId], (err, result) => {
        if (err) {
            throw err;
        }
        const clearCreatorSql = 'UPDATE gigs SET creator_id = NULL WHERE creator_id = ?';
        db.query(clearCreatorSql, [userId], (err, result) => {
            if (err) {
                throw err;
            }
            const deleteReportsSql = 'DELETE FROM reports WHERE user_id = ?';
            db.query(deleteReportsSql, [userId], (err, result) => {
                if (err) {
                    throw err;
                }
                const deleteUserSql = 'DELETE FROM users WHERE id = ?';
                db.query(deleteUserSql, [userId], (err, result) => {
                    if (err) {
                        throw err;
                    }
                    req.flash('success', 'User account deleted successfully.');
                    res.redirect('/admin');
                });
            });
        });
    });
});

// ACCEPT REPORT AND DELETE GIG
app.post('/admin/reports/:id/accept', checkAuthenticated, checkAdmin, (req, res) => {
    const reportId = req.params.id;
    const sql = 'SELECT gig_id FROM reports WHERE report_id = ?';
    db.query(sql, [reportId], (err, results) => {
        if (err) {
            throw err;
        }
        const gigId = results[0].gig_id;
        const deleteReportSql = 'DELETE FROM reports WHERE report_id = ?';
        db.query(deleteReportSql, [reportId], (err, result) => {
            if (err) {
                throw err;
            }
            const deleteGigSql = 'DELETE FROM gigs WHERE gig_id = ?';
            db.query(deleteGigSql, [gigId], (err, result) => {
                if (err) {
                    throw err;
                }
                req.flash('success', 'Report accepted and gig removed.');
                res.redirect('/admin');
            });
        });
    });
});

// DENY REPORT
app.post('/admin/reports/:id/deny', checkAuthenticated, checkAdmin, (req, res) => {
    const reportId = req.params.id;
    const sql = 'UPDATE reports SET status = ? WHERE report_id = ?';
    db.query(sql, ['denied', reportId], (err, result) => {
        if (err) {
            throw err;
        }
        req.flash('success', 'Report denied.');
        res.redirect('/admin');
    });
});

// CATEGORY PIE CHART DATA
app.get('/api/gig-category-chart', checkAuthenticated, checkAdmin, (req, res) => {
    const sql = 'SELECT category, COUNT(*) AS total FROM gigs GROUP BY category';
    db.query(sql, (err, results) => {
        if (err) {
            throw err;
        }
        res.json(results);
    });
});

// LOGOUT
app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/login');
});

// START SERVER
app.listen(PORT, () => {
    console.log('Server started on port ' + PORT);
});
