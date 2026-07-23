/**
 * Database layer — SQLite in development/small scale.
 * Swap out the adapter for Postgres/Supabase by replacing this file
 * while keeping the same exported function signatures.
 */

const path = require('path');
const Database = require('better-sqlite3');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'emailgenie.db');

// Ensure the data directory exists
const fs = require('fs');
const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

let db;
try {
    db = new Database(DB_PATH);
} catch (err) {
    console.error(`[db] Failed to open database at ${DB_PATH}:`, err.message);
    process.exit(1);
}

// Enable WAL mode for better concurrent read performance
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ── Schema ─────────────────────────────────────────────────────────────────
db.exec(`
    CREATE TABLE IF NOT EXISTS users (
        id             TEXT PRIMARY KEY,
        name           TEXT NOT NULL,
        email          TEXT NOT NULL,
        phone          TEXT NOT NULL,
        carrier        TEXT NOT NULL,
        corrlinks_email TEXT,
        inmate_name    TEXT,
        bridge_email   TEXT UNIQUE,
        status         TEXT NOT NULL DEFAULT 'pending',
        created_at     TEXT NOT NULL DEFAULT (datetime('now')),
        activated_at   TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_users_bridge_email ON users(bridge_email);
    CREATE INDEX IF NOT EXISTS idx_users_phone ON users(phone);
    CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);
`);

// ── Carrier gateway map ────────────────────────────────────────────────────
const CARRIER_GATEWAYS = {
    verizon:      'vtext.com',
    att:          'txt.att.net',
    tmobile:      'tmomail.net',
    sprint:       'messaging.sprintpcs.com',
    cricket:      'sms.cricketwireless.net',
    boost:        'sms.myboostmobile.com',
    metro:        'mymetropcs.com',
    straighttalk: 'vtext.com',
    uscellular:   'email.uscc.net',
    other:        'vtext.com'
};

function getSmsEmail(phone, carrier) {
    const cleanPhone = phone.replace(/\D/g, '');
    const gateway = CARRIER_GATEWAYS[carrier] || CARRIER_GATEWAYS.other;
    return `${cleanPhone}@${gateway}`;
}

// ── User CRUD ──────────────────────────────────────────────────────────────

function createUser(data) {
    const stmt = db.prepare(`
        INSERT INTO users (id, name, email, phone, carrier, corrlinks_email, inmate_name, bridge_email, status, created_at)
        VALUES (@id, @name, @email, @phone, @carrier, @corrlinks_email, @inmate_name, @bridge_email, @status, @created_at)
    `);
    stmt.run({
        id:              data.id,
        name:            data.name,
        email:           data.email,
        phone:           data.phone.replace(/\D/g, ''),
        carrier:         data.carrier,
        corrlinks_email: data.corrlinks_email || null,
        inmate_name:     data.inmate_name || null,
        bridge_email:    data.bridge_email || null,
        status:          data.status || 'pending',
        created_at:      data.created_at || new Date().toISOString()
    });
    return getUserById(data.id);
}

function getUserById(id) {
    return db.prepare('SELECT * FROM users WHERE id = ?').get(id) || null;
}

function getUserByBridgeEmail(bridgeEmail) {
    return db.prepare('SELECT * FROM users WHERE bridge_email = ?').get(bridgeEmail) || null;
}

function getUserByPhone(phone) {
    const clean = phone.replace(/\D/g, '');
    return db.prepare('SELECT * FROM users WHERE phone = ?').get(clean) || null;
}

function getAllUsers() {
    return db.prepare('SELECT * FROM users ORDER BY created_at DESC').all();
}

function getPendingUsers() {
    return db.prepare("SELECT * FROM users WHERE status = 'pending' ORDER BY created_at DESC").all();
}

function getActiveUsers() {
    return db.prepare("SELECT * FROM users WHERE status = 'active' ORDER BY activated_at DESC").all();
}

function activateUser(id, bridgeEmail) {
    db.prepare(`
        UPDATE users
        SET bridge_email = ?, status = 'active', activated_at = datetime('now')
        WHERE id = ?
    `).run(bridgeEmail, id);
    return getUserById(id);
}

function deleteUser(id) {
    db.prepare('DELETE FROM users WHERE id = ?').run(id);
}

module.exports = {
    db,
    createUser,
    getUserById,
    getUserByBridgeEmail,
    getUserByPhone,
    getAllUsers,
    getPendingUsers,
    getActiveUsers,
    activateUser,
    deleteUser,
    getSmsEmail,
    CARRIER_GATEWAYS
};
