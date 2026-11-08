CREATE TABLE IF NOT EXISTS book (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  author TEXT NOT NULL,
  price REAL NOT NULL,
  pages INTEGER
);

INSERT INTO book (title, author, price, pages) VALUES ('The Great Gatsby', 'F. Scott Fitzgerald', 350, 180);
INSERT INTO book (title, author, price, pages) VALUES ('To Kill a Mockingbird', 'Harper Lee', 420, 281);
INSERT INTO book (title, author, price, pages) VALUES ('1984', 'George Orwell', 299, 328);
INSERT INTO book (title, author, price, pages) VALUES ('Pride and Prejudice', 'Jane Austen', 250, 279);
INSERT INTO book (title, author, price, pages) VALUES ('The Catcher in the Rye', 'J.D. Salinger', 380, 214);
INSERT INTO book (title, author, price, pages) VALUES ('The Hobbit', 'J.R.R. Tolkien', 499, 310);
INSERT INTO book (title, author, price, pages) VALUES ('Fahrenheit 451', 'Ray Bradbury', 320, 194);
INSERT INTO book (title, author, price, pages) VALUES ('Jane Eyre', 'Charlotte Bronte', 280, 500);
INSERT INTO book (title, author, price, pages) VALUES ('Animal Farm', 'George Orwell', 199, 112);
INSERT INTO book (title, author, price, pages) VALUES ('Brave New World', 'Aldous Huxley', 340, 268);

