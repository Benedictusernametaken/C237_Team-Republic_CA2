require('dotenv').config();
const express = require('express');
const mysql = require('mysql2');
const session = require('express-session');
const flash = require('connect-flash');
const app = express();

// --- DATABASE CONNECTION ---
const db = mysql.createConnection({
    host: process.env.DB_HOST || 'c237-eaint-mysql.mysql.database.azure.com',
    user: process.env.DB_USER || 'c237_001',
    password: process.env.DB_PASSWORD || 'c237001@2026!',
    database: process.env.DB_NAME || 'c237_001_teamrepublic',
    ssl: {
        rejectUnauthorized: true
    }
});

db.connect((err) => {
    if (err) {
        console.error('Database connection failed:', err);
        throw err;
    }
    console.log('Connected to MySQL database successfully.');
});

// --- MIDDLEWARE SETUP ---
app.use(express.urlencoded({ extended: false }));
app.use(express.json());
app.use(express.static('public'));

app.use(session({
    secret: process.env.SESSION_SECRET || 'secret',
    resave: false,
    saveUninitialized: true,
    cookie: { maxAge: 1000 * 60 * 60 * 24 * 7 } // 7 days
}));

app.use(flash());
app.set('view engine', 'ejs');

// --- AUTH & ROUTE MODULE IMPORT ---
const authModule = require('./authRoutes')(db);
const authRoutes = authModule.router;
const checkAuthenticated = authModule.checkAuthenticated;
const checkAdmin = authModule.checkAdmin;

// --- GIG & REPORT ROUTES ---

// View specific gig details
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
            return res.status(404).send("Gig not found");
        }
        res.render('gig', {
            user: req.session.user,
            gig: results[0]
        });
    });
});

// Load gig report page
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
                return res.status(404).send("Gig not found");
            }

            res.render('report', {
                gig: results[0]
            });
        }
    );
});

// Submit a gig report
app.post('/report', checkAuthenticated, (req, res) => {
    const reason = req.body.reason;
    const comment = req.body.comment;
    const gigId = req.body.gig_id;
    const userId = req.session.user ? req.session.user.id : null;

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

// --- ADMIN API ROUTES ---

// API Endpoint for Admin Dashboard Pie Chart
app.get('/api/gig-category-chart', checkAdmin, (req, res) => {
    const sql = `
        SELECT category, COUNT(*) AS total
        FROM gigs
        GROUP BY category
    `;

    db.query(sql, (err, results) => {
        if (err) {
            console.error('Error fetching gig categories for chart:', err);
            return res.status(500).json({ error: 'Internal Server Error' });
        }

        res.json(results);
    });
});

// --- AUTH & USER MANAGEMENT ROUTES ---
// Mount authentication, admin panel, search, filter, and ban/unban routes
app.use('/', authRoutes);

// --- SERVER INITIALIZATION ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server started on port ${PORT}`);
});