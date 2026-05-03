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