-- Clear existing test data (optional)
-- DELETE FROM tblpassword WHERE PFNo > 4;

-- Seed Companies (if not exists)
INSERT INTO tblcominfo (CompanyID, Com_Name, Email, Address, Town, City, Country, Phone, Manager) VALUES
(1, 'Acme Corporation', 'admin@acme.com', '123 Main St', 'Downtown', 'New York', 'USA', '+1234567890', 'John Doe'),
(2, 'Tech Solutions Ltd', 'admin@techsol.com', '456 Tech Ave', 'Silicon Valley', 'San Francisco', 'USA', '+0987654321', 'Jane Smith')
ON DUPLICATE KEY UPDATE Com_Name = VALUES(Com_Name);

-- Seed Admin Users with hashed passwords
-- Password for all: 'Password123!'
-- You'll need to generate bcrypt hashes
INSERT INTO tblpassword (DateCreated, Level, PFNo, Username, FullName, Pword, Email, CompanyID) VALUES
('2025-01-15 10:00:00', 'Admin', 5001, 'admin1', 'Alice Admin', '$2b$10$abcdefghijklmnopqrstuvwxyz123456', 'alice@acme.com', 1),
('2025-01-15 10:00:00', 'Admin', 5002, 'admin2', 'Bob Admin', '$2b$10$abcdefghijklmnopqrstuvwxyz123456', 'bob@techsol.com', 2),
('2025-01-15 10:00:00', 'Manager', 5003, 'manager1', 'Charlie Manager', '$2b$10$abcdefghijklmnopqrstuvwxyz123456', 'charlie@acme.com', 1),
('2025-01-15 10:00:00', 'User', 5004, 'user1', 'Diana User', '$2b$10$abcdefghijklmnopqrstuvwxyz123456', 'diana@acme.com', 1),
('2025-01-15 10:00:00', 'User', 5005, 'user2', 'Eve User', '$2b$10$abcdefghijklmnopqrstuvwxyz123456', 'eve@techsol.com', 2)
ON DUPLICATE KEY UPDATE Username = VALUES(Username);

-- Seed Licenses for companies
INSERT INTO license (start_date, expiry_date, updated_by, CompanyID) VALUES
('2025-01-01', '2025-12-31', 'admin1', 1),
('2025-01-01', '2026-01-01', 'admin2', 2);