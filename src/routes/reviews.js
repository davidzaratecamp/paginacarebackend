import express from 'express';
import nodemailer from 'nodemailer';
import pool from '../config/database.js';

const router = express.Router();

// Nodemailer configuration
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT || '587'),
  secure: process.env.SMTP_SECURE === 'true',
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

// GET /api/reviews - Get approved reviews
router.get('/', async (req, res) => {
  try {
    const connection = await pool.getConnection();

    const query = `
      SELECT * FROM reviews 
      WHERE approved = 1 
      ORDER BY createdAt DESC 
      LIMIT 50
    `;

    const [reviews] = await connection.execute(query);
    connection.release();

    res.json({ reviews });

  } catch (error) {
    console.error('Error fetching reviews:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/reviews - Submit a new review
router.post('/', async (req, res) => {
  try {
    const { name, email, rating, comment } = req.body;

    // Validation
    if (!name || !email || !rating || !comment) {
      return res.status(400).json({ 
        error: 'Missing required fields',
        required: ['name', 'email', 'rating', 'comment']
      });
    }

    // Email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ error: 'Invalid email format' });
    }

    // Rating validation
    const ratingNum = parseInt(rating);
    if (isNaN(ratingNum) || ratingNum < 1 || ratingNum > 5) {
      return res.status(400).json({ error: 'Rating must be between 1 and 5' });
    }

    // Comment validation
    if (comment.length < 10) {
      return res.status(400).json({ error: 'Comment must be at least 10 characters long' });
    }

    if (comment.length > 1000) {
      return res.status(400).json({ error: 'Comment must be less than 1000 characters' });
    }

    const connection = await pool.getConnection();

    // Save to database (pending approval)
    const query = `
      INSERT INTO reviews (name, email, rating, comment, approved, createdAt, updatedAt) 
      VALUES (?, ?, ?, ?, 0, NOW(), NOW())
    `;

    const [result] = await connection.execute(query, [name, email, ratingNum, comment]);
    connection.release();

    // Send notification email to admin
    if (process.env.SMTP_USER && process.env.CONTACT_EMAIL) {
      try {
        await transporter.sendMail({
          from: process.env.SMTP_USER,
          to: process.env.CONTACT_EMAIL,
          subject: 'Nueva reseña pendiente de aprobación - Asiste Health Care',
          html: `
            <h2>Nueva reseña recibida</h2>
            <p><strong>Nombre:</strong> ${name}</p>
            <p><strong>Email:</strong> ${email}</p>
            <p><strong>Calificación:</strong> ${rating}/5 ⭐</p>
            <p><strong>Comentario:</strong></p>
            <blockquote style="border-left: 4px solid #ccc; padding-left: 16px; margin: 16px 0; font-style: italic;">
              ${comment}
            </blockquote>
            <p><strong>Fecha:</strong> ${new Date().toLocaleString('es-ES')}</p>
            
            <hr>
            <p><em>Esta reseña está pendiente de aprobación. Puedes aprobarla desde el panel de administración.</em></p>
          `
        });
      } catch (emailError) {
        console.error('Error sending notification email:', emailError);
        // Don't fail the request if email fails
      }
    }

    res.status(201).json({
      message: 'Review submitted successfully and is pending approval',
      reviewId: result.insertId
    });

  } catch (error) {
    console.error('Error processing review:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/reviews/admin - Get all reviews (admin only)
router.get('/admin', async (req, res) => {
  try {
    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 10;
    const offset = (page - 1) * limit;
    const status = req.query.status;

    const connection = await pool.getConnection();

    let query = 'SELECT * FROM reviews';
    const params = [];

    if (status === 'pending') {
      query += ' WHERE approved = 0';
    } else if (status === 'approved') {
      query += ' WHERE approved = 1';
    }

    query += ' ORDER BY createdAt DESC LIMIT ?, ?';
    params.push(offset, limit);
    
    const [reviews] = await connection.query(query, params);

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

    connection.release();

    res.json({
      reviews,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    });

  } catch (error) {
    console.error('Error fetching admin reviews:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/reviews/:id/approve - Approve a review (admin only)
router.put('/:id/approve', async (req, res) => {
  try {
    const reviewId = parseInt(req.params.id);

    if (isNaN(reviewId)) {
      return res.status(400).json({ error: 'Invalid review ID' });
    }

    const connection = await pool.getConnection();

    const [result] = await connection.execute(
      'UPDATE reviews SET approved = 1, updatedAt = NOW() WHERE id = ?',
      [reviewId]
    );

    if (result.affectedRows === 0) {
      connection.release();
      return res.status(404).json({ error: 'Review not found' });
    }

    // Get the updated review
    const [rows] = await connection.execute(
      'SELECT * FROM reviews WHERE id = ?',
      [reviewId]
    );

    connection.release();

    res.json({
      message: 'Review approved successfully',
      review: rows[0]
    });

  } catch (error) {
    console.error('Error approving review:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/reviews/:id - Delete a review (admin only)
router.delete('/:id', async (req, res) => {
  try {
    const reviewId = parseInt(req.params.id);

    if (isNaN(reviewId)) {
      return res.status(400).json({ error: 'Invalid review ID' });
    }

    const connection = await pool.getConnection();

    const [result] = await connection.execute(
      'DELETE FROM reviews WHERE id = ?',
      [reviewId]
    );

    connection.release();

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