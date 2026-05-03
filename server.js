const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
const SECRET_KEY = 'southdale_secret_key_2025';

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// Create uploads directory if it doesn't exist
if (!fs.existsSync('./uploads')) {
    fs.mkdirSync('./uploads');
}
app.use('/uploads', express.static('uploads'));

// File upload setup
const storage = multer.diskStorage({
    destination: './uploads/',
    filename: (req, file, cb) => {
        cb(null, Date.now() + path.extname(file.originalname));
    }
});
const upload = multer({ storage: storage });

// Database connection
const db = new sqlite3.Database('./sis_database.db');

// Initialize database tables
db.serialize(() => {
    // Users table
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE,
        password TEXT,
        email TEXT,
        role TEXT CHECK(role IN ('admin', 'teacher', 'student', 'parent')),
        first_name TEXT,
        last_name TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Students table
    db.run(`CREATE TABLE IF NOT EXISTS students (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        lrn TEXT UNIQUE,
        grade_level TEXT,
        section TEXT,
        enrollment_status TEXT DEFAULT 'pending',
        payment_status TEXT DEFAULT 'unpaid',
        birth_date TEXT,
        address TEXT,
        parent_name TEXT,
        parent_contact TEXT,
        FOREIGN KEY(user_id) REFERENCES users(id)
    )`);

    // Subjects table
    db.run(`CREATE TABLE IF NOT EXISTS subjects (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT,
        grade_level TEXT,
        teacher_id INTEGER,
        FOREIGN KEY(teacher_id) REFERENCES users(id)
    )`);

    // Grades table
    db.run(`CREATE TABLE IF NOT EXISTS grades (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        student_id INTEGER,
        subject_id INTEGER,
        term TEXT,
        quiz REAL DEFAULT 0,
        recitation REAL DEFAULT 0,
        exam REAL DEFAULT 0,
        project REAL DEFAULT 0,
        final_grade REAL,
        remarks TEXT,
        school_year TEXT,
        FOREIGN KEY(student_id) REFERENCES students(id),
        FOREIGN KEY(subject_id) REFERENCES subjects(id)
    )`);

    // Enrollment applications table
    db.run(`CREATE TABLE IF NOT EXISTS applications (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        full_name TEXT,
        birth_date TEXT,
        grade_applying TEXT,
        previous_school TEXT,
        parent_name TEXT,
        parent_email TEXT,
        parent_phone TEXT,
        documents TEXT,
        status TEXT DEFAULT 'pending',
        exam_score INTEGER,
        applied_date DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Check if data already exists
    db.get('SELECT COUNT(*) as count FROM users', (err, row) => {
        if (err) return;
        
        if (row.count === 0) {
            // Insert sample data
            const adminPass = bcrypt.hashSync('admin123', 10);
            const teacherPass = bcrypt.hashSync('teacher123', 10);
            const studentPass = bcrypt.hashSync('student123', 10);
            
            db.run(`INSERT INTO users (username, password, email, role, full_name) VALUES 
                ('admin', ?, 'admin@southdale.edu', 'admin', 'School Administrator'),
                ('teacher1', ?, 'teacher@southdale.edu', 'teacher', 'Ms. Maria Santos'),
                ('student1', ?, 'student@southdale.edu', 'student', 'John Smith')`,
                [adminPass, teacherPass, studentPass], function() {
                    
                    // Insert student record
                    db.run(`INSERT INTO students (user_id, lrn, grade_level, section, enrollment_status, payment_status, full_name)
                            VALUES (3, 'LRN2024001', 'Grade 10', 'Section A', 'enrolled', 'paid', 'John Smith')`);
                    
                    // Insert subjects
                    db.run(`INSERT INTO subjects (name, grade_level, teacher_id) VALUES 
                        ('Mathematics', 'Grade 10', 2),
                        ('Science', 'Grade 10', 2),
                        ('English', 'Grade 10', 2)`);
                    
                    // Insert sample grades
                    db.run(`INSERT INTO grades (student_id, subject_id, term, quiz, recitation, exam, project, final_grade, remarks, school_year) VALUES 
                        (1, 1, '1st Quarter', 85, 88, 90, 87, 87.5, 'Passed', '2024-2025'),
                        (1, 2, '1st Quarter', 92, 89, 94, 91, 91.8, 'Passed', '2024-2025')`);
                });
        }
    });
});

// Middleware to verify JWT
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    
    if (!token) {
        return res.status(401).json({ error: 'Access denied. Please login.' });
    }
    
    jwt.verify(token, SECRET_KEY, (err, user) => {
        if (err) return res.status(403).json({ error: 'Invalid or expired token' });
        req.user = user;
        next();
    });
};

// ============= AUTHENTICATION ENDPOINTS =============
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    
    if (!username || !password) {
        return res.status(400).json({ error: 'Username and password required' });
    }
    
    db.get('SELECT * FROM users WHERE username = ?', [username], (err, user) => {
        if (err) {
            return res.status(500).json({ error: 'Database error' });
        }
        
        if (!user) {
            return res.status(401).json({ error: 'Invalid username or password' });
        }
        
        const validPassword = bcrypt.compareSync(password, user.password);
        if (!validPassword) {
            return res.status(401).json({ error: 'Invalid username or password' });
        }
        
        const token = jwt.sign(
            { id: user.id, username: user.username, role: user.role }, 
            SECRET_KEY, 
            { expiresIn: '24h' }
        );
        
        res.json({ 
            token, 
            role: user.role, 
            full_name: user.full_name, 
            user_id: user.id 
        });
    });
});

// ============= ENROLLMENT ENDPOINTS =============
app.post('/api/enroll', upload.single('document'), (req, res) => {
    const { full_name, birth_date, grade_applying, previous_school, parent_name, parent_email, parent_phone } = req.body;
    const documentPath = req.file ? req.file.path : null;
    
    if (!full_name || !birth_date || !grade_applying || !parent_email) {
        return res.status(400).json({ error: 'Please fill in all required fields' });
    }
    
    db.run(`INSERT INTO applications (full_name, birth_date, grade_applying, previous_school, parent_name, parent_email, parent_phone, documents)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [full_name, birth_date, grade_applying, previous_school, parent_name, parent_email, parent_phone, documentPath],
        function(err) {
            if (err) {
                console.error(err);
                res.status(500).json({ error: 'Failed to submit application' });
            } else {
                res.json({ message: 'Application submitted successfully!', application_id: this.lastID });
            }
        });
});

app.get('/api/applications', authenticateToken, (req, res) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Admin access required' });
    }
    
    db.all('SELECT * FROM applications ORDER BY applied_date DESC', (err, rows) => {
        if (err) {
            res.status(500).json({ error: err.message });
        } else {
            res.json(rows);
        }
    });
});

app.put('/api/applications/:id', authenticateToken, (req, res) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Admin access required' });
    }
    
    const { status, exam_score } = req.body;
    db.run('UPDATE applications SET status = ?, exam_score = ? WHERE id = ?', 
        [status, exam_score || null, req.params.id], 
        function(err) {
            if (err) {
                res.status(500).json({ error: err.message });
            } else {
                res.json({ message: 'Application updated successfully' });
            }
        });
});

// ============= STUDENT ENDPOINTS =============
app.get('/api/students', authenticateToken, (req, res) => {
    let query = `
        SELECT s.*, u.full_name, u.email 
        FROM students s 
        JOIN users u ON s.user_id = u.id
    `;
    
    // If teacher, only show students in their classes
    if (req.user.role === 'teacher') {
        query += ` WHERE s.grade_level IN (SELECT DISTINCT grade_level FROM subjects WHERE teacher_id = ${req.user.id})`;
    }
    // If student, only show themselves
    else if (req.user.role === 'student') {
        query += ` WHERE u.id = ${req.user.id}`;
    }
    
    db.all(query, (err, rows) => {
        if (err) {
            res.status(500).json({ error: err.message });
        } else {
            res.json(rows || []);
        }
    });
});

app.get('/api/students/:studentId', authenticateToken, (req, res) => {
    const studentId = req.params.studentId;
    
    db.get(`SELECT s.*, u.full_name, u.email 
            FROM students s 
            JOIN users u ON s.user_id = u.id 
            WHERE s.id = ?`, [studentId], (err, row) => {
        if (err) {
            res.status(500).json({ error: err.message });
        } else if (!row) {
            res.status(404).json({ error: 'Student not found' });
        } else {
            res.json(row);
        }
    });
});

// ============= GRADING ENDPOINTS =============
app.get('/api/students/:studentId/grades', authenticateToken, (req, res) => {
    const studentId = req.params.studentId;
    
    // Check authorization
    if (req.user.role === 'student') {
        db.get('SELECT user_id FROM students WHERE id = ?', [studentId], (err, student) => {
            if (err || !student || student.user_id !== req.user.id) {
                return res.status(403).json({ error: 'You can only view your own grades' });
            }
            fetchGrades();
        });
    } else if (req.user.role === 'parent') {
        // TODO: Add parent-child relationship check
        fetchGrades();
    } else {
        fetchGrades();
    }
    
    function fetchGrades() {
        db.all(`SELECT g.*, sub.name as subject_name, u.full_name as teacher_name
                FROM grades g
                JOIN subjects sub ON g.subject_id = sub.id
                JOIN users u ON sub.teacher_id = u.id
                WHERE g.student_id = ?`, [studentId], (err, rows) => {
            if (err) {
                res.status(500).json({ error: err.message });
            } else {
                res.json(rows || []);
            }
        });
    }
});

app.post('/api/grades', authenticateToken, (req, res) => {
    if (req.user.role !== 'teacher' && req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Teacher or admin access required' });
    }
    
    const { student_id, subject_id, term, quiz, recitation, exam, project, school_year } = req.body;
    
    if (!student_id || !subject_id || !term) {
        return res.status(400).json({ error: 'Missing required fields' });
    }
    
    // Calculate final grade
    const quizWeight = 0.20;
    const recitationWeight = 0.15;
    const examWeight = 0.35;
    const projectWeight = 0.30;
    
    const final_grade = (parseFloat(quiz) * quizWeight) + 
                       (parseFloat(recitation) * recitationWeight) + 
                       (parseFloat(exam) * examWeight) + 
                       (parseFloat(project) * projectWeight);
    const remarks = final_grade >= 75 ? 'Passed' : 'Failed';
    
    db.run(`INSERT OR REPLACE INTO grades (student_id, subject_id, term, quiz, recitation, exam, project, final_grade, remarks, school_year)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [student_id, subject_id, term, quiz || 0, recitation || 0, exam || 0, project || 0, final_grade.toFixed(2), remarks, school_year || '2024-2025'],
        function(err) {
            if (err) {
                console.error(err);
                res.status(500).json({ error: 'Failed to save grades' });
            } else {
                res.json({ message: 'Grade saved successfully', final_grade: final_grade.toFixed(2), remarks });
            }
        });
});

app.get('/api/teacher/classes', authenticateToken, (req, res) => {
    if (req.user.role !== 'teacher') {
        return res.status(403).json({ error: 'Teacher access required' });
    }
    
    db.all(`SELECT DISTINCT 
            s.id as student_id,
            s.user_id,
            s.lrn,
            s.grade_level,
            s.section,
            sub.id as subject_id,
            sub.name as subject_name,
            u.full_name as student_name
            FROM subjects sub
            JOIN students s ON s.grade_level = sub.grade_level
            JOIN users u ON s.user_id = u.id
            WHERE sub.teacher_id = ?`, [req.user.id], (err, rows) => {
        if (err) {
            res.status(500).json({ error: err.message });
        } else {
            res.json(rows || []);
        }
    });
});

// ============= DASHBOARD STATISTICS =============
app.get('/api/stats', authenticateToken, (req, res) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Admin access required' });
    }
    
    const stats = {};
    
    db.get('SELECT COUNT(*) as count FROM students', (err, row) => {
        stats.total_students = row ? row.count : 0;
        
        db.get('SELECT COUNT(*) as count FROM applications WHERE status = "pending"', (err, row) => {
            stats.pending_applications = row ? row.count : 0;
            
            db.get('SELECT COUNT(*) as count FROM users WHERE role = "teacher"', (err, row) => {
                stats.total_teachers = row ? row.count : 0;
                res.json(stats);
            });
        });
    });
});

// ============= SERVE HTML FILES =============
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/login.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.get('/enrollment.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'enrollment.html'));
});

app.get('/dashboard.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

app.get('/teacher.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'teacher.html'));
});

app.get('/admin.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// ============= ADMIN: ADD STUDENT =============
app.post('/api/admin/add-student', authenticateToken, async (req, res) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Admin access required' });
    }
    
    const { full_name, username, password, email, lrn, grade_level, section, birth_date, parent_name, parent_contact } = req.body;
    
    if (!full_name || !username || !password || !email) {
        return res.status(400).json({ error: 'Missing required fields' });
    }
    
    try {
        // Check if username exists
        const existingUser = await new Promise((resolve, reject) => {
            db.get('SELECT id FROM users WHERE username = ?', [username], (err, row) => {
                if (err) reject(err);
                resolve(row);
            });
        });
        
        if (existingUser) {
            return res.status(400).json({ error: 'Username already exists' });
        }
        
        // Create user account
        const hashedPassword = bcrypt.hashSync(password, 10);
        const userId = await new Promise((resolve, reject) => {
            db.run(`INSERT INTO users (username, password, email, role, full_name) 
                    VALUES (?, ?, ?, 'student', ?)`,
                [username, hashedPassword, email, full_name],
                function(err) {
                    if (err) reject(err);
                    resolve(this.lastID);
                });
        });
        
        // Create student record
        await new Promise((resolve, reject) => {
            db.run(`INSERT INTO students (user_id, lrn, grade_level, section, birth_date, parent_name, parent_contact, enrollment_status, payment_status)
                    VALUES (?, ?, ?, ?, ?, ?, ?, 'enrolled', 'pending')`,
                [userId, lrn || `LRN${Date.now()}`, grade_level || 'Not Assigned', section || 'Not Assigned', 
                 birth_date || null, parent_name || null, parent_contact || null],
                (err) => {
                    if (err) reject(err);
                    resolve();
                });
        });
        
        res.json({ message: 'Student added successfully!', user_id: userId });
        
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to add student' });
    }
});

// ============= ADMIN: REMOVE STUDENT =============
app.delete('/api/admin/remove-student/:studentId', authenticateToken, (req, res) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Admin access required' });
    }
    
    const studentId = req.params.studentId;
    
    // First get the user_id to delete user account
    db.get('SELECT user_id FROM students WHERE id = ?', [studentId], (err, student) => {
        if (err || !student) {
            return res.status(404).json({ error: 'Student not found' });
        }
        
        // Delete grades first (foreign key constraint)
        db.run('DELETE FROM grades WHERE student_id = ?', [studentId], (err) => {
            if (err) {
                return res.status(500).json({ error: 'Failed to delete grades' });
            }
            
            // Delete student record
            db.run('DELETE FROM students WHERE id = ?', [studentId], (err) => {
                if (err) {
                    return res.status(500).json({ error: 'Failed to delete student' });
                }
                
                // Delete user account
                db.run('DELETE FROM users WHERE id = ?', [student.user_id], (err) => {
                    if (err) {
                        return res.status(500).json({ error: 'Failed to delete user account' });
                    }
                    res.json({ message: 'Student removed successfully' });
                });
            });
        });
    });
});

// ============= ADMIN: ADD TEACHER =============
app.post('/api/admin/add-teacher', authenticateToken, async (req, res) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Admin access required' });
    }
    
    const { full_name, username, password, email, subject_specialization } = req.body;
    
    if (!full_name || !username || !password || !email) {
        return res.status(400).json({ error: 'Missing required fields' });
    }
    
    try {
        // Check if username exists
        const existingUser = await new Promise((resolve, reject) => {
            db.get('SELECT id FROM users WHERE username = ?', [username], (err, row) => {
                if (err) reject(err);
                resolve(row);
            });
        });
        
        if (existingUser) {
            return res.status(400).json({ error: 'Username already exists' });
        }
        
        // Create teacher user account
        const hashedPassword = bcrypt.hashSync(password, 10);
        const userId = await new Promise((resolve, reject) => {
            db.run(`INSERT INTO users (username, password, email, role, full_name) 
                    VALUES (?, ?, ?, 'teacher', ?)`,
                [username, hashedPassword, email, full_name],
                function(err) {
                    if (err) reject(err);
                    resolve(this.lastID);
                });
        });
        
        // If subject specialization provided, assign subjects
        if (subject_specialization && subject_specialization.length > 0) {
            const subjects = subject_specialization.split(',').map(s => s.trim());
            for (const subjectName of subjects) {
                await new Promise((resolve, reject) => {
                    db.run(`INSERT INTO subjects (name, grade_level, teacher_id) 
                            VALUES (?, 'Not Assigned', ?)`,
                        [subjectName, userId],
                        (err) => {
                            if (err) reject(err);
                            resolve();
                        });
                });
            }
        }
        
        res.json({ message: 'Teacher added successfully!', user_id: userId });
        
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to add teacher' });
    }
});

// ============= ADMIN: REMOVE TEACHER =============
app.delete('/api/admin/remove-teacher/:teacherId', authenticateToken, (req, res) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Admin access required' });
    }
    
    const teacherId = req.params.teacherId;
    
    // Remove teacher's subjects first
    db.run('DELETE FROM subjects WHERE teacher_id = ?', [teacherId], (err) => {
        if (err) {
            return res.status(500).json({ error: 'Failed to delete teacher subjects' });
        }
        
        // Delete teacher user account
        db.run('DELETE FROM users WHERE id = ? AND role = "teacher"', [teacherId], function(err) {
            if (err) {
                return res.status(500).json({ error: 'Failed to delete teacher' });
            }
            
            if (this.changes === 0) {
                return res.status(404).json({ error: 'Teacher not found' });
            }
            
            res.json({ message: 'Teacher removed successfully' });
        });
    });
});

// ============= GET ALL TEACHERS =============
app.get('/api/admin/teachers', authenticateToken, (req, res) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Admin access required' });
    }
    
    db.all(`SELECT u.id, u.full_name, u.username, u.email, 
            GROUP_CONCAT(s.name) as subjects
            FROM users u
            LEFT JOIN subjects s ON u.id = s.teacher_id
            WHERE u.role = 'teacher'
            GROUP BY u.id`, (err, rows) => {
        if (err) {
            res.status(500).json({ error: err.message });
        } else {
            res.json(rows || []);
        }
    });
});

// ============= GET ALL STUDENTS (DETAILED) =============
app.get('/api/admin/students', authenticateToken, (req, res) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Admin access required' });
    }
    
    db.all(`SELECT s.*, u.full_name, u.username, u.email 
            FROM students s 
            JOIN users u ON s.user_id = u.id
            ORDER BY s.id DESC`, (err, rows) => {
        if (err) {
            res.status(500).json({ error: err.message });
        } else {
            res.json(rows || []);
        }
    });
});

app.listen(PORT, () => {
    console.log(`\n========================================`);
    console.log(`✅ SIS Portal is running!`);
    console.log(`========================================`);
    console.log(`📍 URL: http://localhost:${PORT}`);
    console.log(`\n📋 Demo Login Credentials:`);
    console.log(`   Admin:   admin / admin123`);
    console.log(`   Teacher: teacher1 / teacher123`);
    console.log(`   Student: student1 / student123`);
    console.log(`========================================\n`);
});