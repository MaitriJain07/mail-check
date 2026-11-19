-- Separate database for integration tests so `npm test` never touches dev data.
CREATE DATABASE IF NOT EXISTS mailcheck_test;
GRANT ALL PRIVILEGES ON mailcheck_test.* TO 'mailcheck'@'%';
FLUSH PRIVILEGES;
