const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const path = require('path');
const crypto = require('crypto'); // Módulo nativo do Node.js para criptografia

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(cors());

// Configuração do Banco de Dados SQLite local
const dbFile = path.join(__dirname, 'estoque.db');
const db = new sqlite3.Database(dbFile, (err) => {
    if (err) {
        console.error('Erro ao abrir o banco de dados:', err.message);
    } else {
        console.log('Conectado ao banco de dados SQLite.');
        initDatabase();
    }
});

// Função para criptografar a senha com Salt (Segurança Avançada)
function hashPassword(password) {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.scryptSync(password, salt, 64).toString('hex');
    return `${salt}:${hash}`;
}

// Função para verificar se a senha digitada confere com o hash salvo
function verifyPassword(password, storedHash) {
    const [salt, key] = storedHash.split(':');
    const hash = crypto.scryptSync(password, salt, 64).toString('hex');
    return key === hash;
}

// Criação das tabelas e usuário Admin padrão
function initDatabase() {
    db.serialize(() => {
        db.run(`CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id TEXT UNIQUE,
            name TEXT,
            password TEXT,
            role TEXT
        )`);

        db.run(`CREATE TABLE IF NOT EXISTS products (
            id TEXT PRIMARY KEY,
            name TEXT,
            sku TEXT,
            category TEXT,
            price REAL,
            quantity INTEGER,
            min_stock INTEGER,
            updated_at TEXT
        )`);

        db.run(`CREATE TABLE IF NOT EXISTS movements (
            id TEXT PRIMARY KEY,
            product_id TEXT,
            product_name TEXT,
            type TEXT,
            quantity INTEGER,
            reason TEXT,
            user_name TEXT,
            date TEXT
        )`);

        // Cria o Administrador padrão caso não exista (ID: 91004500)
        db.get(`SELECT * FROM users WHERE user_id = ?`, ['91004500'], (err, row) => {
            if (!row) {
                const securePassword = hashPassword('Corinthians1910*');
                db.run(
                    `INSERT INTO users (user_id, name, password, role) VALUES (?, ?, ?, ?)`,
                    ['91004500', 'Administrador', securePassword, 'admin'],
                    (err) => {
                        if (!err) console.log('Usuário Administrador criado com senha criptografada (ID: 91004500)');
                    }
                );
            }
        });
    });
}

// 1. Rota de Autenticação (Login com verificação de senha criptografada)
app.post('/api/auth', (req, res) => {
    const { userId, password } = req.body;

    if (!userId || !password) {
        return res.status(400).json({ error: 'Informe o ID e a senha.' });
    }

    db.get(`SELECT * FROM users WHERE user_id = ?`, [userId], (err, user) => {
        if (err) {
            return res.status(500).json({ error: 'Erro interno no servidor.' });
        }

        if (!user || !verifyPassword(password, user.password)) {
            return res.status(401).json({ error: 'ID de acesso ou senha incorretos.' });
        }

        res.json({
            user: {
                id: user.user_id,
                name: user.name,
                role: user.role
            }
        });
    });
});

// 2. Rota para Cadastrar Novos Usuários (Com ID de 8 dígitos e criptografia)
app.post('/api/users', (req, res) => {
    const { userId, name, password, role } = req.body;

    // Validações básicas
    if (!userId || !/^\d{8}$/.test(userId)) {
        return res.status(400).json({ error: 'O ID de acesso deve conter exatamente 8 números.' });
    }
    if (!name || !password || !role) {
        return res.status(400).json({ error: 'Preencha todos os campos do usuário.' });
    }

    const securePassword = hashPassword(password);

    db.run(
        `INSERT INTO users (user_id, name, password, role) VALUES (?, ?, ?, ?)`,
        [userId, name, securePassword, role],
        function(err) {
            if (err) {
                return res.status(400).json({ error: 'Este ID de 8 dígitos já está cadastrado.' });
            }
            res.json({ success: true, message: 'Usuário cadastrado com sucesso!' });
        }
    );
});

// 3. Nova Rota para Alteração de Senha de forma segura
app.put('/api/users/password', (req, res) => {
    const { userId, oldPassword, newPassword } = req.body;

    if (!userId || !oldPassword || !newPassword) {
        return res.status(400).json({ error: 'Informe o ID, a senha antiga e a nova senha.' });
    }

    db.get(`SELECT * FROM users WHERE user_id = ?`, [userId], (err, user) => {
        if (err || !user) {
            return res.status(404).json({ error: 'Usuário não encontrado.' });
        }

        // Confere se a senha antiga está correta
        if (!verifyPassword(oldPassword, user.password)) {
            return res.status(401).json({ error: 'A senha atual está incorreta.' });
        }

        // Gera o hash seguro para a nova senha
        const secureNewPassword = hashPassword(newPassword);

        db.run(
            `UPDATE users SET password = ? WHERE user_id = ?`,
            [secureNewPassword, userId],
            (err) => {
                if (err) {
                    return res.status(500).json({ error: 'Erro ao atualizar a senha.' });
                }
                res.json({ success: true, message: 'Senha alterada com sucesso!' });
            }
        );
    });
});

// Rota para carregar dados do sistema
app.get('/api/data', (req, res) => {
    let responseData = { products: [], movements: [], users: [] };

    db.all(`SELECT * FROM products`, [], (err, products) => {
        if (!err) responseData.products = products;

        db.all(`SELECT * FROM movements ORDER BY date DESC`, [], (err, movements) => {
            if (!err) responseData.movements = movements;

            db.all(`SELECT user_id as id, name, role FROM users`, [], (err, users) => {
                if (!err) responseData.users = users;

                res.json(responseData);
            });
        });
    });
});

// Rota de Sincronização de Estoque
app.post('/api/sync', (req, res) => {
    const { products, movements } = req.body;

    if (products && Array.isArray(products)) {
        const stmt = db.prepare(`INSERT OR REPLACE INTO products (id, name, sku, category, price, quantity, min_stock, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
        products.forEach(p => {
            stmt.run(p.id, p.name, p.sku, p.category, p.price, p.quantity, p.min_stock, p.updated_at);
        });
        stmt.finalize();
    }

    if (movements && Array.isArray(movements)) {
        const stmtMov = db.prepare(`INSERT OR IGNORE INTO movements (id, product_id, product_name, type, quantity, reason, user_name, date) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
        movements.forEach(m => {
            stmtMov.run(m.id, m.product_id, m.product_name, m.type, m.quantity, m.reason, m.user_name, m.date);
        });
        stmtMov.finalize();
    }

    res.json({ success: true });
});

app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
});
