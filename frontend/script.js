// script.js - shared for index.html and host.html
const BACKEND_URL = "http://127.0.0.1:10000"; // <-- replace this after deploying backend

// WebSocket connection
let ws;
function connectWS() {
  try {
    ws = new WebSocket((BACKEND_URL.replace(/^http/, "ws")) + "/ws");
    ws.onopen = () => console.log("✅ WS connected");
    ws.onmessage = (evt) => {
      const data = JSON.parse(evt.data);
      if (data.type === "question_start") {
        onQuestionStart(data.question, data.start_time);
      } else if (data.type === "leaderboard_update") {
        updateLeaderboardUI(data.leaderboard);
      }
    };
    ws.onclose = () => {
      console.log("⚠️ WS closed. Reconnecting in 2s...");
      setTimeout(connectWS, 2000);
    };
  } catch (e) {
    console.error("WS error", e);
  }
}
connectWS();

// Utility: fetch wrapper
async function apiFetch(path, opts) {
  const res = await fetch(BACKEND_URL + path, opts);
  if (!res.ok) {
    const text = await res.text();
    throw new Error("API error: " + text);
  }
  return res;
}

/* ============================
   Player page logic (index.html)
   ============================ */
if (document.getElementById("join-btn")) {
  // Player page
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
  let questionStartTime = null;
  let localTimer = null;
  let localTimeLeft = 15; // seconds per question

  joinBtn.addEventListener("click", () => {
    const name = playerNameInput.value.trim();
    if (!name) {
      alert("Enter your name");
      return;
    }
    playerName = name;
    joinScreen.style.display = "none";
    quizScreen.style.display = "block";
    statusDiv.innerText = "Waiting for host to start a question...";
    fetchLeaderboard(); // get initial score
  });

  function onQuestionStart(question, start_time) {
    if (!playerName) return; // not joined yet
    currentQuestion = question;
    questionText.innerText = question.question;
    optionsDiv.innerHTML = "";

    // Create answer buttons
    question.options.forEach((opt, idx) => {
      const btn = document.createElement("button");
      btn.innerText = opt;
      btn.onclick = () => submitAnswer(idx);
      optionsDiv.appendChild(btn);
    });

    // Timer setup
    // Ignore remote timing and start local countdown fresh
    questionStartTime = Date.now() / 1000;
    localTimeLeft = 15;


    // Stop any old timer
    if (localTimer) clearInterval(localTimer);

    // Display initial value
    timerSpan.innerText = localTimeLeft;
    timerSpan.style.color = "black";

    // ✅ Fixed Timer (no -1s, with red warning)
    localTimer = setInterval(() => {
      if (localTimeLeft > 0) {
        localTimeLeft--;
        timerSpan.innerText = localTimeLeft;
        timerSpan.style.color = localTimeLeft <= 3 ? "red" : "black";
      } else {
        clearInterval(localTimer);
        timerSpan.innerText = "0";
        timerSpan.style.color = "black";
        disableOptions("⏰ Time up! No answer recorded.");
      }
    }, 1000);

    statusDiv.innerText = "Answer now!";
    enableOptions();
  }

  function disableOptions(msg) {
    const btns = optionsDiv.querySelectorAll("button");
    btns.forEach((b) => (b.disabled = true));
    statusDiv.innerText = msg || "Answered";
  }

  function enableOptions() {
    const btns = optionsDiv.querySelectorAll("button");
    btns.forEach((b) => (b.disabled = false));
  }

  async function submitAnswer(chosenIndex) {
    if (!currentQuestion) return;
    const now = Date.now() / 1000;
    const timeTaken = now - (questionStartTime || now);
    disableOptions("Submitting...");

    try {
      const body = {
        name: playerName,
        qid: currentQuestion.id,
        chosen_index: chosenIndex,
        time_taken: parseFloat(timeTaken.toFixed(3)),
      };
      await apiFetch("/submit_answer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      statusDiv.innerText = "✅ Answer submitted!";
      fetchLeaderboard(); // refresh score
      clearInterval(localTimer);
    } catch (err) {
      console.error(err);
      statusDiv.innerText = "❌ Submission failed. Try again.";
      enableOptions();
    }
  }

  async function fetchLeaderboard() {
    try {
      const res = await apiFetch("/leaderboard");
      const data = await res.json();
      const me = data.find((x) => x[0] === playerName);
      if (me) scoreVal.innerText = me[1];
    } catch (e) {
      console.error("Error fetching leaderboard", e);
    }
  }

  // expose for WS
  window.onQuestionStart = onQuestionStart;
}

/* ============================
   Host page logic (host.html)
   ============================ */
if (document.getElementById("start-q")) {
  // Host page
  const qSelect = document.getElementById("question-select");
  const startBtn = document.getElementById("start-q");
  const leaderboardOl = document.getElementById("leaderboard");
  const downloadRawBtn = document.getElementById("download-raw");
  const downloadSummaryBtn = document.getElementById("download-summary");

  // Load questions
  (async () => {
    const res = await apiFetch("/questions");
    const qs = await res.json();
    qs.forEach((q) => {
      const opt = document.createElement("option");
      opt.value = q.id;
      opt.innerText = `Q${q.id}: ${q.question.substring(0, 80)}${
        q.question.length > 80 ? "..." : ""
      }`;
      qSelect.appendChild(opt);
    });
  })();

  startBtn.addEventListener("click", async () => {
    const qid = qSelect.value;
    if (!qid) {
      alert("Choose a question");
      return;
    }
    startBtn.disabled = true;
    try {
      await apiFetch(`/host/start_question?qid=${qid}`, { method: "POST" });
      setTimeout(() => (startBtn.disabled = false), 1000);
    } catch (e) {
      console.error(e);
      startBtn.disabled = false;
    }
  });

  function updateLeaderboardUI(lb) {
    leaderboardOl.innerHTML = "";
    lb.forEach((item) => {
      const li = document.createElement("li");
      li.innerText = `${item[0]} — ${item[1]} pts`;
      leaderboardOl.appendChild(li);
    });
  }

  downloadRawBtn.addEventListener("click", () => {
    window.open(BACKEND_URL + "/export/raw", "_blank");
  });
  downloadSummaryBtn.addEventListener("click", () => {
    window.open(BACKEND_URL + "/export/summary", "_blank");
  });

  window.updateLeaderboardUI = updateLeaderboardUI;
}
