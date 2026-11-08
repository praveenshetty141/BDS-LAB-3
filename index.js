const express = require('express');
const path = require('path');
const { open } = require('sqlite');
const sqlite3 = require('sqlite3');

const app = express();
const PORT = process.env.PORT || 3000;
const dbPath = path.join(__dirname, 'books.db');

let db = null;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const ALLOWED_COLUMNS = ['id', 'title', 'author', 'price', 'pages'];
const ALLOWED_ORDERS = ['ASC', 'DESC'];
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 100;
const QUERY_KEYS = ['search_q', 'order_by', 'order', 'limit', 'offset', 'min_price', 'max_price'];

// Built-in middleware to parse JSON request bodies
app.use(express.json());

// Enable CORS for Postman Web, frontend apps, and external API clients
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

// Request Logger middleware
app.use((req, res, next) => {
  res.on('finish', () => {
    console.log(`[${new Date().toLocaleTimeString()}] ${req.method} ${req.originalUrl} -> ${res.statusCode}`);
  });
  next();
});

// Root Route: API Overview
app.get('/', (req, res) => {
  res.status(200).json({
    message: 'Welcome to the Books REST API (Lab 3)',
    documentation: {
      endpoints: {
        'GET /books': 'Search, filter by price, sort, and paginate books',
        'GET /books/:bookId': 'Retrieve a specific book by ID',
        'POST /books': 'Create a new book record (validation enforced)',
        'PUT /books/:bookId': 'Update an existing book record',
        'DELETE /books/:bookId': 'Delete a book record by ID'
      },
      queryParamsForGetBooks: {
        search_q: 'Partial title search string (default: "")',
        order_by: 'Sort column: id, title, author, price, pages (default: id)',
        order: 'Sort direction: ASC or DESC (default: ASC)',
        limit: `Number of records per page, 1 to ${MAX_LIMIT} (default: ${DEFAULT_LIMIT})`,
        offset: 'Number of records to skip (default: 0)',
        min_price: 'Minimum price filter',
        max_price: 'Maximum price filter'
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Every unexpected database error is logged on the server only.
// The client always gets the same safe { message } (no SQL or file details leak).
const sendServerError = (res, error) => {
  console.error('Database error:', error);
  return res.status(500).json({ message: 'Internal server error' });
};

// "12" -> 12 ; "abc", "0", "-3", "1.5", "1e3" -> null
const parseBookId = (raw) => {
  if (typeof raw !== 'string' || !/^[1-9]\d*$/.test(raw)) return null;
  const id = Number(raw);
  return Number.isSafeInteger(id) ? id : null;
};

// Escape % and _ so a search for "50%" matches the text "50%" and not "50 + anything"
const escapeLike = (text) => text.replace(/[\\%_]/g, (ch) => `\\${ch}`);

// Helper: Validate request body for POST and PUT.
// Returns { isValid: false, message } or { isValid: true, data: { title, author, price, pages } }
const validateBookBody = (body) => {
  if (body === undefined || body === null || typeof body !== 'object' || Array.isArray(body)) {
    return {
      isValid: false,
      message: "Invalid input: request body must be a JSON object with 'title', 'author' and 'price'."
    };
  }

  const { title, author, price, pages } = body;

  if (title === undefined || typeof title !== 'string' || title.trim() === '') {
    return { isValid: false, message: "Invalid input: 'title' is required and must be a non-empty string." };
  }

  if (author === undefined || typeof author !== 'string' || author.trim() === '') {
    return { isValid: false, message: "Invalid input: 'author' is required and must be a non-empty string." };
  }

  // price: a number >= 0, or a numeric string such as "250" (so "", " ", "Free", [], true are all rejected)
  const priceIsNumber = typeof price === 'number' && Number.isFinite(price) && price >= 0;
  const priceIsNumericString = typeof price === 'string' && /^\d+(\.\d+)?$/.test(price.trim());
  if (!priceIsNumber && !priceIsNumericString) {
    return { isValid: false, message: "Invalid input: 'price' is required and must be a valid non-negative number." };
  }

  // pages is optional, but if it is sent it must be a whole number >= 0
  let pagesValue = null;
  if (pages !== undefined && pages !== null) {
    const pagesIsInteger = typeof pages === 'number' && Number.isInteger(pages) && pages >= 0;
    const pagesIsNumericString = typeof pages === 'string' && /^\d+$/.test(pages.trim());
    if (!pagesIsInteger && !pagesIsNumericString) {
      return { isValid: false, message: "Invalid input: 'pages' must be a non-negative whole number." };
    }
    pagesValue = Number(pages);
  }

  return {
    isValid: true,
    data: { title: title.trim(), author: author.trim(), price: Number(price), pages: pagesValue }
  };
};

// ---------------------------------------------------------------------------
// Route 1: GET /books - List books with search_q, price range, sorting, and pagination
// ---------------------------------------------------------------------------
app.get(['/books', '/books/'], async (req, res) => {
  try {
    // ?limit=1&limit=2 would arrive as an array - only single values are allowed
    for (const key of QUERY_KEYS) {
      if (req.query[key] !== undefined && typeof req.query[key] !== 'string') {
        return res.status(400).json({ message: `Invalid query parameter: '${key}' must be given only once.` });
      }
    }

    // Defaults for every query parameter
    const {
      search_q = '',
      order_by = 'id',
      order = 'ASC',
      limit = String(DEFAULT_LIMIT),
      offset = '0',
      min_price,
      max_price
    } = req.query;

    // Validate query parameters (bad input -> 400, never silently ignored)
    const safeOrderBy = order_by.toLowerCase();
    if (!ALLOWED_COLUMNS.includes(safeOrderBy)) {
      return res.status(400).json({
        message: `Invalid query parameter: 'order_by' must be one of: ${ALLOWED_COLUMNS.join(', ')}.`
      });
    }

    const safeOrder = order.toUpperCase();
    if (!ALLOWED_ORDERS.includes(safeOrder)) {
      return res.status(400).json({ message: "Invalid query parameter: 'order' must be ASC or DESC." });
    }

    const parsedLimit = /^\d+$/.test(limit) ? Number(limit) : NaN;
    if (!Number.isSafeInteger(parsedLimit) || parsedLimit < 1 || parsedLimit > MAX_LIMIT) {
      return res.status(400).json({
        message: `Invalid query parameter: 'limit' must be a positive integer (maximum ${MAX_LIMIT}).`
      });
    }

    const parsedOffset = /^\d+$/.test(offset) ? Number(offset) : NaN;
    if (!Number.isSafeInteger(parsedOffset)) {
      return res.status(400).json({ message: "Invalid query parameter: 'offset' must be a non-negative integer." });
    }

    const priceFormat = /^\d+(\.\d+)?$/;
    if (min_price !== undefined && !priceFormat.test(min_price)) {
      return res.status(400).json({ message: "Invalid query parameter: 'min_price' must be a non-negative number." });
    }

    if (max_price !== undefined && !priceFormat.test(max_price)) {
      return res.status(400).json({ message: "Invalid query parameter: 'max_price' must be a non-negative number." });
    }

    if (min_price !== undefined && max_price !== undefined && Number(min_price) > Number(max_price)) {
      return res.status(400).json({ message: "Invalid query parameter: 'min_price' cannot be greater than 'max_price'." });
    }

    // Dynamic SQL Query Construction with Parametric Placeholders
    const conditions = [];
    const queryParams = [];

    // 1. Partial title match (LIKE)
    if (search_q.trim() !== '') {
      conditions.push("title LIKE ? ESCAPE '\\'");
      queryParams.push(`%${escapeLike(search_q.trim())}%`);
    }

    // 2. Price range filtering using BETWEEN or comparison operators
    if (min_price !== undefined && max_price !== undefined) {
      conditions.push('price BETWEEN ? AND ?');
      queryParams.push(Number(min_price), Number(max_price));
    } else if (min_price !== undefined) {
      conditions.push('price >= ?');
      queryParams.push(Number(min_price));
    } else if (max_price !== undefined) {
      conditions.push('price <= ?');
      queryParams.push(Number(max_price));
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // Column name and direction cannot be "?" placeholders, so they were
    // checked against the allow-lists above before being added to the SQL text.
    // "id ASC" as a tie-breaker keeps pagination stable when rows share a value.
    const getBooksQuery = `
      SELECT
        *
      FROM
        book
      ${whereClause}
      ORDER BY
        ${safeOrderBy} ${safeOrder}, id ASC
      LIMIT ? OFFSET ?;
    `;

    queryParams.push(parsedLimit, parsedOffset);

    const books = await db.all(getBooksQuery, queryParams);
    return res.status(200).json(books);
  } catch (error) {
    return sendServerError(res, error);
  }
});

// ---------------------------------------------------------------------------
// Route 2: GET /books/:bookId - Retrieve a single book by ID
// ---------------------------------------------------------------------------
app.get(['/books/:bookId', '/books/:bookId/'], async (req, res) => {
  try {
    const bookId = parseBookId(req.params.bookId);

    if (bookId === null) {
      return res.status(400).json({ message: 'Invalid book ID: must be a positive integer.' });
    }

    const getBookQuery = `
      SELECT
        *
      FROM
        book
      WHERE
        id = ?;
    `;
    const book = await db.get(getBookQuery, [bookId]);

    if (!book) {
      return res.status(404).json({ message: 'Book not found' });
    }

    return res.status(200).json(book);
  } catch (error) {
    return sendServerError(res, error);
  }
});

// ---------------------------------------------------------------------------
// Route 3: POST /books - Create a new book
// ---------------------------------------------------------------------------
app.post(['/books', '/books/'], async (req, res) => {
  try {
    // Validate request body
    const validation = validateBookBody(req.body);
    if (!validation.isValid) {
      return res.status(400).json({ message: validation.message });
    }

    const { title, author, price, pages } = validation.data;

    const addBookQuery = `
      INSERT INTO
        book (title, author, price, pages)
      VALUES
        (?, ?, ?, ?);
    `;

    const dbResponse = await db.run(addBookQuery, [title, author, price, pages]);

    return res.status(201).json({
      message: 'Book created successfully',
      bookId: dbResponse.lastID
    });
  } catch (error) {
    return sendServerError(res, error);
  }
});

// ---------------------------------------------------------------------------
// Route 4: PUT /books/:bookId - Update an existing book by ID
// ---------------------------------------------------------------------------
app.put(['/books/:bookId', '/books/:bookId/'], async (req, res) => {
  try {
    const bookId = parseBookId(req.params.bookId);

    if (bookId === null) {
      return res.status(400).json({ message: 'Invalid book ID: must be a positive integer.' });
    }

    // Validate request body
    const validation = validateBookBody(req.body);
    if (!validation.isValid) {
      return res.status(400).json({ message: validation.message });
    }

    const { title, author, price, pages } = validation.data;

    const updateBookQuery = `
      UPDATE
        book
      SET
        title = ?,
        author = ?,
        price = ?,
        pages = ?
      WHERE
        id = ?;
    `;

    const dbResponse = await db.run(updateBookQuery, [title, author, price, pages, bookId]);

    if (dbResponse.changes === 0) {
      return res.status(404).json({ message: 'Book not found' });
    }

    return res.status(200).json({ message: 'Book updated successfully' });
  } catch (error) {
    return sendServerError(res, error);
  }
});

// ---------------------------------------------------------------------------
// Route 5: DELETE /books/:bookId - Delete a book by ID
// ---------------------------------------------------------------------------
app.delete(['/books/:bookId', '/books/:bookId/'], async (req, res) => {
  try {
    const bookId = parseBookId(req.params.bookId);

    if (bookId === null) {
      return res.status(400).json({ message: 'Invalid book ID: must be a positive integer.' });
    }

    const deleteBookQuery = `
      DELETE FROM
        book
      WHERE
        id = ?;
    `;

    const dbResponse = await db.run(deleteBookQuery, [bookId]);

    if (dbResponse.changes === 0) {
      return res.status(404).json({ message: 'Book not found' });
    }

    return res.status(200).json({ message: 'Book deleted successfully' });
  } catch (error) {
    return sendServerError(res, error);
  }
});

// 404 Fallback for undefined routes
app.use((req, res) => {
  res.status(404).json({ message: 'Route not found' });
});

// Global error handler (must keep 4 arguments so Express treats it as an error handler)
app.use((err, req, res, next) => {
  // Malformed JSON in the request body is the client's mistake -> 400, not 500
  if (err && (err.type === 'entity.parse.failed' || (err instanceof SyntaxError && err.status === 400))) {
    return res.status(400).json({ message: 'Invalid JSON in request body.' });
  }
  console.error('Unhandled Server Error:', err);
  res.status(500).json({ message: 'Internal server error' });
});

// Initialize SQLite Database and start HTTP Server
const initializeDBAndServer = async () => {
  try {
    db = await open({
      filename: dbPath,
      driver: sqlite3.Database,
    });

    // Only start listening if not running under a test runner that manages server lifecycle
    if (process.env.NODE_ENV !== 'test') {
      const server = app.listen(PORT, () => {
        console.log(`Server is running at http://localhost:${PORT}/`);
      });

      // Port conflict (EADDRINUSE): explain it clearly instead of crashing with a stack trace
      server.on('error', (error) => {
        if (error.code === 'EADDRINUSE') {
          console.error(`Port ${PORT} is already in use. Stop the other process or start with a different port, e.g. PORT=3001 node index.js`);
        } else {
          console.error(`Server error: ${error.message}`);
        }
        process.exit(1);
      });
    }
  } catch (error) {
    console.error(`DB Initialization Error: ${error.message}`);
    process.exit(1);
  }
};

initializeDBAndServer();

module.exports = app;
