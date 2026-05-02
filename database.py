import sqlite3
from datetime import datetime
import os
import json

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

    # Create widgets table for flashcards and quizzes
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS widgets (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            message_id INTEGER,
            widget_type TEXT NOT NULL,
            data TEXT NOT NULL,
            state TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (message_id) REFERENCES messages (id) ON DELETE CASCADE
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
    msg_id = cursor.lastrowid
    conn.commit()
    conn.close()
    return msg_id

def get_messages(session_id):
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute('SELECT id, sender, text, timestamp FROM messages WHERE session_id = ? ORDER BY id ASC', 
                   (session_id,))
    rows = cursor.fetchall()
    
    messages = []
    for r in rows:
        msg_id = r[0]
        
        # Fetch associated widgets
        cursor.execute('SELECT id, widget_type, data, state FROM widgets WHERE message_id = ? ORDER BY id ASC', (msg_id,))
        widget_rows = cursor.fetchall()
        widgets = []
        for w in widget_rows:
            widgets.append({
                "id": w[0],
                "widget_type": w[1],
                "data": json.loads(w[2]),
                "state": json.loads(w[3]) if w[3] else None
            })
            
        messages.append({
            "id": msg_id,
            "sender": r[1],
            "text": r[2],
            "timestamp": r[3],
            "widgets": widgets
        })
        
    conn.close()
    return messages

def add_widget(message_id, widget_type, data):
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute('INSERT INTO widgets (message_id, widget_type, data) VALUES (?, ?, ?)', 
                   (message_id, widget_type, json.dumps(data)))
    widget_id = cursor.lastrowid
    conn.commit()
    conn.close()
    return widget_id

def update_widget_state(widget_id, state):
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute('UPDATE widgets SET state = ? WHERE id = ?', 
                   (json.dumps(state), widget_id))
    conn.commit()
    conn.close()

def delete_session(session_id):
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    # Delete widgets for all messages in the session first
    cursor.execute('DELETE FROM widgets WHERE message_id IN (SELECT id FROM messages WHERE session_id = ?)', (session_id,))
    cursor.execute('DELETE FROM messages WHERE session_id = ?', (session_id,))
    cursor.execute('DELETE FROM sessions WHERE id = ?', (session_id,))
    conn.commit()
    conn.close()
