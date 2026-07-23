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
const validateRegistration = authModule.validateRegistration;

// --- APP & FEATURE ROUTES ---

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
app.listen(3000, () => {
    console.log('Server started on port 3000');
});