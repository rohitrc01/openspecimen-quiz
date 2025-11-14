# ============================================
#   OPENSPECIMEN QUIZ — FIXED BACKEND MAIN.PY
#   Supports Render + Vercel + WSS WebSockets
# ============================================

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
import json
import csv
from datetime import datetime

app = FastAPI()

# ============================
#   CORS + ALLOWED ORIGINS
# ============================
# Must include your Vercel frontend
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

# ============================
#   LOAD QUESTIONS
# ============================
with open("questions.json") as f:
    QUESTIONS = json.load(f)

# ============================
#   GLOBAL STATE
# ============================
active_question = None
connected_clients = set()
scores = {}          # {player_name: score}
answers_log = {}     # {player_name: {qid: (attempted, correct, time_taken)}}


# ============================
#   WEBSOCKET HANDLER
# ============================
@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    # Accept connections from Vercel frontend
    await ws.accept()

    connected_clients.add(ws)
    print("WebSocket client connected")

    try:
        while True:
            await ws.receive_text()   # we don't use messages from client
    except WebSocketDisconnect:
        connected_clients.remove(ws)
        print("WebSocket client disconnected")


# ============================
#   BROADCAST FUNCTION
# ============================
async def broadcast(msg):
    dead_clients = []
    for ws in connected_clients:
        try:
            await ws.send_json(msg)
        except:
            dead_clients.append(ws)

    for ws in dead_clients:
        connected_clients.discard(ws)


# ============================
#   API — GET QUESTIONS
# ============================
@app.get("/questions")
async def get_qs():
    return QUESTIONS


# ============================
#   HOST STARTS A QUESTION
# ============================
@app.post("/host/start_question")
async def start_question(qid: int):
    global active_question

    question = next((q for q in QUESTIONS if q["id"] == qid), None)
    if not question:
        return {"error": "Invalid question ID"}

    active_question = question

    # Send question to all players
    await broadcast({
        "type": "question_start",
        "question": question
    })

    return {"status": "ok"}


# ============================
#   PLAYER SUBMITS ANSWER
# ============================
@app.post("/submit_answer")
async def submit_answer(payload: dict):
    name = payload["name"]
    qid = payload["qid"]
    chosen = payload["chosen_index"]
    time_taken = float(payload["time_taken"])

    question = next((q for q in QUESTIONS if q["id"] == qid), None)
    if not question:
        return {"error": "Invalid question"}

    correct = (chosen == question["answer_index"])

    # Count only score = 1 per correct question
    if correct:
        scores[name] = scores.get(name, 0) + 1
    else:
        scores.setdefault(name, 0)

    # Log data
    if name not in answers_log:
        answers_log[name] = {}

    answers_log[name][qid] = (
        1,              # attempted
        1 if correct else 0,
        time_taken
    )

    # Broadcast updated leaderboard
    await broadcast({
        "type": "leaderboard_update",
        "leaderboard": sorted(scores.items(), key=lambda x: (-x[1], x[0]))
    })

    return {"status": "ok"}


# ============================
#   GET LEADERBOARD
# ============================
@app.get("/leaderboard")
async def get_leaderboard():
    lb = sorted(scores.items(), key=lambda x: (-x[1], x[0]))
    return lb


# ============================
#   EXPORT SUMMARY CSV
# ============================
@app.get("/export/summary")
async def export_summary():
    import os
    filename = "/tmp/summary_export.csv"  # Writable directory on Render

    with open(filename, "w", newline="") as f:
        writer = csv.writer(f)
        header = ["player_name", "total_questions", "attempted", "correct", "total_time"]
        header += [f"Q{q['id']}" for q in QUESTIONS]
        writer.writerow(header)

        for player, qdata in answers_log.items():
            total_q = len(QUESTIONS)
            att = len(qdata)
            corr = sum(1 for q in qdata.values() if q[1] == 1)
            ttime = sum(q[2] for q in qdata.values())

            row = [player, total_q, att, corr, round(ttime, 3)]

            for q in QUESTIONS:
                qid = q["id"]
                if qid in qdata:
                    a, c, t = qdata[qid]
                    row.append(f"{a}|{c}|{round(t,3)}")
                else:
                    row.append("0|0|0")

            writer.writerow(row)

    return FileResponse(filename, filename="summary_export.csv")



# ============================
#   ROOT PATH
# ============================
@app.get("/")
def root():
    return {"message": "OpenSpecimen Quiz backend running!"}
