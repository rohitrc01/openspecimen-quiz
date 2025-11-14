# main.py
# OpenSpecimen Quiz — Final backend with answer feedback + robust CSV export
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
import json
import csv
from datetime import datetime
import os
from typing import Dict, Any

app = FastAPI()

# ---------------------------
# CORS / Allowed origins
# ---------------------------
origins = [
    "https://openspecimen-quiz.vercel.app",
    "http://localhost:5500",
    "*"
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------
# Load questions (assumes file is in same folder as main.py)
# ---------------------------
QUESTIONS_FILE = "questions.json"
if not os.path.exists(QUESTIONS_FILE):
    raise RuntimeError(f"{QUESTIONS_FILE} not found in backend directory.")

with open(QUESTIONS_FILE, "r", encoding="utf-8") as f:
    QUESTIONS = json.load(f)

# ---------------------------
# Global state
# ---------------------------
active_question = None
connected_clients = set()  # set[WebSocket]
scores: Dict[str, int] = {}  # player_name -> score
# answers_log structure:
# { player_name: { qid: {"attempted":1, "correct":0/1, "time":float} , ... }, ... }
answers_log: Dict[str, Dict[int, Dict[str, Any]]] = {}

# ---------------------------
# WebSocket endpoint
# ---------------------------
@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    # Accept connection
    await ws.accept()
    connected_clients.add(ws)
    try:
        # keep connection alive; we don't expect to receive messages from client
        while True:
            await ws.receive_text()
    except WebSocketDisconnect:
        connected_clients.discard(ws)
    except Exception:
        connected_clients.discard(ws)

# ---------------------------
# Broadcast helper
# ---------------------------
async def broadcast(payload: dict):
    dead = []
    for ws in list(connected_clients):
        try:
            await ws.send_json(payload)
        except Exception:
            dead.append(ws)
    for ws in dead:
        connected_clients.discard(ws)

# ---------------------------
# API: get questions
# ---------------------------
@app.get("/questions")
async def get_questions():
    # Return questions as-is
    return QUESTIONS

# ---------------------------
# API: host starts question
# ---------------------------
@app.post("/host/start_question")
async def start_question(qid: int):
    # find question
    q = next((x for x in QUESTIONS if x["id"] == qid), None)
    if not q:
        raise HTTPException(status_code=404, detail="Question not found")
    global active_question
    active_question = q
    # Broadcast to all players
    await broadcast({
        "type": "question_start",
        "question": q
    })
    return {"status": "ok"}

# ---------------------------
# API: player submits answer
# ---------------------------
@app.post("/submit_answer")
async def submit_answer(payload: dict):
    """
    payload expected:
    {
      "name": "Alice",
      "qid": 1,
      "chosen_index": 2,
      "time_taken": 3.123
    }
    """
    # validate payload
    try:
        name = str(payload["name"]).strip()
        qid = int(payload["qid"])
        chosen_index = int(payload["chosen_index"])
        time_taken = float(payload.get("time_taken", 0.0))
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid payload: {e}")

    # find question
    question = next((q for q in QUESTIONS if q["id"] == qid), None)
    if not question:
        raise HTTPException(status_code=404, detail="Question not found")

    correct_index = int(question.get("answer_index", -1))
    correct_flag = 1 if (chosen_index == correct_index) else 0
    correct_text = question["options"][correct_index] if 0 <= correct_index < len(question["options"]) else ""

    # update scores (1 point per correct)
    if correct_flag:
        scores[name] = scores.get(name, 0) + 1
    else:
        scores.setdefault(name, 0)

    # log answers in robust structure
    if name not in answers_log:
        answers_log[name] = {}
    answers_log[name][qid] = {
        "attempted": 1,
        "correct": correct_flag,
        "time": round(time_taken, 3)
    }

    # Broadcast leaderboard update
    lb = sorted(scores.items(), key=lambda x: (-x[1], x[0]))
    await broadcast({
        "type": "leaderboard_update",
        "leaderboard": lb
    })

    # Broadcast answer result so the player (and optionally host) can display correctness
    # This message includes player name; frontend will filter by name to show only to intended player.
    await broadcast({
        "type": "answer_result",
        "name": name,
        "qid": qid,
        "correct": bool(correct_flag),
        "correct_index": correct_index,
        "correct_text": correct_text,
        "time_taken": round(time_taken, 3),
        "current_score": scores.get(name, 0)
    })

    return {"status": "ok", "score": scores.get(name, 0)}

# ---------------------------
# API: get leaderboard
# ---------------------------
@app.get("/leaderboard")
async def get_leaderboard():
    lb = sorted(scores.items(), key=lambda x: (-x[1], x[0]))
    return lb

# ---------------------------
# API: export summary CSV (Render-safe, writes to /tmp)
# ---------------------------
@app.get("/export/summary")
async def export_summary():
    tmpfile = "/tmp/summary_export.csv"
    header = ["player_name", "total_questions", "attempted", "correct", "total_time"]
    header += [f"Q{q['id']}" for q in QUESTIONS]

    with open(tmpfile, "w", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(header)

        # iterate players sorted by score (desc)
        for player, _score in sorted(scores.items(), key=lambda x: (-x[1], x[0])):
            qdata = answers_log.get(player, {})
            total_q = len(QUESTIONS)
            attempted = len(qdata)
            correct_count = sum(1 for v in qdata.values() if v.get("correct", 0) == 1)
            total_time = sum(v.get("time", 0.0) for v in qdata.values())

            row = [player, total_q, attempted, correct_count, round(total_time, 3)]

            # append per-question cells
            for q in QUESTIONS:
                qid = q["id"]
                if qid in qdata:
                    v = qdata[qid]
                    row.append(f"{v.get('attempted',0)}|{v.get('correct',0)}|{v.get('time',0.0)}")
                else:
                    row.append("0|0|0")
            writer.writerow(row)

    # return file as attachment
    return FileResponse(tmpfile, filename="summary_export.csv")

# ---------------------------
# Root
# ---------------------------
@app.get("/")
def root():
    return {"message": "OpenSpecimen Quiz backend running."}
