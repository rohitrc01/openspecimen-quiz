/**********************************************
 OPEN SPECIMEN QUIZ — FINAL STABLE SCRIPT
 Supports: Vercel (frontend) + Render (backend)
 With: WSS Fix + Correct/Incorrect Feedback
**********************************************/

// ---- BACKEND URL ----
const BACKEND_URL = "https://openspecimen-quiz.onrender.com";

// ---- FIX: Secure WebSocket URL ----
function getWSUrl() {
  return BACKEND_URL.replace("https://", "wss://") + "/ws";
}

/**********************************************
 WEBSOCKET CONNECT
**********************************************/
let ws;

function connectWS() {
  try {
    ws = new WebSocket(getWSUrl());

    ws.onopen = () => console.log("WS CONNECTED ✔");

    ws.onmessage = (evt) => {
      const data = JSON.parse(evt.data);

      // Question start
      if (data.type === "question_start") {
        window.onQuestionStart?.(data.question);
      }

      // Leaderboard update
      if (data.type === "leaderboard_update") {
        window.updateLeaderboardUI?.(data.leaderboard);
      }

      // NEW: Player answer result (correct/incorrect)
      if (data.type === "answer_result") {
        if (typeof window.handleAnswerResult === "function") {
          window.handleAnswerResult(data);
        }
      }
    };

    ws.onclose = () => {
      console.log("WS DISCONNECTED — retrying...");
      setTimeout(connectWS, 1500);
    };

    ws.onerror = () => {
      console.log("WS ERROR — reconnecting...");
    };

  } catch (err) {
    console.error("WebSocket error:", err);
  }
}

connectWS();

/**********************************************
 FIXED: API FETCH (no more double “?”)
**********************************************/
async function apiFetch(path, opts = {}) {
  let url = BACKEND_URL + path;

  // If URL already has ?, use &ts=
  if (url.includes("?")) {
    url += "&ts=" + Date.now();
  } else {
    url += "?ts=" + Date.now();
  }

  const res = await fetch(url, opts);

  if (!res.ok) {
    throw new Error(await res.text());
  }
  return res;
}

/**********************************************
 PLAYER PAGE LOGIC (index.html)
**********************************************/
if (document.getElementById("join-btn")) {

  const joinBtn = document.getElementById("join-btn");
  const playerNameInput = document.getElementById("player-name");
  const joinScreen = document.getElementById("join-screen");
  const quizScreen = document.getElementById("quiz-screen");
  const questionText = document.getElementById("question-text");
  const optionsDiv = document.getElementById("options");
  const timerSpan = document.getElementById("time-left");
  const statusDiv = document.getElementById("status");
  const scoreVal = document.getElementById("score-val");

  let playerName = "";
  let currentQuestion = null;
  let localTimer = null;
  let localTimeLeft = 15;

  // JOIN QUIZ
  joinBtn.onclick = () => {
    const name = playerNameInput.value.trim();
    if (!name) return alert("Enter your name!");

    playerName = name;
    joinScreen.style.display = "none";
    quizScreen.style.display = "block";
    statusDiv.innerText = "Waiting for host...";
  };

  // QUESTION STARTED
  window.onQuestionStart = function (question) {
    currentQuestion = question;

    questionText.innerText = question.question;
    optionsDiv.innerHTML = "";

    // Render answer buttons
    question.options.forEach((opt, idx) => {
      const btn = document.createElement("button");
      btn.innerText = opt;
      btn.className = "opt-btn";
      btn.onclick = () => submitAnswer(idx);
      optionsDiv.appendChild(btn);
    });

    // Reset timer
    if (localTimer) clearInterval(localTimer);

    localTimeLeft = 15;
    timerSpan.innerText = localTimeLeft;
    timerSpan.classList.remove("red");

    localTimer = setInterval(() => {
      localTimeLeft--;
      timerSpan.innerText = localTimeLeft;

      if (localTimeLeft <= 3) timerSpan.classList.add("red");

      if (localTimeLeft <= 0) {
        clearInterval(localTimer);
        disableOptions("⏰ Time up!");
      }

    }, 1000);

    statusDiv.innerText = "Answer now!";
  };

  // DISABLE OPTIONS
  function disableOptions(msg) {
    optionsDiv.querySelectorAll("button").forEach(b => b.disabled = true);
    statusDiv.innerText = msg;
  }

  /**********************************************
   SUBMIT ANSWER
  **********************************************/
  async function submitAnswer(chosenIdx) {
    if (!currentQuestion) return;

    clearInterval(localTimer);
    disableOptions("Submitting...");

    try {
      const payload = {
        name: playerName,
        qid: currentQuestion.id,
        chosen_index: chosenIdx,
        time_taken: 15 - localTimeLeft
      };

      await apiFetch("/submit_answer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      // Actual feedback will arrive via WebSocket (answer_result)

    } catch (err) {
      console.error(err);
      statusDiv.innerText = "Submission failed!";
    }
  }

  /**********************************************
   NEW: HANDLE CORRECT / INCORRECT FEEDBACK
  **********************************************/
  window.handleAnswerResult = function (data) {
    // Only show to the correct player
    if (data.name !== playerName) return;

    const correct = data.correct;
    const correctIndex = data.correct_index;
    const correctText = data.correct_text;

    if (correct) {
      statusDiv.innerText = `✅ Correct! (+1)`;
    } else {
      statusDiv.innerText = `❌ Incorrect — Correct answer (Q${data.qid}):  
Index: ${correctIndex}  
Ans: ${correctText}`;
    }

    // Update live score
    scoreVal.innerText = data.current_score;
  };

}

/**********************************************
 HOST PAGE LOGIC (host.html)
**********************************************/
if (document.getElementById("start-q")) {

  const qSelect = document.getElementById("question-select");
  const startBtn = document.getElementById("start-q");
  const leaderboardOl = document.getElementById("leaderboard");

  // LOAD QUESTIONS
  (async () => {
    const res = await apiFetch("/questions");
    const qs = await res.json();

    qs.forEach(q => {
      const opt = document.createElement("option");
      opt.value = q.id;
      opt.innerText = `Q${q.id}: ${q.question.substring(0, 60)}...`;
      qSelect.appendChild(opt);
    });
  })();

  // START QUESTION
  startBtn.onclick = async () => {
    const qid = qSelect.value;
    if (!qid) return alert("Select a question first.");

    startBtn.disabled = true;

    await apiFetch(`/host/start_question?qid=${qid}`, {
      method: "POST"
    });

    setTimeout(() => startBtn.disabled = false, 1000);
  };

  // UPDATE LEADERBOARD
  window.updateLeaderboardUI = function (lb) {
    leaderboardOl.innerHTML = "";
    lb.forEach(item => {
      const li = document.createElement("li");
      li.innerText = `${item[0]} — ${item[1]} pts`;
      leaderboardOl.appendChild(li);
    });
  };
}
