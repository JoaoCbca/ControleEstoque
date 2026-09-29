const express = require('express');
const { Pool } = require('pg');
const path = require('path');

const app = express();
app.use(express.json());
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

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

// Rotas para buscar dados
app.get('/api/data', async (req, res) => {
  try {
    const users = await pool.query('SELECT * FROM users');
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

// Rota para salvar/sincronizar alterações do front-end
app.post('/api/sync', async (req, res) => {
  const { users, products, movements } = req.body;
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');

    // 1. Sincronizar Usuários (Insere ou atualiza se já existir)
    if (users && Array.isArray(users)) {
      for (const user of users) {
        await client.query(
          `INSERT INTO users (id, name, user_id, password) 
           VALUES ($1, $2, $3, $4) 
           ON CONFLICT (id) DO UPDATE 
           SET name = EXCLUDED.name, user_id = EXCLUDED.user_id, password = EXCLUDED.password`,
          [user.id, user.name, user.user_id, user.password]
        );
      }
    }

    // 2. Sincronizar Produtos (Insere ou atualiza se já existir)
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

    // 3. Sincronizar Movimentações (Insere apenas se não existir para evitar duplicidade)
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
    res.json({ success: true, message: 'Dados sincronizados com sucesso!' });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
