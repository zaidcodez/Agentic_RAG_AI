import sqlite3
from datetime import datetime
import os

DB_PATH = "chat_history.db"

def init_db():
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    # Create sessions table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS sessions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    
    # Create messages table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id INTEGER,
            sender TEXT NOT NULL,
            text TEXT NOT NULL,
            timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (session_id) REFERENCES sessions (id) ON DELETE CASCADE
        )
    ''')
    
    conn.commit()
    conn.close()

def create_session(title):
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute('INSERT INTO sessions (title) VALUES (?)', (title,))
    session_id = cursor.lastrowid
    conn.commit()
    conn.close()
    return session_id

def get_sessions():
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute('SELECT id, title, created_at FROM sessions ORDER BY created_at DESC')
    rows = cursor.fetchall()
    conn.close()
    return [{"id": r[0], "title": r[1], "created_at": r[2]} for r in rows]

def add_message(session_id, sender, text):
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute('INSERT INTO messages (session_id, sender, text) VALUES (?, ?, ?)', 
                   (session_id, sender, text))
    conn.commit()
    conn.close()

def get_messages(session_id):
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute('SELECT sender, text, timestamp FROM messages WHERE session_id = ? ORDER BY id ASC', 
                   (session_id,))
    rows = cursor.fetchall()
    conn.close()
    return [{"sender": r[0], "text": r[1], "timestamp": r[2]} for r in rows]

def delete_session(session_id):
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute('DELETE FROM messages WHERE session_id = ?', (session_id,))
    cursor.execute('DELETE FROM sessions WHERE id = ?', (session_id,))
    conn.commit()
    conn.close()
