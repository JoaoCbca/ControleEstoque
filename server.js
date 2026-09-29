const express = require('express');
const { Pool } = require('pg');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Configuração do Banco de Dados
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Criar tabelas automaticamente se não existirem
async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id VARCHAR(50) PRIMARY KEY,
      name VARCHAR(100),
      user_id VARCHAR(8) UNIQUE,
      password VARCHAR(100)
    );
    CREATE TABLE IF NOT EXISTS products (
      id VARCHAR(50) PRIMARY KEY,
      name VARCHAR(150),
      sku VARCHAR(50),
      category VARCHAR(100),
      price NUMERIC(10,2),
      quantity INT,
      min_stock INT,
      updated_at TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS movements (
      id VARCHAR(50) PRIMARY KEY,
      product_id VARCHAR(50),
      product_name VARCHAR(150),
      type VARCHAR(20),
      quantity INT,
      reason TEXT,
      user_name VARCHAR(100),
      date TIMESTAMP
    );
  `);
}
initDB();

// Rota para buscar dados
app.get('/api/data', async (req, res) => {
  try {
    const users = await pool.query('SELECT id, name, user_id FROM users');
    const products = await pool.query('SELECT * FROM products');
    const movements = await pool.query('SELECT * FROM movements ORDER BY date DESC');
    res.json({
      users: users.rows,
      products: products.rows,
      movements: movements.rows
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Rota de Autenticação (Apenas Login para usuários pré-cadastrados no Banco)
app.post('/api/auth', async (req, res) => {
  const { userId, password } = req.body;
  
  if (!userId || !/^\d{8}$/.test(userId)) {
    return res.status(400).json({ error: 'ID de acesso inválido. Deve conter exatamente 8 dígitos numéricos.' });
  }

  try {
    const result = await pool.query('SELECT * FROM users WHERE user_id = $1 AND password = $2', [userId, password]);
    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'ID ou senha incorretos, ou usuário não autorizado.' });
    }
    
    const user = result.rows[0];
    return res.json({ success: true, user: { id: user.id, name: user.name, user_id: user.user_id } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Rota para salvar/sincronizar alterações — Protegida por validação de usuário
app.post('/api/sync', async (req, res) => {
  const { user, products, movements } = req.body;

  if (!user || !user.user_id) {
    return res.status(403).json({ error: 'Acesso negado. É necessário estar autenticado.' });
  }

  const client = await pool.connect();
  
  try {
    const userCheck = await client.query('SELECT * FROM users WHERE user_id = $1', [user.user_id]);
    if (userCheck.rows.length === 0) {
      return res.status(403).json({ error: 'Usuário não autorizado.' });
    }

    await client.query('BEGIN');

    // 1. Sincronizar Produtos
    if (products && Array.isArray(products)) {
      for (const prod of products) {
        await client.query(
          `INSERT INTO products (id, name, sku, category, price, quantity, min_stock, updated_at) 
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8) 
           ON CONFLICT (id) DO UPDATE 
           SET name = EXCLUDED.name, sku = EXCLUDED.sku, category = EXCLUDED.category, 
               price = EXCLUDED.price, quantity = EXCLUDED.quantity, 
               min_stock = EXCLUDED.min_stock, updated_at = EXCLUDED.updated_at`,
          [prod.id, prod.name, prod.sku, prod.category, prod.price, prod.quantity, prod.min_stock, prod.updated_at]
        );
      }
    }

    // 2. Sincronizar Movimentações
    if (movements && Array.isArray(movements)) {
      for (const mov of movements) {
        await client.query(
          `INSERT INTO movements (id, product_id, product_name, type, quantity, reason, user_name, date) 
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8) 
           ON CONFLICT (id) DO NOTHING`,
          [mov.id, mov.product_id, mov.product_name, mov.type, mov.quantity, mov.reason, mov.user_name, mov.date]
        );
      }
    }

    await client.query('COMMIT');
    res.json({ success: true, message: 'Dados sincronizados com segurança!' });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
