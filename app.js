require('dotenv').config();
const express = require('express');
const mysql = require('mysql2');
const session = require('express-session');
const flash = require('connect-flash');

const app = express();

// Database connection
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

// Setting up EJS
app.set('view engine', 'ejs');

// Import and mount the auth routes (Make sure the path matches your folder structure, e.g., './routes/authRoutes')
const authRoutes = require('./authRoutes')(db);
app.use('/', authRoutes);

// Starting the server
app.listen(3000, () => {
    console.log('Server started on port 3000');
});