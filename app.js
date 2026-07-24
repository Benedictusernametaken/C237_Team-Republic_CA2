require('dotenv').config();
const express = require('express');
const mysql = require('mysql2');
const session = require('express-session');
const flash = require('connect-flash');
const app = express();

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

// Middleware setup
app.use(express.urlencoded({ extended: false }));
app.use(express.static('public'));

app.use(session({
    secret: 'secret',
    resave: false,
    saveUninitialized: true,
    cookie: { maxAge: 1000 * 60 * 60 * 24 * 7 }
}));

app.use(flash());
app.set('view engine', 'ejs');

// Import auth routes and the shared middleware function
const authModule = require('./authRoutes')(db);
const authRoutes = authModule.router;
const checkAuthenticated = authModule.checkAuthenticated;
const checkAdmin = authModule.checkAdmin;

// --- APP & FEATURE ROUTES ---

const validateGig = (req, res, next) => {
    const gig = {
        title: req.body.title ? req.body.title.trim() : '',
        description: req.body.description ? req.body.description.trim() : '',
        cash: req.body.cash ? req.body.cash.trim() : '',
        image: req.body.image ? req.body.image.trim() : '',
        category: req.body.category ? req.body.category.trim() : ''
    };

    let error;
    if (!gig.title || !gig.description || !gig.cash || !gig.image || !gig.category) {
        error = 'Please fill in all fields.';
    } else if (gig.title.length > 45 || gig.category.length > 45) {
        error = 'The title and category must each be 45 characters or fewer.';
    } else if (gig.description.length > 1000 || gig.image.length > 1000) {
        error = 'The description and image filename must each be 1000 characters or fewer.';
    } else if (!Number.isInteger(Number(gig.cash)) || Number(gig.cash) <= 0) {
        error = 'Payment must be a whole number greater than $0.';
    }

    req.gig = gig;
    req.gigValidationError = error;
    next();
};

app.get('/jobs/create', checkAuthenticated, (req, res) => {
    res.render('job-create', {
        user: req.session.user,
        errors: req.flash('error'),
        formData: req.flash('formData')[0] || {}
    });
});

app.post('/jobs/create', checkAuthenticated, validateGig, (req, res) => {
    if (req.gigValidationError) {
        req.flash('error', req.gigValidationError);
        req.flash('formData', req.gig);
        return res.redirect('/jobs/create');
    }

    const { title, description, cash, image, category } = req.gig;
    const creatorId = req.session.user.id;
    const sql = `
        INSERT INTO gigs
            (gig_id, creator_id, accepted_by, title, description, cash, image, category, status)
        SELECT COALESCE(MAX(gig_id), 0) + 1, ?, NULL, ?, ?, ?, ?, ?, 'open'
        FROM gigs
    `;

    db.query(sql, [creatorId, title, description, cash, image, category], (err) => {
        if (err) {
            console.error('Error creating gig:', err);
            req.flash('error', 'Unable to create the gig. Please try again.');
            req.flash('formData', req.gig);
            return res.redirect('/jobs/create');
        }

        req.flash('success', 'Gig created successfully.');
        res.redirect('/home');
    });
});

app.get('/jobs/edit/:id', checkAuthenticated, (req, res) => {
    const sql = 'SELECT * FROM gigs WHERE gig_id = ? AND creator_id = ?';
    db.query(sql, [req.params.id, req.session.user.id], (err, results) => {
        if (err) {
            console.error('Error loading gig for editing:', err);
            req.flash('error', 'Unable to load the gig.');
            return res.redirect('/home');
        }
        if (results.length === 0) {
            req.flash('error', 'Gig not found or you do not have permission to edit it.');
            return res.redirect('/home');
        }

        res.render('job-edit', {
            user: req.session.user,
            gig: results[0],
            errors: req.flash('error')
        });
    });
});

app.post('/jobs/edit/:id', checkAuthenticated, validateGig, (req, res) => {
    if (req.gigValidationError) {
        req.flash('error', req.gigValidationError);
        return res.redirect(`/jobs/edit/${req.params.id}`);
    }

    const { title, description, cash, image, category } = req.gig;
    const sql = `
        UPDATE gigs
        SET title = ?, description = ?, cash = ?, image = ?, category = ?
        WHERE gig_id = ? AND creator_id = ?
    `;
    const params = [
        title, description, cash, image, category,
        req.params.id, req.session.user.id
    ];

    db.query(sql, params, (err, result) => {
        if (err) {
            console.error('Error updating gig:', err);
            req.flash('error', 'Unable to update the gig. Please try again.');
            return res.redirect(`/jobs/edit/${req.params.id}`);
        }
        if (result.affectedRows === 0) {
            req.flash('error', 'Gig not found or you do not have permission to edit it.');
            return res.redirect('/home');
        }

        req.flash('success', 'Gig updated successfully.');
        res.redirect('/home');
    });
});

app.post('/jobs/delete/:id', checkAuthenticated, (req, res) => {
    const sql = 'DELETE FROM gigs WHERE gig_id = ? AND creator_id = ?';
    db.query(sql, [req.params.id, req.session.user.id], (err, result) => {
        if (err) {
            console.error('Error deleting gig:', err);
            req.flash('error', 'Unable to delete the gig. It may already have related activity.');
            return res.redirect('/home');
        }
        if (result.affectedRows === 0) {
            req.flash('error', 'Gig not found or you do not have permission to delete it.');
            return res.redirect('/home');
        }

        req.flash('success', 'Gig deleted successfully.');
        res.redirect('/home');
    });
});

app.get('/gig/:id', checkAuthenticated, (req, res) => {
    const gigId = req.params.id;
    const sql = "SELECT * FROM gigs WHERE gig_id = ?";
    db.query(sql, [gigId], (err, results) => {
        if (err) {
            console.error('Error fetching gig:', err);
            req.flash('error', 'Something went wrong loading this gig. Please try again.');
            return res.redirect('/home');
        }
        if (results.length === 0) {
            return res.send("Gig not found");
        }
        res.render('gig', {
            user: req.session.user,
            gig: results[0]
        });
    });
});

// Accept a gig
app.post('/gig/:id/accept', checkAuthenticated, (req, res) => {
    const gigId = req.params.id;
    const userId = req.session.user.id;

    const sql = `
        UPDATE gigs
        SET accepted_by = ?,
            status = 'closed'
        WHERE gig_id = ?
          AND status = 'open'
          AND accepted_by IS NULL
    `;

    db.query(sql, [userId, gigId], (err, result) => {
        if (err) {
            console.error('Error accepting gig:', err);
            req.flash('error', 'Unable to accept gig.');
            return res.redirect(`/gig/${gigId}`);
        }

        if (result.affectedRows === 0) {
            req.flash('error', 'This gig is no longer available.');
            return res.redirect('/home');
        }

        req.flash('success', 'Gig accepted successfully.');
        res.redirect('/dashboard');
    });
});

app.get('/report/:id', checkAuthenticated, (req, res) => {
    const gigId = req.params.id;

    db.query(
        'SELECT * FROM gigs WHERE gig_id = ?',
        [gigId],
        (err, results) => {
            if (err) {
                console.error('Error fetching gig for report:', err);
                req.flash('error', 'Something went wrong. Please try again.');
                return res.redirect('/home');
            }

            if (results.length === 0) {
                return res.send("Gig not found");
            }

            res.render('report', {
                gig: results[0]
            });
        }
    );
});

app.post('/report', checkAuthenticated, (req, res) => {
    const reason = req.body.reason;
    const comment = req.body.comment;
    const gigId = req.body.gig_id;
    const userId = req.session.user.id;

    if (!userId) {
        req.flash('error', 'Please log in again to submit a report.');
        return res.redirect('/login');
    }

    if (!gigId) {
        req.flash('error', 'Invalid gig selected.');
        return res.redirect('/home');
    }

    db.query(
        'INSERT INTO reports (reason, comment, gig_id, user_id, status) VALUES (?, ?, ?, ?, ?)',
        [reason, comment || null, gigId, userId, 'pending'],
        (err) => {
            if (err) {
                console.error('Error submitting report:', err);
                req.flash('error', 'Unable to submit report. Please try again.');
                return res.redirect('/home');
            }

            req.flash('success', 'Report submitted successfully.');
            res.redirect('/home');
        }
    );
});

app.use('/', authRoutes);

//Admin
app.get('/api/gig-category-chart', checkAdmin, (req, res) => {

    const sql = `
        SELECT category,
               COUNT(*) AS total
        FROM gigs
        GROUP BY category
    `;

    db.query(sql, (err, results) => {
        if (err) {
            console.error(err);
            return res.status(500).json(err);
        }

        res.json(results);
    });

});

//******** TODO: Insert code for logout route ********//
app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/login');
});

// Starting the server
const port = process.env.PORT || 3000;
app.listen(port, () => {
    console.log(`Server started on port ${port}`);
});
