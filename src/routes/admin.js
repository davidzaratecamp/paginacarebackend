import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import mysql from 'mysql2/promise';

const router = express.Router();

// Database connection
const createConnection = async () => {
  return await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'asistecare'
  });
};

// JWT middleware for protected routes
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  jwt.verify(token, process.env.JWT_SECRET || 'fallback-secret', (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid token' });
    }
    req.user = user;
    next();
  });
};

// POST /api/admin/auth - Admin login
router.post('/auth', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ 
        error: 'Username and password are required' 
      });
    }

    const connection = await createConnection();

    const query = 'SELECT * FROM admins WHERE username = ? AND active = 1';
    const [rows] = await connection.execute(query, [username]);

    await connection.end();

    if (rows.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const admin = rows[0];
    const validPassword = await bcrypt.compare(password, admin.password);

    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Generate JWT token
    const token = jwt.sign(
      { 
        id: admin.id, 
        username: admin.username,
        email: admin.email,
        name: admin.name 
      },
      process.env.JWT_SECRET || 'fallback-secret',
      { expiresIn: '24h' }
    );

    res.json({
      token,
      admin: {
        id: admin.id,
        username: admin.username,
        email: admin.email,
        name: admin.name
      }
    });

  } catch (error) {
    console.error('Error in admin login:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/admin/contacts - Get all contacts
router.get('/contacts', authenticateToken, async (req, res) => {
  try {
    const connection = await createConnection();
    
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;
    
    // Ensure values are valid integers
    if (isNaN(page) || isNaN(limit) || page < 1 || limit < 1) {
      return res.status(400).json({ error: 'Invalid page or limit parameters' });
    }

    const query = `
      SELECT * FROM contacts 
      ORDER BY createdAt DESC 
      LIMIT ?, ?
    `;

    const [rows] = await connection.query(query, [offset, limit]);

    // Get total count
    const [countRows] = await connection.execute('SELECT COUNT(*) as total FROM contacts');
    const total = countRows[0].total;

    await connection.end();

    res.json({
      contacts: rows,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    });

  } catch (error) {
    console.error('Error fetching contacts:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/admin/contacts/:id - Delete a contact
router.delete('/contacts/:id', authenticateToken, async (req, res) => {
  try {
    const contactId = parseInt(req.params.id);

    if (isNaN(contactId)) {
      return res.status(400).json({ error: 'Invalid contact ID' });
    }

    const connection = await createConnection();
    
    const [result] = await connection.execute(
      'DELETE FROM contacts WHERE id = ?',
      [contactId]
    );

    await connection.end();

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Contact not found' });
    }

    res.json({ message: 'Contact deleted successfully' });

  } catch (error) {
    console.error('Error deleting contact:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/admin/reviews - Get all reviews (admin)
router.get('/reviews', authenticateToken, async (req, res) => {
  try {
    const connection = await createConnection();
    
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;
    
    // Ensure values are valid integers
    if (isNaN(page) || isNaN(limit) || page < 1 || limit < 1) {
      return res.status(400).json({ error: 'Invalid page or limit parameters' });
    }
    const status = req.query.status;

    let query = 'SELECT * FROM reviews';
    const params = [];

    if (status === 'pending') {
      query += ' WHERE approved = 0';
    } else if (status === 'approved') {
      query += ' WHERE approved = 1';
    }

    query += ' ORDER BY createdAt DESC LIMIT ?, ?';
    params.push(offset, limit);

    const [rows] = await connection.query(query, params);

    // Get total count
    let countQuery = 'SELECT COUNT(*) as total FROM reviews';
    const countParams = [];
    
    if (status === 'pending') {
      countQuery += ' WHERE approved = 0';
    } else if (status === 'approved') {
      countQuery += ' WHERE approved = 1';
    }

    const [countRows] = await connection.execute(countQuery, countParams);
    const total = countRows[0].total;

    await connection.end();

    res.json({
      reviews: rows,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    });

  } catch (error) {
    console.error('Error fetching reviews:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/admin/reviews/:id/approve - Approve a review
router.put('/reviews/:id/approve', authenticateToken, async (req, res) => {
  try {
    const reviewId = parseInt(req.params.id);

    if (isNaN(reviewId)) {
      return res.status(400).json({ error: 'Invalid review ID' });
    }

    const connection = await createConnection();

    const [result] = await connection.execute(
      'UPDATE reviews SET approved = 1, updatedAt = NOW() WHERE id = ?',
      [reviewId]
    );

    if (result.affectedRows === 0) {
      await connection.end();
      return res.status(404).json({ error: 'Review not found' });
    }

    // Get the updated review
    const [rows] = await connection.execute(
      'SELECT * FROM reviews WHERE id = ?',
      [reviewId]
    );

    await connection.end();

    res.json({
      message: 'Review approved successfully',
      review: rows[0]
    });

  } catch (error) {
    console.error('Error approving review:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/admin/reviews/:id - Delete a review
router.delete('/reviews/:id', authenticateToken, async (req, res) => {
  try {
    const reviewId = parseInt(req.params.id);

    if (isNaN(reviewId)) {
      return res.status(400).json({ error: 'Invalid review ID' });
    }

    const connection = await createConnection();

    const [result] = await connection.execute(
      'DELETE FROM reviews WHERE id = ?',
      [reviewId]
    );

    await connection.end();

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Review not found' });
    }

    res.json({ message: 'Review deleted successfully' });

  } catch (error) {
    console.error('Error deleting review:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;