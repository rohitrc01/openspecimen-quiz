/**********************************************
 OPEN SPECIMEN QUIZ — FINAL STABLE SCRIPT.JS
**********************************************/

// 🔗 Your backend Render URL
const BACKEND_URL = "https://openspecimen-quiz.onrender.com";

// Secure WebSocket URL for HTTPS → WSS
function makeWSUrl() {
  return BACKEND_URL.replace("https://", "wss://") + "/ws";
}

// ======== WEBSOCKET CONNECTION ===========
let ws;
function connectWS() {
  try {
    ws = new WebSocket(makeWSUrl());

    ws.onopen = () => console.log("WS CONNECTED ✔");

    ws.onmessage = (evt) => {
      const data = JSON.parse(evt.data);
      if (data.type === "question_start") {
        window.onQuestionStart?.(data.question);
      }
      if (data.type === "leaderboard_update") {
        window.updateLeaderboardUI?.(data.leaderboard);
      }
    };

    ws.onclose = () => {
      console.log("WS disconnected — retrying…");
      setTimeout(connectWS, 1500);
    };

    ws.onerror = () => {
      console.log("WS error — retrying…");
    };

  } catch (err) {
    console.error("WS Error:", err);
  }
}

connectWS();

// ======== API FETCH ===========
async function apiFetch(path, opts = {}) {
  const url = BACKEND_URL + path + "?ts=" + Date.now(); // anti-cache
  const res = await fetch(url, opts);
  if (!res.ok) throw new Error(await res.text());
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

  // Join quiz
  joinBtn.onclick = () => {
    const name = playerNameInput.value.trim();
    if (!name) return alert("Please enter your name first!");

    playerName = name;
    joinScreen.style.display = "none";
    quizScreen.style.display = "block";
    statusDiv.innerText = "Waiting for host to start a question…";
  };

  // When host starts a question
  window.onQuestionStart = function (question) {
    currentQuestion = question;

    questionText.innerText = question.question;
    optionsDiv.innerHTML = "";

    question.options.forEach((opt, idx) => {
      const btn = document.createElement("button");
      btn.className = "opt-btn";
      btn.innerText = opt;
      btn.onclick = () => submitAnswer(idx);
      optionsDiv.appendChild(btn);
    });

    // Reset and start 15-sec timer
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
        disableOptions("⏰ Time up! No answer recorded.");
      }

    }, 1000);

    statusDiv.innerText = "Answer now!";
  };

  // Disable answer buttons
  function disableOptions(msg) {
    optionsDiv.querySelectorAll("button").forEach(b => b.disabled = true);
    statusDiv.innerText = msg;
  }

  // Submit answer
  async function submitAnswer(chosenIndex) {
    if (!currentQuestion) return;

    clearInterval(localTimer);
    disableOptions("Submitting…");

    try {
      const payload = {
        name: playerName,
        qid: currentQuestion.id,
        chosen_index: chosenIndex,
        time_taken: 15 - localTimeLeft
      };

      await apiFetch("/submit_answer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      statusDiv.innerText = "✅ Answer submitted!";
      fetchLeaderboard();

    } catch (err) {
      console.error(err);
      statusDiv.innerText = "Error submitting answer!";
    }
  }

  // Fetch latest score
  async function fetchLeaderboard() {
    try {
      const res = await apiFetch("/leaderboard");
      const data = await res.json();
      const me = data.find(x => x[0] === playerName);
      if (me) scoreVal.innerText = me[1];
    } catch (err) {
      console.error("Leaderboard error:", err);
    }
  }
}

/**********************************************
 HOST PAGE LOGIC (host.html)
**********************************************/
if (document.getElementById("start-q")) {

  const qSelect = document.getElementById("question-select");
  const startBtn = document.getElementById("start-q");
  const leaderboardOl = document.getElementById("leaderboard");

  // Load all questions
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

  // Start question
  startBtn.onclick = async () => {
    const qid = qSelect.value;
    if (!qid) return alert("Please select a question.");

    startBtn.disabled = true;

    await apiFetch(`/host/start_question?qid=${qid}`, { method: "POST" });

    setTimeout(() => (startBtn.disabled = false), 1000);
  };

  // Update leaderboard
  window.updateLeaderboardUI = function (lb) {
    leaderboardOl.innerHTML = "";

    lb.forEach(item => {
      const li = document.createElement("li");
      li.innerText = `${item[0]} — ${item[1]} pts`;
      leaderboardOl.appendChild(li);
    });
  };
}


