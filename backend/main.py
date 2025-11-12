# server/main.py
import json
import csv
import os
import asyncio
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Request
from fastapi.responses import FileResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Dict, List
from datetime import datetime

APP_DIR = os.path.dirname(__file__)
QUESTIONS_FILE = os.path.join(APP_DIR, "questions.json")
RAW_CSV = os.path.join(APP_DIR, "results_raw.csv")
SUMMARY_CSV = os.path.join(APP_DIR, "results_summary.csv")

app = FastAPI(title="Seminar Quiz Backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # change to your domain(s) in production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# In-memory state
players_scores: Dict[str, int] = {}          # name -> score
players_details: Dict[str, dict] = {}        # name -> per-question details
active_question = {"qid": None, "start_time": None}  # current active qid and start time

# Load questions from file
def load_questions():
    with open(QUESTIONS_FILE, "r", encoding="utf-8") as f:
        return json.load(f)

questions = load_questions()

# Ensure raw CSV exists with header for per-answer logging
if not os.path.exists(RAW_CSV):
    with open(RAW_CSV, "w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow([
            "timestamp", "player_name", "question_id", "chosen_option_index", "is_correct", "time_taken_seconds"
        ])

# WebSocket manager
class ConnectionManager:
    def __init__(self):
        self.active_connections: List[WebSocket] = []

    async def connect(self, ws: WebSocket):
        await ws.accept()
        self.active_connections.append(ws)

    def disconnect(self, ws: WebSocket):
        if ws in self.active_connections:
            self.active_connections.remove(ws)

    async def broadcast(self, message: dict):
        remove = []
        for connection in list(self.active_connections):
            try:
                await connection.send_json(message)
            except Exception:
                remove.append(connection)
        for c in remove:
            self.disconnect(c)

manager = ConnectionManager()

# Models
class SubmitAnswer(BaseModel):
    name: str
    qid: int
    chosen_index: int
    time_taken: float   # seconds

@app.get("/questions")
def get_questions():
    return questions

@app.post("/host/start_question")
async def start_question(qid: int):
    """Host triggers a question to start — server broadcasts to all clients"""
    q = next((x for x in questions if x["id"] == qid), None)
    if not q:
        return JSONResponse({"error": "Question not found"}, status_code=404)
    active_question["qid"] = qid
    active_question["start_time"] = datetime.utcnow().timestamp()
    # Broadcast question payload
    payload = {
        "type": "question_start",
        "question": {
            "id": q["id"],
            "question": q["question"],
            "options": q["options"]
        },
        "start_time": active_question["start_time"]
    }
    await manager.broadcast(payload)
    return {"status": "started", "qid": qid}

@app.post("/submit_answer")
async def submit_answer(ans: SubmitAnswer):
    """Participants submit answers via REST POST (fast)."""
    # Find question and correctness
    q = next((x for x in questions if x["id"] == ans.qid), None)
    if not q:
        return JSONResponse({"error": "Question not found"}, status_code=404)
    correct = (ans.chosen_index == q["correct"])
    # scoring: base + speed bonus (faster -> more points)
    # If there was a start time from server, we can compute accurate speed bonus using time_taken posted by client.
    # Score rule: correct -> 1000 - int(time_taken*200) with min 100
    points = 0
    if correct:
        points = max(1000 - int(ans.time_taken * 200), 100)
    # update in-memory scores and details
    name = ans.name.strip()
    if name == "":
        name = "Anonymous"
    players_scores[name] = players_scores.get(name, 0) + points
    # record per-question details
    if name not in players_details:
        players_details[name] = {"answers": {}}
    players_details[name]["answers"][f"Q{ans.qid}"] = {
        "chosen_index": ans.chosen_index,
        "is_correct": int(correct),
        "time_taken": ans.time_taken
    }
    # Append raw CSV line
    with open(RAW_CSV, "a", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow([
            datetime.utcnow().isoformat(),
            name,
            ans.qid,
            ans.chosen_index,
            int(correct),
            ans.time_taken
        ])
    # Broadcast leaderboard update
    await manager.broadcast({
        "type": "leaderboard_update",
        "leaderboard": sorted(players_scores.items(), key=lambda x: x[1], reverse=True)
    })
    return {"status": "recorded", "score_for_player": players_scores[name], "points_added": points}

@app.get("/leaderboard")
def get_leaderboard():
    return sorted(players_scores.items(), key=lambda x: x[1], reverse=True)

@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    await manager.connect(ws)
    try:
        # send initial state
        await ws.send_json({
            "type": "leaderboard_update",
            "leaderboard": sorted(players_scores.items(), key=lambda x: x[1], reverse=True)
        })
        while True:
            # keep alive or accept messages (not required for this flow)
            data = await ws.receive_text()
            # echo or ignore
            # We keep the WS alive; host triggers question via REST
            await asyncio.sleep(0.01)
    except WebSocketDisconnect:
        manager.disconnect(ws)

@app.get("/export/raw")
def download_raw_csv():
    """Download the raw per-answer CSV file."""
    if os.path.exists(RAW_CSV):
        return FileResponse(RAW_CSV, media_type="text/csv", filename="results_raw.csv")
    return JSONResponse({"error": "No raw CSV found yet."}, status_code=404)

@app.get("/export/summary")
def generate_summary():
    """
    Generate aggregated CSV per participant with:
    columns: player_name, total_questions, attempted, correct, total_time, Q1, Q2, ... (each Q cell stores chosen_index|is_correct|time)
    """
    # load questions list to know how many Q columns
    q_ids = [q["id"] for q in questions]
    header = ["player_name", "total_questions", "attempted", "correct", "total_time"]
    q_headers = [f"Q{qid}" for qid in q_ids]
    header.extend(q_headers)

    # build aggregated rows
    rows = []
    for player, details in players_details.items():
        answers = details.get("answers", {})
        total_questions = len(q_ids)
        attempted = len(answers)
        correct = sum(v.get("is_correct", 0) for v in answers.values())
        total_time = sum(v.get("time_taken", 0.0) for v in answers.values())
        row = [player, total_questions, attempted, correct, round(total_time, 3)]
        # fill Q columns with string "chosen|is_correct|time" or empty
        for qid in q_ids:
            key = f"Q{qid}"
            if key in answers:
                v = answers[key]
                row.append(f"{v['chosen_index']}|{v['is_correct']}|{round(v['time_taken'],3)}")
            else:
                row.append("")
        rows.append(row)

    # write summary CSV
    with open(SUMMARY_CSV, "w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(header)
        for r in rows:
            writer.writerow(r)

    if os.path.exists(SUMMARY_CSV):
        return FileResponse(SUMMARY_CSV, media_type="text/csv", filename="results_summary.csv")
    return JSONResponse({"error": "Failed to generate summary"}, status_code=500)
