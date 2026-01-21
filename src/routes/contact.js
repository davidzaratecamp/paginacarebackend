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

// POST /api/contact - Submit contact form
router.post('/', async (req, res) => {
  try {
    const { name, phone, email, postalCode } = req.body;

    // Validation
    if (!name || !phone || !email || !postalCode) {
      return res.status(400).json({ 
        error: 'Missing required fields',
        required: ['name', 'phone', 'email', 'postalCode']
      });
    }

    // Email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ error: 'Invalid email format' });
    }

    // Postal code validation (5 digits)
    const postalCodeRegex = /^\d{5}$/;
    if (!postalCodeRegex.test(postalCode)) {
      return res.status(400).json({ error: 'Postal code must be 5 digits' });
    }

    const connection = await pool.getConnection();

    // Save to database
    const query = `
      INSERT INTO contacts (name, phone, email, postalCode, createdAt) 
      VALUES (?, ?, ?, ?, NOW())
    `;

    const [result] = await connection.execute(query, [name, phone, email, postalCode]);
    connection.release();

    // Send notification email
    if (process.env.SMTP_USER && process.env.CONTACT_EMAIL) {
      try {
        await transporter.sendMail({
          from: process.env.SMTP_USER,
          to: process.env.CONTACT_EMAIL,
          subject: 'Nuevo contacto desde la web - Asiste Health Care',
          html: `
            <h2>Nuevo contacto recibido</h2>
            <p><strong>Nombre:</strong> ${name}</p>
            <p><strong>Teléfono:</strong> ${phone}</p>
            <p><strong>Email:</strong> ${email}</p>
            <p><strong>Código Postal:</strong> ${postalCode}</p>
            <p><strong>Fecha:</strong> ${new Date().toLocaleString('es-ES')}</p>
            
            <hr>
            <p><em>Este mensaje fue enviado desde el formulario de contacto de asistehealth.com</em></p>
          `
        });
      } catch (emailError) {
        console.error('Error sending notification email:', emailError);
        // Don't fail the request if email fails
      }
    }

    res.status(201).json({
      message: 'Contact form submitted successfully',
      contactId: result.insertId
    });

  } catch (error) {
    console.error('Error processing contact form:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/contact - Get all contacts (admin only)
router.get('/', async (req, res) => {
  try {
    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 10;
    const offset = (page - 1) * limit;

    const connection = await pool.getConnection();

    const query = `
      SELECT * FROM contacts 
      ORDER BY createdAt DESC 
      LIMIT ?, ?
    `;

    const [contacts] = await connection.query(query, [offset, limit]);

    // Get total count
    const [countRows] = await connection.execute('SELECT COUNT(*) as total FROM contacts');
    const total = countRows[0].total;

    connection.release();

    res.json({
      contacts,
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

// DELETE /api/contact/:id - Delete a contact (admin only)
router.delete('/:id', async (req, res) => {
  try {
    const contactId = parseInt(req.params.id);

    if (isNaN(contactId)) {
      return res.status(400).json({ error: 'Invalid contact ID' });
    }

    const connection = await pool.getConnection();

    const [result] = await connection.execute(
      'DELETE FROM contacts WHERE id = ?',
      [contactId]
    );

    connection.release();

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Contact not found' });
    }

    res.json({ message: 'Contact deleted successfully' });

  } catch (error) {
    console.error('Error deleting contact:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;