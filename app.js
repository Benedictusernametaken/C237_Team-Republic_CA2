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

app.use(express.urlencoded({ extended: false }));
app.use(express.static('public'));

app.use(session({
    secret: 'secret',
    resave: false,
    saveUninitialized: true,
    // Session expires after 1 week of inactivity
    cookie: { maxAge: 1000 * 60 * 60 * 24 * 7 }
}));

app.use(flash());
app.set('view engine', 'ejs');

// Middleware to ensure the user is logged in.
const checkAuthenticated = (req, res, next) => {
    if (!req.session.user) {
        req.flash('error', 'Please log in to view this resource');
        return res.redirect('/login');
    }

    next();
};

// Middleware to ensure the user is an admin.
const checkAdmin = (req, res, next) => {
    if (req.session.user?.role !== 'admin') {
        req.flash('error', 'Access denied');
        return res.redirect('/dashboard');
    }

    next();
};

// Routes
app.get('/', (req, res) => {
    res.redirect('/login');
});

app.get('/home', checkAuthenticated, (req, res) => {
    const sql = "SELECT * FROM gigs WHERE status = 'open'";

    db.query(sql, (err, results) => {
        if (err) throw err;

        res.render('index', {
            user: req.session.user,
            messages: req.flash('success'),
            products: results
        });
    });
});

app.get('/gig/:id', checkAuthenticated, (req, res) => {
    const gigId = req.params.id;
    const sql = "SELECT * FROM gigs WHERE gig_id = ?";

    db.query(sql, [gigId], (err, results) => {
        if (err) throw err;

        if (results.length === 0) {
            return res.send("Gig not found");
        }

        res.render('gig', {
            user: req.session.user,
            gig: results[0]
        });
    });
});

app.get('/register', (req, res) => {
    res.render('register', {
        messages: req.flash('error'),
        formData: req.flash('formData')[0]
    });
});


//******** TODO: Create a middleware function validateRegistration ********//
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

    //If all validations pass, the next function is called, allowing the request to proceed to the
    //next middleware function or route handler.
    next();
};


//******** TODO: Integrate validateRegistration into the register route. ********//
app.post('/register', validateRegistration, (req, res) => {
    //******** TODO: Update register route to include role. ********//
    const { username, email, password, address, contact, role } = req.body;

    const sql =
        'INSERT INTO users (username, email, password, address, contact, role) VALUES (?, ?, SHA1(?), ?, ?, ?)';

    db.query(
        sql,
        [username, email, password, address, contact, role],
        (err, result) => {
            if (err) {
                throw err;
            }

            console.log(result);
            req.flash('success', 'Registration successful! Please log in.');
            res.redirect('/home');
        }
    );
});

//******** TODO: Insert code for login routes to render login page below ********//
app.get('/login', (req, res) => {
    res.render('login', {
        //retrieve success and error messages from the flash middleware and
        //pass them to the login view for display.
        messages: req.flash('success'),
        errors: req.flash('error')
    });
});


//******** TODO: Insert code for login routes for form submission below ********//
app.post('/login', (req, res) => {
    const { email, password } = req.body;

    // Validate email and password
    if (!email || !password) {
        req.flash('error', 'All fields are required.');
        return res.redirect('/login');
    }

    const sql =
        'SELECT * FROM users WHERE email = ? AND password = SHA1(?)';

    db.query(sql, [email, password], (err, results) => {
        if (err) {
            throw err;
        }

        if (results.length > 0) {
            // Successful login
            req.session.user = results[0]; // store user in session
            req.flash('success', 'Login successful!');
            res.redirect('/home');
        } else {
            // Invalid credentials
            req.flash('error', 'Invalid email or password.');
            res.redirect('/login');
        }
    });
});

//******** TODO: Insert code for dashboard route to render dashboard page for users. ********//
app.get('/dashboard', checkAuthenticated, (req, res) => {
    const userId = req.session.user.id;

    const userSql = `
        SELECT id, username, email, address, contact, role
        FROM users
        WHERE id = ?
    `;

    db.query(userSql, [userId], (err, userResults) => {
        if (err) {
            console.error('Error retrieving user:', err);
            return res.status(500).send('Unable to load dashboard');
        }

        if (userResults.length === 0) {
            return res.status(404).send('User not found');
        }

        const gigsSql = `
            SELECT *
            FROM gigs
            WHERE accepted_by = ?
        `;

        db.query(gigsSql, [userId], (err, gigResults) => {
            if (err) {
                console.error('Error retrieving gigs:', err);
                return res.status(500).send('Unable to load accepted gigs');
            }

            res.render('dashboard', {
                user: userResults[0],
                gigs: gigResults
            });
        });
    });
});

//******** TODO: Insert code for admin route to render dashboard page for admin. ********//
app.get('/admin', checkAdmin, (req, res) => {
    res.render('admin', { user: req.session.user });
});

app.get('/report/:id', checkAuthenticated, (req, res) => {
    const gigId = req.params.id;

    db.query(
        'SELECT * FROM gigs WHERE gig_id = ?',
        [gigId],
        (err, results) => {
            if (err) throw err;

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

//******** TODO: Insert code for logout route ********//
app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/login');
});

// Starting the server
app.listen(3000, () => {
    console.log('Server started on port 3000');
});