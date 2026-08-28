// config/db.js
// -----------------------------------------------------------------
// MySQL/MariaDB Connection Pool (แทน Supabase)
// ใช้ mysql2/promise เพื่อให้ได้ async/await syntax
// -----------------------------------------------------------------

const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'key_borrow_db',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  enableKeepAlive: true,
  keepAliveInitialDelayMs: 0,
  multipleStatements: false,
});

// Test connection
pool.getConnection()
  .then((connection) => {
    console.log('✅ MySQL Connected successfully');
    connection.release();
  })
  .catch((err) => {
    console.error('❌ MySQL Connection Error:', err.message);
    process.exit(1);
  });

module.exports = pool;
