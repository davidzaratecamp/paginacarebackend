import express from 'express';
import mysql from 'mysql2/promise';
import jwt from 'jsonwebtoken';

const router = express.Router();

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

// Database connection
const createConnection = async () => {
  return await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'asistecare'
  });
};

// GET /api/blog - Get published blog posts
router.get('/', async (req, res) => {
  try {
    const connection = await createConnection();

    const category = req.query.category;
    const featured = req.query.featured;
    const limitParam = parseInt(String(req.query.limit || '10'), 10);
    const offsetParam = parseInt(String(req.query.offset || '0'), 10);
    const limit = isNaN(limitParam) ? 10 : limitParam;
    const offset = isNaN(offsetParam) ? 0 : offsetParam;

    let query = 'SELECT bp.*, a.name as authorName FROM blog_posts bp JOIN admins a ON bp.authorId = a.id WHERE bp.published = 1';
    const params = [];

    if (category && category !== 'all') {
      query += ' AND bp.category = ?';
      params.push(category);
    }

    if (featured === 'true') {
      query += ' AND bp.featured = 1';
    }

    query += ' ORDER BY bp.createdAt DESC LIMIT ?, ?';
    params.push(parseInt(offset), parseInt(limit));

    const [rows] = await connection.query(query, params);

    // Get total count for pagination
    let countQuery = 'SELECT COUNT(*) as total FROM blog_posts WHERE published = 1';
    const countParams = [];

    if (category && category !== 'all') {
      countQuery += ' AND category = ?';
      countParams.push(category);
    }

    if (featured === 'true') {
      countQuery += ' AND featured = 1';
    }

    const [countRows] = await connection.query(countQuery, countParams);
    const total = countRows[0].total;

    await connection.end();

    res.json({
      posts: rows,
      pagination: {
        total,
        limit,
        offset,
        hasMore: offset + limit < total
      }
    });

  } catch (error) {
    console.error('Error fetching blog posts:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/blog/admin/:id - Get a specific blog post by ID for admin editing (includes unpublished)
router.get('/admin/:id', authenticateToken, async (req, res) => {
  try {
    const postId = parseInt(req.params.id);

    if (isNaN(postId)) {
      return res.status(400).json({ error: 'Invalid post ID' });
    }

    const connection = await createConnection();

    const query = `
      SELECT bp.*, a.name as authorName, a.email as authorEmail
      FROM blog_posts bp 
      JOIN admins a ON bp.authorId = a.id 
      WHERE bp.id = ?
    `;

    const [rows] = await connection.query(query, [postId]);

    await connection.end();

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Blog post not found' });
    }

    res.json({ post: rows[0] });

  } catch (error) {
    console.error('Error fetching blog post for edit:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/blog/:slug - Get a specific blog post by slug
router.get('/:slug', async (req, res) => {
  try {
    const connection = await createConnection();
    const slug = req.params.slug;

    const query = `
      SELECT bp.*, a.name as authorName, a.email as authorEmail
      FROM blog_posts bp 
      JOIN admins a ON bp.authorId = a.id 
      WHERE bp.slug = ? AND bp.published = 1
    `;

    const [rows] = await connection.query(query, [slug]);

    if (rows.length === 0) {
      await connection.end();
      return res.status(404).json({ error: 'Blog post not found' });
    }

    const post = rows[0];

    // Increment views count
    await connection.query(
      'UPDATE blog_posts SET views = views + 1 WHERE id = ?',
      [post.id]
    );
    post.views = post.views + 1;

    // Get related posts (same category, excluding current post)
    const relatedQuery = `
      SELECT bp.id, bp.title, bp.slug, bp.excerpt, bp.image, bp.category, bp.createdAt, a.name as authorName
      FROM blog_posts bp 
      JOIN admins a ON bp.authorId = a.id 
      WHERE bp.category = ? AND bp.id != ? AND bp.published = 1
      ORDER BY bp.createdAt DESC 
      LIMIT 3
    `;

    const [relatedRows] = await connection.query(relatedQuery, [post.category, post.id]);

    await connection.end();

    res.json({
      post,
      relatedPosts: relatedRows
    });

  } catch (error) {
    console.error('Error fetching blog post:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/blog/categories/list - Get all blog categories
router.get('/categories/list', async (req, res) => {
  try {
    const connection = await createConnection();

    const query = `
      SELECT category, COUNT(*) as count 
      FROM blog_posts 
      WHERE published = 1 
      GROUP BY category 
      ORDER BY count DESC
    `;

    const [rows] = await connection.query(query);
    await connection.end();

    res.json({ categories: rows });

  } catch (error) {
    console.error('Error fetching categories:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/blog - Create a new blog post (admin only)
router.post('/', authenticateToken, async (req, res) => {
  try {
    const {
      title,
      slug,
      excerpt,
      content,
      image,
      category,
      tags,
      metaTitle,
      metaDescription,
      published = false,
      featured = false
    } = req.body;

    // Validation
    if (!title || !slug || !excerpt || !content || !category) {
      return res.status(400).json({
        error: 'Missing required fields',
        required: ['title', 'slug', 'excerpt', 'content', 'category']
      });
    }

    const connection = await createConnection();

    // Check if slug already exists
    const [existingRows] = await connection.query(
      'SELECT id FROM blog_posts WHERE slug = ?',
      [slug]
    );

    if (existingRows.length > 0) {
      await connection.end();
      return res.status(400).json({ error: 'El slug ya existe. Elige otro slug único.' });
    }

    // Calculate read time (roughly 200 words per minute)
    const wordCount = content.replace(/<[^>]*>/g, '').split(/\s+/).length;
    const readTime = Math.max(1, Math.ceil(wordCount / 200));

    const query = `
      INSERT INTO blog_posts (
        title, slug, excerpt, content, image, category, tags, metaTitle, metaDescription,
        published, featured, readTime, authorId, createdAt, updatedAt
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
    `;

    const [result] = await connection.query(query, [
      title,
      slug,
      excerpt,
      content,
      image || null,
      category,
      tags || null,
      metaTitle || title,
      metaDescription || excerpt,
      published ? 1 : 0,
      featured ? 1 : 0,
      readTime,
      req.user.id
    ]);

    await connection.end();

    res.status(201).json({
      message: 'Blog post created successfully',
      postId: result.insertId
    });

  } catch (error) {
    console.error('Error creating blog post:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/blog/:id - Update a blog post (admin only)
router.put('/:id', authenticateToken, async (req, res) => {
  try {
    const postId = parseInt(req.params.id);
    const {
      title,
      slug,
      excerpt,
      content,
      image,
      category,
      tags,
      metaTitle,
      metaDescription,
      published,
      featured
    } = req.body;

    if (isNaN(postId)) {
      return res.status(400).json({ error: 'Invalid post ID' });
    }

    const connection = await createConnection();

    // Check if slug exists for different post
    if (slug) {
      const [existingRows] = await connection.query(
        'SELECT id FROM blog_posts WHERE slug = ? AND id != ?',
        [slug, postId]
      );

      if (existingRows.length > 0) {
        await connection.end();
        return res.status(400).json({ error: 'El slug ya existe. Elige otro slug único.' });
      }
    }

    // Calculate read time if content is provided
    let readTime = null;
    if (content) {
      const wordCount = content.replace(/<[^>]*>/g, '').split(/\s+/).length;
      readTime = Math.max(1, Math.ceil(wordCount / 200));
    }

    // Build dynamic update query
    const updateFields = [];
    const updateValues = [];

    if (title) {
      updateFields.push('title = ?');
      updateValues.push(title);
    }
    if (slug) {
      updateFields.push('slug = ?');
      updateValues.push(slug);
    }
    if (excerpt) {
      updateFields.push('excerpt = ?');
      updateValues.push(excerpt);
    }
    if (content) {
      updateFields.push('content = ?');
      updateValues.push(content);
    }
    if (image !== undefined) {
      updateFields.push('image = ?');
      updateValues.push(image);
    }
    if (category) {
      updateFields.push('category = ?');
      updateValues.push(category);
    }
    if (tags !== undefined) {
      updateFields.push('tags = ?');
      updateValues.push(tags);
    }
    if (metaTitle) {
      updateFields.push('metaTitle = ?');
      updateValues.push(metaTitle);
    }
    if (metaDescription) {
      updateFields.push('metaDescription = ?');
      updateValues.push(metaDescription);
    }
    if (published !== undefined) {
      updateFields.push('published = ?');
      updateValues.push(published ? 1 : 0);
    }
    if (featured !== undefined) {
      updateFields.push('featured = ?');
      updateValues.push(featured ? 1 : 0);
    }
    if (readTime) {
      updateFields.push('readTime = ?');
      updateValues.push(readTime);
    }

    updateFields.push('updatedAt = NOW()');
    updateValues.push(postId);

    const query = `UPDATE blog_posts SET ${updateFields.join(', ')} WHERE id = ?`;

    const [result] = await connection.query(query, updateValues);

    if (result.affectedRows === 0) {
      await connection.end();
      return res.status(404).json({ error: 'Blog post not found' });
    }

    await connection.end();

    res.json({ message: 'Blog post updated successfully' });

  } catch (error) {
    console.error('Error updating blog post:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/blog/:id - Delete a blog post (admin only)
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const postId = parseInt(req.params.id);

    if (isNaN(postId)) {
      return res.status(400).json({ error: 'Invalid post ID' });
    }

    const connection = await createConnection();

    const [result] = await connection.query(
      'DELETE FROM blog_posts WHERE id = ?',
      [postId]
    );

    await connection.end();

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Blog post not found' });
    }

    res.json({ message: 'Blog post deleted successfully' });

  } catch (error) {
    console.error('Error deleting blog post:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;